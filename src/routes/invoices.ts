import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, asc } from 'drizzle-orm';
import {
  documents,
  documentItems,
  clients,
  documentTemplates,
  accounts,
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
  deleteR2Object,
} from '../lib/r2';
import { verifyPassword } from 'better-auth/crypto';
import { recordAuditLog } from '../lib/audit';
import { recordEmailLog } from '../lib/email-log';
import { sendDocumentEmail } from '../lib/email';
import { rateLimit } from '../lib/rate-limit';

export const invoiceRoutes = new Hono<AppEnv>();

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
 * List invoices with client metadata, status filtering, and capped pagination
 */
invoiceRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const statusFilter = c.req.query('status') as InvoiceStatus | undefined;
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
        ? and(eq(documents.type, 'invoice'), eq(documents.status, statusFilter))
        : eq(documents.type, 'invoice')
    )
    .orderBy(desc(documents.issueDate), desc(documents.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    invoices: rows.map((r) => ({
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
          message: `Invoice number "${body.documentNumber}" already exists. Please choose a unique document number or verify if it was already created.`,
        },
        409
      );
    }

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
 * Modify an existing Invoice (allowed for any invoice until it has been paid)
 */
const updateInvoiceSchema = z.object({
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

invoiceRoutes.put(
  '/:id',
  requireRole('member'),
  zValidator('json', updateInvoiceSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const now = new Date();

    const [existing] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.type, 'invoice')))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Invoice not found' }, 404);
    }

    if (existing.status === 'paid') {
      return c.json(
        {
          error: 'InvoiceLocked',
          message: 'Paid invoices cannot be modified. To adjust billing, issue a credit or create a revised invoice.',
        },
        400
      );
    }

    const discountType = body.discountType ?? existing.discountType;
    const discountValue = body.discountValue ?? existing.discountValue;
    const amountPaid = existing.amountPaid ?? 0;

    const calc = calculateDocumentTotals(
      body.items,
      discountType,
      discountValue,
      amountPaid
    );

    // Re-evaluate status based on updated amounts
    let newStatus: InvoiceStatus = existing.status as InvoiceStatus;
    if (amountPaid > 0 && calc.amountDue === 0) {
      newStatus = 'paid';
    } else if (amountPaid > 0 && calc.amountDue > 0) {
      newStatus = 'partial';
    }

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
        status: newStatus,
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
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      metadata: {
        documentNumber: existing.documentNumber,
        previousTotal: existing.total,
        newTotal: calc.total,
        status: newStatus,
      },
    });

    const [updated] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    return c.json({ invoice: updated, calculation: calc });
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

  let [template] = doc.templateId
    ? await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, doc.templateId))
        .limit(1)
    : [];

  if (!template) {
    const [defaultTpl] = await db
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.isDefault, true))
      .limit(1);
    template = defaultTpl;
  }

  if (format === 'html') {
    const html = renderDocumentTemplateHtml({
      document: doc,
      client,
      items,
      template,
      storage: c.env.STORAGE,
    });
    return c.html(html);
  }

  const pdfBytes = await generateDocumentPdfBuffer({
    document: doc,
    client,
    items,
    template,
    storage: c.env.STORAGE,
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
 * Protected by schema validation and per-minute rate limiting
 */
invoiceRoutes.post(
  '/:id/send',
  requireRole('member'),
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: 'inv_email_send',
    message: 'Invoice email dispatch rate limit reached. Please wait 1 minute before sending more invoices.',
  }),
  zValidator('json', sendEmailSchema),
  async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const { recipientEmail, subject, customMessage } = c.req.valid('json');

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

  let [template] = doc.templateId
    ? await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, doc.templateId))
        .limit(1)
    : [];

  if (!template) {
    const [defaultTpl] = await db
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.isDefault, true))
      .limit(1);
    template = defaultTpl;
  }

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

  const user = c.get('user');
  const senderEmail = c.env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com';

  if (!emailResult.success) {
    await recordEmailLog({
      db,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
      documentType: 'invoice',
      recipientEmail: targetRecipient,
      recipientName: client.contactName || client.companyName,
      senderEmail,
      subject: subject || `[Invoice] #${doc.documentNumber}`,
      status: 'failed',
      errorMessage: emailResult.error || 'Failed to dispatch email',
      user,
    });

    await recordAuditLog({
      db,
      user,
      action: 'invoice.email_failed',
      entityType: 'invoice',
      entityId: doc.id,
      metadata: {
        documentNumber: doc.documentNumber,
        recipient: targetRecipient,
        error: emailResult.error,
      },
    });

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

  await recordEmailLog({
    db,
    documentId: doc.id,
    documentNumber: doc.documentNumber,
    documentType: 'invoice',
    recipientEmail: targetRecipient,
    recipientName: client.contactName || client.companyName,
    senderEmail,
    subject: subject || `[Invoice] #${doc.documentNumber}`,
    status: emailResult.simulated ? 'simulated' : 'delivered',
    messageId: emailResult.messageId,
    user,
  });

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

/**
 * Delete Invoice (Admin Only with Re-Authentication)
 * Requires the calling admin to provide their current account password.
 * Deletes associated line items, cleans up R2 artifacts, and records a permanent audit entry.
 */
const deleteDocumentSchema = z.object({
  password: z.string().min(1, 'Admin password is required to delete invoices'),
});

invoiceRoutes.delete(
  '/:id',
  requireRole('admin'),
  zValidator('json', deleteDocumentSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const { password } = c.req.valid('json');

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.type, 'invoice')))
      .limit(1);

    if (!doc) {
      return c.json({ error: 'Invoice not found' }, 404);
    }

    // Verify admin credentials
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id))
      .limit(1);

    if (!account?.password) {
      return c.json({ error: 'Credential account not found for current admin' }, 403);
    }

    const isMatch = await verifyPassword({
      password,
      hash: account.password,
    });

    if (!isMatch) {
      await recordAuditLog({
        db,
        user,
        action: 'invoice.delete_failed_invalid_credentials',
        entityType: 'invoice',
        entityId: doc.id,
        metadata: {
          documentNumber: doc.documentNumber,
          error: 'Invalid password provided during admin deletion confirmation',
        },
      });
      return c.json({ error: 'Invalid admin password. Deletion cancelled.' }, 401);
    }

    // Clean up any R2 PDF if present
    if (doc.pdfR2Key && c.env.STORAGE) {
      try {
        await deleteR2Object(c.env.STORAGE, doc.pdfR2Key);
      } catch (err) {
        console.warn(`[DeleteInvoice] Could not remove R2 PDF ${doc.pdfR2Key}:`, err);
      }
    }

    // Delete document items and document
    await db.delete(documentItems).where(eq(documentItems.documentId, doc.id));
    await db.delete(documents).where(eq(documents.id, doc.id));

    // High-visibility audit log
    await recordAuditLog({
      db,
      user,
      action: 'invoice.deleted',
      entityType: 'invoice',
      entityId: doc.id,
      metadata: {
        documentNumber: doc.documentNumber,
        total: doc.total,
        currency: doc.currency,
        status: doc.status,
        deletedBy: user.email,
        adminConfirmed: true,
      },
    });

    return c.json({
      success: true,
      message: `Invoice ${doc.documentNumber} has been permanently deleted.`,
    });
  }
);

