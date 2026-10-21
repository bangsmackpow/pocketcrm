import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, asc } from 'drizzle-orm';
import {
  documents,
  documentItems,
  clients,
  documentTemplates,
  type EstimateStatus,
} from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import {
  calculateDocumentTotals,
  canTransitionEstimate,
} from '../lib/calculations';
import {
  generateDocumentPdfBuffer,
  renderDocumentTemplateHtml,
} from '../lib/pdf';
import { putDocumentPdf } from '../lib/r2';
import { recordAuditLog } from '../lib/audit';
import { sendDocumentEmail } from '../lib/email';
import { rateLimit } from '../lib/rate-limit';

export const estimateRoutes = new Hono<AppEnv>();

const sendEmailSchema = z.object({
  recipientEmail: z.string().trim().email('Valid recipient email required').optional(),
  subject: z.string().trim().max(200).optional(),
  customMessage: z.string().trim().max(2000).optional(),
});

const lineItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required'),
  description: z.string().optional().default(''),
  quantity: z.coerce.number().positive(),
  unit: z.string().optional().default('hrs'),
  unitPrice: z.coerce.number().min(0),
  discountType: z.enum(['percentage', 'fixed']).optional().default('percentage'),
  discountValue: z.coerce.number().min(0).optional().default(0),
  taxName: z.string().optional().default('Tax'),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
  taxCompound: z.boolean().optional().default(false),
  secondTaxName: z.string().optional(),
  secondTaxRate: z.coerce.number().min(0).max(100).optional().default(0),
  secondTaxCompound: z.boolean().optional().default(false),
});

const createEstimateSchema = z.object({
  documentNumber: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  templateId: z.string().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3).toUpperCase().default('USD'),
  discountType: z.enum(['percentage', 'fixed']).default('percentage'),
  discountValue: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  items: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

/**
 * List all estimates/quotes with client metadata and capped pagination
 */
estimateRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const statusFilter = c.req.query('status') as EstimateStatus | undefined;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      document: documents,
      client: {
        id: clients.id,
        code: clients.code,
        companyName: clients.companyName,
        contactName: clients.contactName,
        email: clients.email,
      },
    })
    .from(documents)
    .innerJoin(clients, eq(documents.clientId, clients.id))
    .where(
      statusFilter
        ? and(eq(documents.type, 'estimate'), eq(documents.status, statusFilter))
        : eq(documents.type, 'estimate')
    )
    .orderBy(desc(documents.issueDate), desc(documents.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    estimates: rows.map((r) => ({
      ...r.document,
      client: r.client,
    })),
    pagination: {
      page,
      limit,
      count: rows.length,
    },
  });
});

/**
 * Get single estimate with line items, client, and template
 */
estimateRoutes.get('/:id', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.type, 'estimate')))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Estimate not found' }, 404);
  }

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, doc.clientId))
    .limit(1);

  const items = await db
    .select()
    .from(documentItems)
    .where(eq(documentItems.documentId, doc.id))
    .orderBy(asc(documentItems.sortOrder));

  return c.json({
    estimate: {
      ...doc,
      client,
      items,
    },
  });
});

/**
 * Create a new Estimate/Quote using atomic D1 db.batch()
 */
estimateRoutes.post(
  '/',
  requireRole('member'),
  zValidator('json', createEstimateSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const body = c.req.valid('json');
    const now = new Date();

    // Idempotency / Duplicate Check
    const [existingDoc] = await db
      .select({ id: documents.id, documentNumber: documents.documentNumber })
      .from(documents)
      .where(eq(documents.documentNumber, body.documentNumber))
      .limit(1);

    if (existingDoc) {
      return c.json(
        {
          error: 'DocumentNumberConflict',
          message: `Estimate number "${body.documentNumber}" already exists. Please choose a unique document number or verify if it was already created.`,
        },
        409
      );
    }

    const docId = `doc_est_${crypto.randomUUID().slice(0, 12)}`;

    const calc = calculateDocumentTotals(
      body.items,
      body.discountType,
      body.discountValue,
      0
    );

    const headerInsert = db.insert(documents).values({
      id: docId,
      documentNumber: body.documentNumber,
      type: 'estimate',
      status: 'draft',
      clientId: body.clientId,
      templateId: body.templateId ?? 'tpl_modern_slate',
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      currency: body.currency,
      discountType: body.discountType,
      discountValue: body.discountValue,
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      taxTotal: calc.taxTotal,
      total: calc.total,
      amountPaid: 0,
      amountDue: calc.total,
      notes: body.notes ?? null,
      terms: body.terms ?? 'Valid for 30 days',
      createdBy: user?.id ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const itemInserts = calc.items.map((item, idx) =>
      db.insert(documentItems).values({
        id: `item_${crypto.randomUUID().slice(0, 12)}`,
        documentId: docId,
        sortOrder: idx,
        name: item.name,
        description: item.description ?? '',
        quantity: item.quantity,
        unit: item.unit ?? 'hrs',
        unitPrice: item.unitPrice,
        discountType: item.discountType ?? 'percentage',
        discountValue: item.discountValue ?? 0,
        taxName: item.taxName ?? 'Tax',
        taxRate: item.taxRate ?? 0,
        taxCompound: Boolean(item.taxCompound),
        secondTaxName: item.secondTaxName ?? null,
        secondTaxRate: item.secondTaxRate ?? 0,
        secondTaxCompound: Boolean(item.secondTaxCompound),
        lineSubtotal: item.lineSubtotal,
        lineDiscountAmount: item.lineDiscountAmount,
        lineTaxAmount: item.lineTaxAmount,
        lineTotal: item.lineTotal,
        createdAt: now,
      })
    );

    await db.batch([headerInsert, ...itemInserts]);

    await recordAuditLog({
      db,
      user,
      action: 'estimate.created',
      entityType: 'estimate',
      entityId: docId,
      metadata: {
        documentNumber: body.documentNumber,
        total: calc.total,
        currency: body.currency,
      },
    });

    const [created] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
    return c.json({ estimate: created, calculation: calc }, 201);
  }
);

/**
 * Modify an existing Estimate (allowed until converted to invoice)
 */
const updateEstimateSchema = z.object({
  clientId: z.string().trim().min(1).optional(),
  templateId: z.string().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.coerce.number().min(0).optional(),
  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  items: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

estimateRoutes.put(
  '/:id',
  requireRole('member'),
  zValidator('json', updateEstimateSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const now = new Date();

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.type, 'estimate')))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Estimate not found' }, 404);
    }

    if (existing.status === 'converted') {
      return c.json(
        {
          error: 'EstimateLocked',
          message: 'Converted estimates cannot be modified.',
        },
        400
      );
    }

    const discountType = body.discountType ?? existing.discountType;
    const discountValue = body.discountValue ?? existing.discountValue;

    const calc = calculateDocumentTotals(
      body.items,
      discountType,
      discountValue,
      0
    );

    const deleteItems = db
      .delete(documentItems)
      .where(eq(documentItems.documentId, id));

    const updateHeader = db
      .update(documents)
      .set({
        clientId: body.clientId ?? existing.clientId,
        templateId: body.templateId ?? existing.templateId,
        issueDate: body.issueDate ?? existing.issueDate,
        dueDate: body.dueDate ?? existing.dueDate,
        currency: body.currency ?? existing.currency,
        discountType,
        discountValue,
        subtotal: calc.subtotal,
        discountTotal: calc.discountTotal,
        taxTotal: calc.taxTotal,
        total: calc.total,
        amountDue: calc.amountDue,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        terms: body.terms !== undefined ? body.terms : existing.terms,
        updatedAt: now,
      })
      .where(eq(documents.id, id));

    const itemInserts = calc.items.map((item, idx) =>
      db.insert(documentItems).values({
        id: `item_${crypto.randomUUID().slice(0, 12)}`,
        documentId: id,
        sortOrder: idx,
        name: item.name,
        description: item.description ?? '',
        quantity: item.quantity,
        unit: item.unit ?? 'hrs',
        unitPrice: item.unitPrice,
        discountType: item.discountType ?? 'percentage',
        discountValue: item.discountValue ?? 0,
        taxName: item.taxName ?? 'Tax',
        taxRate: item.taxRate ?? 0,
        taxCompound: Boolean(item.taxCompound),
        secondTaxName: item.secondTaxName ?? null,
        secondTaxRate: item.secondTaxRate ?? 0,
        secondTaxCompound: Boolean(item.secondTaxCompound),
        lineSubtotal: item.lineSubtotal,
        lineDiscountAmount: item.lineDiscountAmount,
        lineTaxAmount: item.lineTaxAmount,
        lineTotal: item.lineTotal,
        createdAt: now,
      })
    );

    await db.batch([deleteItems, updateHeader, ...itemInserts]);

    await recordAuditLog({
      db,
      user,
      action: 'estimate.updated',
      entityType: 'estimate',
      entityId: id,
      metadata: {
        documentNumber: existing.documentNumber,
        previousTotal: existing.total,
        newTotal: calc.total,
        status: existing.status,
      },
    });

    const [updated] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    return c.json({ estimate: updated, calculation: calc });
  }
);

/**
 * State Machine Transition for Estimate:
 * Draft -> Sent -> Approved/Rejected -> Converted to Invoice
 */
const statusSchema = z.object({
  status: z.enum(['draft', 'sent', 'approved', 'rejected', 'converted']),
});

estimateRoutes.patch(
  '/:id/status',
  requireRole('member'),
  zValidator('json', statusSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const { status: nextStatus } = c.req.valid('json');

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.type, 'estimate')))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Estimate not found' }, 404);
    }

    if (!canTransitionEstimate(existing.status, nextStatus)) {
      return c.json(
        {
          error: 'Invalid State Transition',
          message: `Cannot transition estimate from "${existing.status}" to "${nextStatus}". Allowed workflow: Draft -> Sent -> Approved/Rejected -> Converted.`,
        },
        400
      );
    }

    const [updated] = await db
      .update(documents)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'estimate.status_transition',
      entityType: 'estimate',
      entityId: id,
      metadata: {
        documentNumber: existing.documentNumber,
        from: existing.status,
        to: nextStatus,
      },
    });

    return c.json({ estimate: updated });
  }
);

/**
 * Convert an Approved Estimate directly into an Invoice using atomic D1 db.batch()
 */
estimateRoutes.post('/:id/convert', requireRole('member'), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const id = c.req.param('id');

  const [estimate] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.type, 'estimate')))
    .limit(1);

  if (!estimate) {
    return c.json({ error: 'Estimate not found' }, 404);
  }

  if (estimate.status === 'converted' && estimate.convertedToDocumentId) {
    return c.json(
      {
        error: 'Already Converted',
        message: `Estimate ${estimate.documentNumber} was already converted to invoice ${estimate.convertedToDocumentId}.`,
      },
      400
    );
  }

  if (estimate.status !== 'approved' && estimate.status !== 'sent') {
    return c.json(
      {
        error: 'Invalid State for Conversion',
        message: `Estimate must be in "approved" or "sent" status before converting to an Invoice (current: "${estimate.status}").`,
      },
      400
    );
  }

  const items = await db
    .select()
    .from(documentItems)
    .where(eq(documentItems.documentId, estimate.id))
    .orderBy(asc(documentItems.sortOrder));

  const now = new Date();
  const newInvoiceId = `doc_inv_${crypto.randomUUID().slice(0, 12)}`;
  const invoiceNumber = estimate.documentNumber.replace(/^(EST|QUO)/i, 'INV') +
    (estimate.documentNumber.match(/^(EST|QUO)/i) ? '' : `-INV-${Date.now().toString().slice(-4)}`);

  const issueDate = now.toISOString().slice(0, 10);
  const dueDateObj = new Date(now.getTime() + 30 * 86400 * 1000);
  const dueDate = dueDateObj.toISOString().slice(0, 10);

  const insertInvoice = db.insert(documents).values({
    id: newInvoiceId,
    documentNumber: invoiceNumber,
    type: 'invoice',
    status: 'draft',
    clientId: estimate.clientId,
    templateId: estimate.templateId,
    sourceEstimateId: estimate.id,
    issueDate,
    dueDate,
    currency: estimate.currency,
    discountType: estimate.discountType,
    discountValue: estimate.discountValue,
    subtotal: estimate.subtotal,
    discountTotal: estimate.discountTotal,
    taxTotal: estimate.taxTotal,
    total: estimate.total,
    amountPaid: 0,
    amountDue: estimate.total,
    notes: estimate.notes,
    terms: 'Converted from Estimate ' + estimate.documentNumber,
    createdBy: user?.id ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const cloneItems = items.map((item) =>
    db.insert(documentItems).values({
      id: `item_${crypto.randomUUID().slice(0, 12)}`,
      documentId: newInvoiceId,
      sortOrder: item.sortOrder,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxName: item.taxName,
      taxRate: item.taxRate,
      taxCompound: item.taxCompound,
      secondTaxName: item.secondTaxName,
      secondTaxRate: item.secondTaxRate,
      secondTaxCompound: item.secondTaxCompound,
      lineSubtotal: item.lineSubtotal,
      lineDiscountAmount: item.lineDiscountAmount,
      lineTaxAmount: item.lineTaxAmount,
      lineTotal: item.lineTotal,
      createdAt: now,
    })
  );

  const markEstimateConverted = db
    .update(documents)
    .set({
      status: 'converted',
      convertedToDocumentId: newInvoiceId,
      updatedAt: now,
    })
    .where(eq(documents.id, estimate.id));

  await db.batch([insertInvoice, ...cloneItems, markEstimateConverted]);

  await recordAuditLog({
    db,
    user,
    action: 'estimate.converted_to_invoice',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      estimateNumber: estimate.documentNumber,
      invoiceId: newInvoiceId,
      invoiceNumber,
    },
  });

  const [createdInvoice] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, newInvoiceId))
    .limit(1);

  return c.json({
    converted: true,
    estimateId: estimate.id,
    invoice: createdInvoice,
  });
});

/**
 * Render HTML preview or generate & persist PDF to Cloudflare R2
 */
estimateRoutes.get('/:id/pdf', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const format = c.req.query('format') || 'pdf';

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.type, 'estimate')))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Estimate not found' }, 404);
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, doc.clientId)).limit(1);
  const items = await db
    .select()
    .from(documentItems)
    .where(eq(documentItems.documentId, doc.id))
    .orderBy(asc(documentItems.sortOrder));

  const [template] = doc.templateId
    ? await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, doc.templateId))
        .limit(1)
    : [];

  if (format === 'html') {
    const html = renderDocumentTemplateHtml({
      document: doc,
      client,
      items,
      template,
    });
    return c.html(html);
  }

  const pdfBytes = await generateDocumentPdfBuffer({
    document: doc,
    client,
    items,
    template,
  });

  // Store generated PDF in R2 bucket if available
  if (c.env.STORAGE) {
    const stored = await putDocumentPdf(
      c.env.STORAGE,
      'estimate',
      doc.documentNumber,
      pdfBytes
    );
    await db
      .update(documents)
      .set({ pdfR2Key: stored.key, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
  }

  return new Response(pdfBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.documentNumber}.pdf"`,
    },
  });
});

/**
 * Send estimate/quote to client via Cloudflare Native Email
 * Protected by schema validation and per-minute rate limiting
 */
estimateRoutes.post(
  '/:id/send',
  requireRole('member'),
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: 'est_email_send',
    message: 'Estimate email dispatch rate limit reached. Please wait 1 minute before sending more estimates.',
  }),
  zValidator('json', sendEmailSchema),
  async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const { recipientEmail, subject, customMessage } = c.req.valid('json');

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.type, 'estimate')))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Estimate not found' }, 404);
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, doc.clientId)).limit(1);
  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  const items = await db
    .select()
    .from(documentItems)
    .where(eq(documentItems.documentId, doc.id))
    .orderBy(asc(documentItems.sortOrder));

  const [template] = doc.templateId
    ? await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, doc.templateId))
        .limit(1)
    : [];

  const targetRecipient = (recipientEmail || client.email || '').trim();
  if (!targetRecipient) {
    return c.json({ error: 'Client has no email address configured and none was provided.' }, 400);
  }

  const emailResult = await sendDocumentEmail({
    env: c.env,
    ctx: {
      document: doc,
      client,
      items,
      template,
    },
    recipientEmail: targetRecipient,
    recipientName: client.contactName || client.companyName,
    subject,
    customMessage,
  });

  if (!emailResult.success) {
    return c.json({ error: emailResult.error || 'Failed to dispatch email' }, 500);
  }

  // Advance status from draft to sent if needed
  if (doc.status === 'draft') {
    await db
      .update(documents)
      .set({
        status: 'sent',
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));
  }

  const user = c.get('user');
  await recordAuditLog({
    db,
    user,
    action: 'estimate.emailed',
    entityType: 'estimate',
    entityId: doc.id,
    metadata: {
      documentNumber: doc.documentNumber,
      recipient: targetRecipient,
      simulated: emailResult.simulated ?? false,
      messageId: emailResult.messageId,
    },
  });

  return c.json({
    success: true,
    message: `Estimate ${doc.documentNumber} dispatched successfully to ${targetRecipient}${emailResult.simulated ? ' (simulated)' : ''}`,
    simulated: emailResult.simulated ?? false,
  });
});

