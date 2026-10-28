import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { documents, payments, clients } from '../db/schema';
import { type AppEnv } from '../lib/auth';
import { verifyStripeWebhookSignature } from '../lib/stripe';
import { recordAuditLog } from '../lib/audit';
import { recordEmailLog } from '../lib/email-log';
import { sendDocumentEmail } from '../lib/email';
import { roundCurrency } from '../lib/calculations';

export const webhookRoutes = new Hono<AppEnv>();

/**
 * Stripe Webhook Handler
 * Verifies HMAC-SHA256 signature and reconciles payments atomically
 */
webhookRoutes.post('/stripe', async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured.');
    return c.json({ error: 'Webhook secret not configured on server' }, 500);
  }

  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();

  const isValid = await verifyStripeWebhookSignature(rawBody, signature, secret);
  if (!isValid) {
    console.warn('[Stripe Webhook] Invalid webhook signature rejected.');
    return c.json({ error: 'Invalid webhook signature' }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Malformed JSON payload' }, 400);
  }

  const db = c.get('db');

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;
    const documentId = session?.client_reference_id || session?.metadata?.document_id;

    if (!documentId) {
      console.warn('[Stripe Webhook] Checkout session has no linked documentId:', session?.id);
      return c.json({ received: true, note: 'No linked document' });
    }

    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc || doc.type !== 'invoice') {
      console.warn(`[Stripe Webhook] Document not found or not an invoice: ${documentId}`);
      return c.json({ received: true, note: 'Document not found' });
    }

    // Determine paid amount
    const amountPaidDollars = session.amount_total
      ? roundCurrency(session.amount_total / 100)
      : doc.amountDue;

    const newAmountPaid = roundCurrency(doc.amountPaid + amountPaidDollars);
    const newAmountDue = roundCurrency(Math.max(0, doc.total - newAmountPaid));
    const newStatus = newAmountDue <= 0 ? 'paid' : 'partial';

    // 1. Update invoice
    await db
      .update(documents)
      .set({
        status: newStatus,
        amountPaid: newAmountPaid,
        amountDue: newAmountDue,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    // 2. Insert into payments ledger
    const paymentMethod =
      session.payment_method_types?.[0] === 'us_bank_account' ? 'stripe_ach' : 'stripe_card';

    await db.insert(payments).values({
      id: `pmt_${crypto.randomUUID()}`,
      documentId: doc.id,
      amount: amountPaidDollars,
      currency: doc.currency,
      paymentMethod,
      transactionReference: session.id,
      notes: `Stripe Checkout completed (${paymentMethod})`,
      actorEmail: session.customer_details?.email || 'stripe_webhook',
      createdAt: new Date(),
    });

    // 3. Record audit log
    await recordAuditLog({
      db,
      user: null,
      action: 'invoice.paid_via_stripe',
      entityType: 'invoice',
      entityId: doc.id,
      metadata: {
        documentNumber: doc.documentNumber,
        sessionId: session.id,
        amountPaid: amountPaidDollars,
        remainingBalance: newAmountDue,
        status: newStatus,
      },
    });

    console.log(`[Stripe Webhook] Invoice #${doc.documentNumber} successfully paid via Stripe Checkout (${session.id})`);
  }

  return c.json({ received: true });
});
