import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, asc } from 'drizzle-orm';
import {
  documents,
  documentItems,
  clients,
  documentTemplates,
  type InvoiceStatus,
} from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import {
  calculateDocumentTotals,
  canTransitionInvoice,
  roundCurrency,
} from '../lib/calculations';
import {
  generateDocumentPdfBuffer,
  renderDocumentTemplateHtml,
} from '../lib/pdf';
import {
  putDocumentPdf,
  putDocumentAttachment,
} from '../lib/r2';
import { recordAuditLog } from '../lib/audit';
import { sendDocumentEmail } from '../lib/email';

export const invoiceRoutes = new Hono<AppEnv>();

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

const createInvoiceSchema = z.object({
  documentNumber: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  templateId: z.string().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3).toUpperCase().default('USD'),
  discountType: z.enum(['percentage', 'fixed']).default('percentage'),
  discountValue: z.coerce.number().min(0).default(0),
  amountPaid: z.coerce.number().min(0).optional().default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  items: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

/**
 * List all invoices with client metadata
 */
invoiceRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const statusFilter = c.req.query('status') as InvoiceStatus | undefined;

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
        ? and(eq(documents.type, 'invoice'), eq(documents.status, statusFilter))
        : eq(documents.type, 'invoice')
    )
    .orderBy(desc(documents.issueDate), desc(documents.createdAt));

  return c.json({
    invoices: rows.map((r) => ({
      ...r.document,
      client: r.client,
    })),
  });
});

/**
 * Get single invoice with line items, client, and template
 */
invoiceRoutes.get('/:id', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.type, 'invoice')))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Invoice not found' }, 404);
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
    invoice: {
      ...doc,
      client,
      items,
    },
  });
});

/**
 * Create a new Invoice using atomic D1 db.batch()
 */
invoiceRoutes.post(
  '/',
  requireRole('member'),
  zValidator('json', createInvoiceSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const body = c.req.valid('json');
    const now = new Date();
    const docId = `doc_inv_${crypto.randomUUID().slice(0, 12)}`;

    const calc = calculateDocumentTotals(
      body.items,
      body.discountType,
      body.discountValue,
      body.amountPaid
    );

    const initialStatus: InvoiceStatus =
      calc.amountPaid > 0 && calc.amountDue === 0
        ? 'paid'
        : calc.amountPaid > 0
        ? 'partial'
        : 'draft';

    const headerInsert = db.insert(documents).values({
      id: docId,
      documentNumber: body.documentNumber,
      type: 'invoice',
      status: initialStatus,
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
      amountPaid: calc.amountPaid,
      amountDue: calc.amountDue,
      notes: body.notes ?? null,
      terms: body.terms ?? 'Net 30 days',
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
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: docId,
      metadata: {
        documentNumber: body.documentNumber,
        total: calc.total,
        currency: body.currency,
      },
    });

    const [created] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
    return c.json({ invoice: created, calculation: calc }, 201);
  }
);

/**
 * State Machine Transition for Invoice:
 * Draft -> Sent -> Partial/Paid -> Overdue -> Cancelled
 */
const statusSchema = z.object({
  status: z.enum(['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled']),
});

invoiceRoutes.patch(
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
      .where(and(eq(documents.id, id), eq(documents.type, 'invoice')))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Invoice not found' }, 404);
    }

    if (!canTransitionInvoice(existing.status, nextStatus)) {
      return c.json(
        {
          error: 'Invalid State Transition',
          message: `Cannot transition invoice from "${existing.status}" to "${nextStatus}". Allowed workflow: Draft -> Sent -> Partial/Paid -> Overdue -> Cancelled.`,
        },
        400
      );
    }

    const updatedPaid =
      nextStatus === 'paid' ? existing.total : existing.amountPaid;
    const updatedDue =
      nextStatus === 'paid' ? 0 : roundCurrency(Math.max(0, existing.total - updatedPaid));

    const [updated] = await db
      .update(documents)
      .set({
        status: nextStatus,
        amountPaid: updatedPaid,
        amountDue: updatedDue,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'invoice.status_transition',
      entityType: 'invoice',
      entityId: id,
      metadata: {
        documentNumber: existing.documentNumber,
        from: existing.status,
        to: nextStatus,
      },
    });

    return c.json({ invoice: updated });
  }
);

/**
 * Record a partial or full payment against an Invoice
 */
const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be positive'),
  reference: z.string().optional(),
});

invoiceRoutes.post(
  '/:id/payments',
  requireRole('member'),
  zValidator('json', recordPaymentSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const { amount, reference } = c.req.valid('json');

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.type, 'invoice')))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Invoice not found' }, 404);
    }

    const newPaid = roundCurrency(Math.min(existing.total, existing.amountPaid + amount));
    const newDue = roundCurrency(Math.max(0, existing.total - newPaid));
    const newStatus: InvoiceStatus = newDue <= 0 ? 'paid' : 'partial';

    const [updated] = await db
      .update(documents)
      .set({
        amountPaid: newPaid,
        amountDue: newDue,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'invoice.payment_recorded',
      entityType: 'invoice',
      entityId: id,
      metadata: {
        documentNumber: existing.documentNumber,
        paymentAmount: amount,
        reference,
        newStatus,
        amountDue: newDue,
      },
    });

    return c.json({ invoice: updated });
  }
);

/**
 * Upload an attachment to Cloudflare R2 and attach metadata to the Invoice
 */
const attachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().default('application/octet-stream'),
  contentBase64: z.string().min(1),
});

invoiceRoutes.post(
  '/:id/attachments',
  requireRole('member'),
  zValidator('json', attachmentSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const { filename, contentType, contentBase64 } = c.req.valid('json');

    const [existing] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Document not found' }, 404);
    }

    const binaryStr = atob(contentBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const stored = await putDocumentAttachment(
      c.env.STORAGE,
      existing.id,
      filename,
      bytes,
      contentType
    );

    const updatedAttachments = [
      ...(existing.attachments || []),
      {
        key: stored.key,
        filename,
        contentType,
        size: stored.size,
        uploadedAt: stored.uploadedAt,
      },
    ];

    const [updated] = await db
      .update(documents)
      .set({ attachments: updatedAttachments, updatedAt: new Date() })
      .where(eq(documents.id, existing.id))
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'invoice.attachment_uploaded',
      entityType: 'invoice',
      entityId: existing.id,
      metadata: { key: stored.key, filename, size: stored.size },
    });

    return c.json({ invoice: updated, attachment: stored }, 201);
  }
);

/**
 * Render HTML preview or generate & persist PDF to Cloudflare R2
 */
invoiceRoutes.get('/:id/pdf', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const format = c.req.query('format') || 'pdf';

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.type, 'invoice')))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Invoice not found' }, 404);
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

  const pdfBytes = generateDocumentPdfBuffer({
    document: doc,
    client,
    items,
    template,
  });

  if (c.env.STORAGE) {
    const stored = await putDocumentPdf(
      c.env.STORAGE,
      'invoice',
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
 * Send invoice to client via Cloudflare Native Email
 */
invoiceRoutes.post('/:id/send', requireRole('member'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const body = await c.req.json().catch(() => ({}));
  const { recipientEmail, subject, customMessage } = body as {
    recipientEmail?: string;
    subject?: string;
    customMessage?: string;
  };

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.type, 'invoice')))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Invoice not found' }, 404);
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
    action: 'invoice.emailed',
    entityType: 'invoice',
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
    message: `Invoice ${doc.documentNumber} dispatched successfully to ${targetRecipient}${emailResult.simulated ? ' (simulated)' : ''}`,
    simulated: emailResult.simulated ?? false,
  });
});

