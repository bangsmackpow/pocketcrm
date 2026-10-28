/**
 * Pure Edge-native Stripe Integration for Cloudflare Workers
 * Uses Web Standard Fetch & Web Crypto APIs (zero Node.js dependencies)
 */

export interface StripeCheckoutParams {
  secretKey: string;
  baseUrl: string;
  document: {
    id: string;
    documentNumber: string;
    currency: string;
    amountDue: number;
    portalToken: string;
  };
  client: {
    companyName: string;
    contactName: string;
    email: string;
  };
}

export interface StripeCheckoutResult {
  sessionId: string;
  checkoutUrl: string;
}

/**
 * Creates a Stripe Checkout Session via Stripe REST API
 */
export async function createStripeCheckoutSession(
  params: StripeCheckoutParams
): Promise<StripeCheckoutResult> {
  const { secretKey, baseUrl, document: doc, client } = params;

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured in worker environment.');
  }

  const unitAmountCents = Math.round(doc.amountDue * 100);
  if (unitAmountCents <= 0) {
    throw new Error('Invoice amount due must be greater than zero to initiate checkout.');
  }

  const formData = new URLSearchParams();
  formData.append('mode', 'payment');
  formData.append('success_url', `${baseUrl}/portal/${doc.portalToken}?payment=success&session_id={CHECKOUT_SESSION_ID}`);
  formData.append('cancel_url', `${baseUrl}/portal/${doc.portalToken}?payment=cancelled`);
  formData.append('client_reference_id', doc.id);
  formData.append('customer_email', client.email);
  formData.append('metadata[document_id]', doc.id);
  formData.append('metadata[document_number]', doc.documentNumber);
  formData.append('metadata[portal_token]', doc.portalToken);

  // Line item representing the balance due
  formData.append('line_items[0][price_data][currency]', doc.currency.toLowerCase());
  formData.append('line_items[0][price_data][product_data][name]', `Invoice #${doc.documentNumber}`);
  formData.append('line_items[0][price_data][product_data][description]', `Payment from ${client.companyName} for Invoice #${doc.documentNumber}`);
  formData.append('line_items[0][price_data][unit_amount]', unitAmountCents.toString());
  formData.append('line_items[0][quantity]', '1');

  // Supported payment rails: Credit Card & ACH Direct Debit
  formData.append('payment_method_types[0]', 'card');
  formData.append('payment_method_types[1]', 'us_bank_account');

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  const data = (await resp.json()) as any;
  if (!resp.ok) {
    const errMsg = data?.error?.message || `Stripe API error (${resp.status})`;
    throw new Error(errMsg);
  }

  return {
    sessionId: data.id,
    checkoutUrl: data.url,
  };
}

/**
 * Verifies a Stripe Webhook signature using Web Crypto HMAC-SHA256
 */
export async function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null | undefined,
  secret: string,
  toleranceSeconds = 300
): Promise<boolean> {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = signatureHeader.split(',');
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.trim().split('=');
    if (key === 't') {
      timestamp = value;
    } else if (key === 'v1') {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  // Check timestamp tolerance
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestampNum) || Math.abs(now - timestampNum) > toleranceSeconds) {
    console.warn('[Stripe Webhook] Timestamp outside tolerance window');
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const enc = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
    const computedHex = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return signatures.some((sig) => sig.toLowerCase() === computedHex.toLowerCase());
  } catch (err) {
    console.error('[Stripe Webhook] Crypto signature verification failure:', err);
    return false;
  }
}
