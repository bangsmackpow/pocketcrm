import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, desc } from 'drizzle-orm';
import {
  documents,
  documentItems,
  clients,
  documentTemplates,
  payments,
} from '../db/schema';
import { type AppEnv } from '../lib/auth';
import { generateDocumentPdfBuffer } from '../lib/pdf';
import { createStripeCheckoutSession } from '../lib/stripe';
import { generatePortalToken } from '../lib/portal-token';
import { recordAuditLog } from '../lib/audit';
import { recordEmailLog } from '../lib/email-log';
import { createMimeMessage } from 'mimetext';
import { EmailMessage } from 'cloudflare:email';

export const portalRoutes = new Hono<AppEnv>();

/**
 * Public document view via secure unguessable portal token
 */
portalRoutes.get('/:token', async (c) => {
  const db = c.get('db');
  const token = c.req.param('token');

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.portalToken, token))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Document not found or link has expired' }, 404);
  }

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, doc.clientId))
    .limit(1);

  if (!client) {
    return c.json({ error: 'Client record not found' }, 404);
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

  const recentPayments =
    doc.type === 'invoice'
      ? await db
          .select()
          .from(payments)
          .where(eq(payments.documentId, doc.id))
          .orderBy(desc(payments.createdAt))
      : [];

  return c.json({
    document: {
      id: doc.id,
      documentNumber: doc.documentNumber,
      type: doc.type,
      status: doc.status,
      issueDate: doc.issueDate,
      dueDate: doc.dueDate,
      currency: doc.currency,
      discountType: doc.discountType,
      discountValue: doc.discountValue,
      subtotal: doc.subtotal,
      discountTotal: doc.discountTotal,
      taxTotal: doc.taxTotal,
      total: doc.total,
      amountPaid: doc.amountPaid,
      amountDue: doc.amountDue,
      notes: doc.notes,
      terms: doc.terms,
      acceptedAt: doc.acceptedAt,
      acceptedBySignature: doc.acceptedBySignature,
      acceptedByEmail: doc.acceptedByEmail,
      portalToken: doc.portalToken,
      stripeCheckoutSessionId: doc.stripeCheckoutSessionId,
    },
    client: {
      companyName: client.companyName,
      contactName: client.contactName,
      email: client.email,
      phone: client.phone,
      billingAddress: client.billingAddress,
    },
    template: template
      ? {
          companyHeaderText: template.companyHeaderText,
          paymentInstructions: template.paymentInstructions,
          footerLegalClause: template.footerLegalClause,
          logoUrl: template.logoUrl,
          logoR2Key: template.logoR2Key,
          styles: template.styles,
        }
      : null,
    items: items.map((i) => ({
      name: i.name,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      taxRate: i.taxRate,
      lineTotal: i.lineTotal,
    })),
    payments: recentPayments.map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      paymentMethod: p.paymentMethod,
      createdAt: p.createdAt,
    })),
  });
});

/**
 * Public PDF streaming for client portal
 */
portalRoutes.get('/:token/pdf', async (c) => {
  const db = c.get('db');
  const token = c.req.param('token');

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.portalToken, token))
    .limit(1);

  if (!doc) {
    return c.json({ error: 'Document not found' }, 404);
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, doc.clientId)).limit(1);
  if (!client) {
    return c.json({ error: 'Client record not found' }, 404);
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

  try {
    const pdfBytes = await generateDocumentPdfBuffer({
      document: doc,
      client,
      items,
      template,
      storage: c.env.STORAGE,
    });

    return new Response(pdfBytes.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${doc.documentNumber}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error('[Portal PDF] Error rendering PDF:', err);
    return c.json({ error: 'Failed to generate PDF document' }, 500);
  }
});

/**
 * Generate Stripe Checkout Session for Invoice Payment
 */
portalRoutes.post('/:token/checkout', async (c) => {
  const db = c.get('db');
  const token = c.req.param('token');

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.portalToken, token))
    .limit(1);

  if (!doc || doc.type !== 'invoice') {
    return c.json({ error: 'Invoice not found or invalid document type' }, 404);
  }

  if (doc.amountDue <= 0 || doc.status === 'paid') {
    return c.json({ error: 'Invoice has already been settled in full.' }, 400);
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, doc.clientId)).limit(1);
  if (!client) {
    return c.json({ error: 'Client record not found' }, 404);
  }

  const secretKey = c.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return c.json(
      {
        error:
          'Stripe online payments are not currently configured for this organization. Please use ACH/wire instructions on the invoice.',
      },
      503
    );
  }

  const baseUrl = c.env.BETTER_AUTH_URL || new URL(c.req.url).origin;

  try {
    const session = await createStripeCheckoutSession({
      secretKey,
      baseUrl,
      document: {
        id: doc.id,
        documentNumber: doc.documentNumber,
        currency: doc.currency,
        amountDue: doc.amountDue,
        portalToken: doc.portalToken!,
      },
      client: {
        companyName: client.companyName,
        contactName: client.contactName,
        email: client.email,
      },
    });

    // Record session ID in document
    await db
      .update(documents)
      .set({
        stripeCheckoutSessionId: session.sessionId,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    return c.json({
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
    });
  } catch (err: any) {
    console.error('[Portal Checkout] Failed to create Stripe session:', err);
    return c.json({ error: err.message || 'Payment provider error' }, 500);
  }
});

const acceptEstimateSchema = z.object({
  signatureName: z.string().trim().min(2, 'Full signature name is required'),
  email: z.string().trim().email('Valid email address required').optional(),
});

/**
 * 1-Click Estimate Acceptance by Client
 * Marks estimate accepted, auto-creates linked invoice, and alerts business owner
 */
portalRoutes.post('/:token/accept', zValidator('json', acceptEstimateSchema), async (c) => {
  const db = c.get('db');
  const token = c.req.param('token');
  const { signatureName, email } = c.req.valid('json');

  const [estimate] = await db
    .select()
    .from(documents)
    .where(eq(documents.portalToken, token))
    .limit(1);

  if (!estimate || estimate.type !== 'estimate') {
    return c.json({ error: 'Estimate not found' }, 404);
  }

  if (['accepted', 'converted'].includes(estimate.status)) {
    return c.json({ error: 'This quote has already been accepted.' }, 400);
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, estimate.clientId)).limit(1);
  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  const signerEmail = email || client.email;
  const now = new Date();

  // 1. Mark estimate as accepted
  await db
    .update(documents)
    .set({
      status: 'accepted',
      acceptedAt: now,
      acceptedBySignature: signatureName,
      acceptedByEmail: signerEmail,
      updatedAt: now,
    })
    .where(eq(documents.id, estimate.id));

  // 2. Generate linked invoice
  const currentYear = now.getFullYear();
  const allDocs = await db.select({ documentNumber: documents.documentNumber }).from(documents);
  const invoiceNumbers = allDocs
    .map((d) => d.documentNumber)
    .filter((num) => num.startsWith(`INV-${currentYear}-`));

  let maxSeq = 0;
  for (const num of invoiceNumbers) {
    const parts = num.split('-');
    if (parts.length === 3) {
      const seq = parseInt(parts[2], 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  const invoiceNumber = `INV-${currentYear}-${nextSeq}`;

  const issueDate = now.toISOString().slice(0, 10);
  const paymentDays = client.paymentTermsDays ?? 30;
  const dueDateObj = new Date(now.getTime() + paymentDays * 24 * 60 * 60 * 1000);
  const dueDate = dueDateObj.toISOString().slice(0, 10);

  const newInvoiceId = `doc_inv_${crypto.randomUUID()}`;
  const newPortalToken = generatePortalToken();

  await db.insert(documents).values({
    id: newInvoiceId,
    documentNumber: invoiceNumber,
    type: 'invoice',
    status: 'draft',
    clientId: estimate.clientId,
    templateId: estimate.templateId,
    sourceEstimateId: estimate.id,
    portalToken: newPortalToken,
    portalTokenCreatedAt: now,
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
    terms: estimate.terms,
    createdBy: estimate.createdBy,
    createdAt: now,
    updatedAt: now,
  });

  // Copy estimate line items to new invoice
  const estimateItems = await db
    .select()
    .from(documentItems)
    .where(eq(documentItems.documentId, estimate.id))
    .orderBy(asc(documentItems.sortOrder));

  for (const item of estimateItems) {
    await db.insert(documentItems).values({
      id: `item_${crypto.randomUUID()}`,
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
    });
  }

  // Update estimate with converted invoice reference
  await db
    .update(documents)
    .set({
      convertedToDocumentId: newInvoiceId,
      updatedAt: now,
    })
    .where(eq(documents.id, estimate.id));

  // 3. Record audit log
  await recordAuditLog({
    db,
    user: null,
    action: 'estimate.accepted_via_portal',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      documentNumber: estimate.documentNumber,
      signatureName,
      signerEmail,
      convertedToInvoiceNumber: invoiceNumber,
    },
  });

  // 4. Send email notification to business owner
  const adminEmail = c.env.ADMIN_NOTIFICATION_EMAIL || c.env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com';
  if (c.env.EMAIL) {
    try {
      const msg = createMimeMessage();
      msg.setSender({ name: 'PocketCRM Notifications', addr: c.env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com' });
      msg.setRecipient({ name: 'Administrator', addr: adminEmail });
      msg.setSubject(`[Accepted Quote] #${estimate.documentNumber} from ${client.companyName}`);
      msg.addMessage({
        contentType: 'text/html',
        data: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #16a34a;">🎉 Quote #${estimate.documentNumber} Accepted!</h2>
            <p><strong>${signatureName}</strong> (${signerEmail}) from <strong>${client.companyName}</strong> has accepted estimate <strong>#${estimate.documentNumber}</strong> for <strong>$${estimate.total.toFixed(2)} ${estimate.currency}</strong>.</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0;"><strong>Linked Draft Invoice:</strong> #${invoiceNumber}</p>
              <p style="margin: 0;"><strong>Accepted At:</strong> ${now.toLocaleString()}</p>
            </div>
            <p>The draft invoice is ready for your review in PocketCRM.</p>
          </div>
        `,
      });
      const rawMime = msg.asRaw();
      const cfMsg = new EmailMessage(c.env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com', adminEmail, rawMime);
      await c.env.EMAIL.send(cfMsg);
    } catch (emailErr) {
      console.warn('[Portal Accept] Notification email failed:', emailErr);
    }
  }

  return c.json({
    success: true,
    message: `Quote #${estimate.documentNumber} accepted! Invoice #${invoiceNumber} has been automatically prepared.`,
    invoiceNumber,
    invoiceId: newInvoiceId,
  });
});
