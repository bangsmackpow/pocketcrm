import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';
import type { CloudflareBindings } from './auth';
import type { DocumentRenderContext } from './pdf';
import { generateDocumentPdfBuffer, formatMoney } from './pdf';

export interface SendDocumentEmailOptions {
  env: CloudflareBindings;
  ctx: DocumentRenderContext;
  recipientEmail: string;
  recipientName?: string;
  subject?: string;
  customMessage?: string;
  senderEmail?: string;
  senderName?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

/**
 * Builds a clean, responsive HTML email for invoices and estimates
 */
function buildDocumentEmailHtml(options: {
  ctx: DocumentRenderContext;
  recipientName: string;
  customMessage?: string;
  companyName: string;
  portalUrl?: string;
}): string {
  const { ctx, recipientName, customMessage, companyName, portalUrl } = options;
  const { document: doc, client, items, template } = ctx;
  const isInvoice = doc.type === 'invoice';
  const docTypeLabel = isInvoice ? 'Invoice' : 'Estimate / Quote';
  const paymentInstructions = template?.paymentInstructions || 'Please remit payment according to agreed terms.';

  const itemRowsHtml = items
    .map(
      (item) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 12px; font-size: 14px; color: #1e293b;">
          <strong>${escapeHtml(item.name)}</strong>
          ${item.description ? `<br><span style="font-size: 12px; color: #64748b;">${escapeHtml(item.description)}</span>` : ''}
        </td>
        <td style="padding: 10px 12px; font-size: 14px; text-align: center; color: #475569;">${item.quantity} ${escapeHtml(item.unit)}</td>
        <td style="padding: 10px 12px; font-size: 14px; text-align: right; color: #475569;">${formatMoney(item.unitPrice, doc.currency)}</td>
        <td style="padding: 10px 12px; font-size: 14px; text-align: right; font-weight: 600; color: #0f172a;">${formatMoney(item.lineTotal, doc.currency)}</td>
      </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docTypeLabel} ${escapeHtml(doc.documentNumber)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <!-- Header -->
    <div style="background: #0f172a; padding: 28px 32px; color: #ffffff;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td>
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; font-weight: 600;">${escapeHtml(companyName)}</div>
            <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: #ffffff;">${docTypeLabel} #${escapeHtml(doc.documentNumber)}</div>
          </td>
          <td style="text-align: right;">
            <span style="display: inline-block; padding: 6px 14px; background: #2563eb; color: #ffffff; font-size: 12px; font-weight: 700; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em;">
              ${escapeHtml(doc.status.toUpperCase())}
            </span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding: 32px;">
      <p style="font-size: 15px; line-height: 1.6; margin-top: 0; color: #334155;">
        Dear <strong>${escapeHtml(recipientName || client.companyName)}</strong>,
      </p>

      ${
        customMessage
          ? `<div style="padding: 14px 18px; background: #f1f5f9; border-left: 4px solid #2563eb; border-radius: 4px; font-size: 14px; color: #334155; margin-bottom: 24px; line-height: 1.5;">${escapeHtml(customMessage)}</div>`
          : `<p style="font-size: 14px; color: #475569; line-height: 1.5;">Please review the summary for ${docTypeLabel.toLowerCase()} <strong>${escapeHtml(doc.documentNumber)}</strong> below. A PDF copy is attached for your records.</p>`
      }

      <!-- Quick Metrics -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
        <tr>
          <td style="padding: 14px; border-right: 1px solid #e2e8f0; width: 33%;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Issue Date</div>
            <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-top: 2px;">${escapeHtml(doc.issueDate)}</div>
          </td>
          <td style="padding: 14px; border-right: 1px solid #e2e8f0; width: 33%;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Due Date</div>
            <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-top: 2px;">${escapeHtml(doc.dueDate)}</div>
          </td>
          <td style="padding: 14px; width: 34%;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">${isInvoice ? 'Balance Due' : 'Estimated Total'}</div>
            <div style="font-size: 16px; font-weight: 700; color: #2563eb; margin-top: 2px;">${formatMoney(isInvoice ? doc.amountDue : doc.total, doc.currency)}</div>
          </td>
        </tr>
      </table>

      <!-- Items Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: #f1f5f9; text-align: left;">
            <th style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #475569;">Item</th>
            <th style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #475569; text-align: center;">Qty</th>
            <th style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #475569; text-align: right;">Rate</th>
            <th style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #475569; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml}
        </tbody>
      </table>

      <!-- Totals Breakdown -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="width: 55%;"></td>
          <td style="width: 45%;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Subtotal:</td>
                <td style="padding: 4px 0; text-align: right; font-weight: 500;">${formatMoney(doc.subtotal, doc.currency)}</td>
              </tr>
              ${
                doc.discountTotal > 0
                  ? `<tr>
                      <td style="padding: 4px 0; color: #16a34a;">Discount:</td>
                      <td style="padding: 4px 0; text-align: right; color: #16a34a;">-${formatMoney(doc.discountTotal, doc.currency)}</td>
                    </tr>`
                  : ''
              }
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Tax Total:</td>
                <td style="padding: 4px 0; text-align: right; font-weight: 500;">${formatMoney(doc.taxTotal, doc.currency)}</td>
              </tr>
              <tr style="border-top: 2px solid #0f172a;">
                <td style="padding: 8px 0; font-size: 15px; font-weight: 700; color: #0f172a;">Grand Total:</td>
                <td style="padding: 8px 0; text-align: right; font-size: 15px; font-weight: 700; color: #0f172a;">${formatMoney(doc.total, doc.currency)}</td>
              </tr>
              ${
                isInvoice && doc.amountPaid > 0
                  ? `<tr>
                      <td style="padding: 4px 0; color: #16a34a;">Amount Paid:</td>
                      <td style="padding: 4px 0; text-align: right; color: #16a34a;">-${formatMoney(doc.amountPaid, doc.currency)}</td>
                    </tr>
                    <tr style="border-top: 1px solid #e2e8f0;">
                      <td style="padding: 6px 0; font-size: 14px; font-weight: 700; color: #2563eb;">Balance Due:</td>
                      <td style="padding: 6px 0; text-align: right; font-size: 14px; font-weight: 700; color: #2563eb;">${formatMoney(doc.amountDue, doc.currency)}</td>
                    </tr>`
                  : ''
              }
            </table>
          </td>
        </tr>
      </table>

      <!-- Remittance / Payment Instructions -->
      <div style="margin-top: 24px; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; color: #475569;">
        <div style="font-weight: 600; color: #0f172a; margin-bottom: 4px;">Payment Remittance Instructions:</div>
        <div>${escapeHtml(paymentInstructions)}</div>
      </div>

      ${
        portalUrl
          ? `<!-- Review & Pay / View Estimate CTA Button -->
      <div style="text-align: center; margin: 32px 0 16px 0;">
        <a href="${portalUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.25);">
          ${isInvoice ? 'Review &amp; Pay Invoice Online &rarr;' : 'Review &amp; Accept Quote Online &rarr;'}
        </a>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 8px;">No login required &bull; Fast, secure checkout</div>
      </div>`
          : ''
      }
    </div>

    <!-- Footer -->
    <div style="background: #f1f5f9; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #64748b;">
      <div>Thank you for your business.</div>
      <div style="margin-top: 4px;">For billing inquiries, reply directly to this email.</div>
    </div>

  </div>
</body>
</html>`;
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Dispatches an invoice or estimate via Cloudflare Workers send_email binding.
 */
export async function sendDocumentEmail(options: SendDocumentEmailOptions): Promise<EmailSendResult> {
  try {
    const {
      env,
      ctx,
      recipientEmail,
      recipientName = ctx.client.contactName || ctx.client.companyName,
      customMessage,
      subject: explicitSubject,
    } = options;

    const doc = ctx.document;
    const isInvoice = doc.type === 'invoice';
    const docTypeLabel = isInvoice ? 'Invoice' : 'Estimate';
    
    // Sender email and name
    const senderEmail = options.senderEmail || env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com';
    const senderName = options.senderName || env.EMAIL_FROM_NAME || 'Built Networks Invoicing';

    const defaultSubject = `[${docTypeLabel}] #${doc.documentNumber} from ${senderName}`;
    const subject = explicitSubject || defaultSubject;

    // Verify recipient
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return { success: false, error: 'A valid recipient email address is required.' };
    }

    // Generate PDF attachment
    const pdfBuffer = await generateDocumentPdfBuffer({
      ...ctx,
      storage: env.STORAGE,
    });
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    const filename = `${doc.documentNumber}.pdf`;

    const baseUrl = env.BETTER_AUTH_URL || 'https://pocketcrm.builtnetworks.com';
    const portalUrl = doc.portalToken ? `${baseUrl}/portal/${doc.portalToken}` : undefined;

    // Build HTML email body
    const htmlContent = buildDocumentEmailHtml({
      ctx,
      recipientName,
      customMessage,
      companyName: senderName,
      portalUrl,
    });

    // Build Plain Text fallback
    const plainText = [
      `${senderName} - ${docTypeLabel} #${doc.documentNumber}`,
      `--------------------------------------------------`,
      `Recipient: ${recipientName} (${ctx.client.companyName})`,
      `Issue Date: ${doc.issueDate}  |  Due Date: ${doc.dueDate}`,
      `Total: ${formatMoney(doc.total, doc.currency)}`,
      isInvoice ? `Balance Due: ${formatMoney(doc.amountDue, doc.currency)}` : '',
      portalUrl ? `\nView & Pay Online:\n${portalUrl}\n` : '',
      customMessage ? `Note: ${customMessage}\n` : '',
      `Payment Instructions: ${ctx.template?.paymentInstructions || 'See attached PDF'}`,
      '',
      `Please find your official PDF attached as ${filename}.`,
    ]
      .filter(Boolean)
      .join('\n');

    // Construct MIME message using mimetext
    const msg = createMimeMessage();
    msg.setSender({ name: senderName, addr: senderEmail });
    msg.setRecipient({ name: recipientName, addr: recipientEmail });
    msg.setSubject(subject);

    // Plain text fallback
    msg.addMessage({
      contentType: 'text/plain',
      data: plainText,
    });

    // Rich HTML body
    msg.addMessage({
      contentType: 'text/html',
      data: htmlContent,
    });

    // PDF Attachment
    msg.addAttachment({
      filename,
      contentType: 'application/pdf',
      data: pdfBase64,
      encoding: 'base64',
    });

    // Check if native Cloudflare send_email binding is active
    if (!env.EMAIL) {
      console.warn(`[PocketCRM Native Email] env.EMAIL binding is not active in current environment. Simulated email sent to ${recipientEmail}`);
      return {
        success: true,
        simulated: true,
        messageId: `sim_${Date.now()}`,
      };
    }

    try {
      const rawMime = msg.asRaw();
      const cloudflareMessage = new EmailMessage(senderEmail, recipientEmail, rawMime);
      await env.EMAIL.send(cloudflareMessage);

      return {
        success: true,
        messageId: `cf_${Date.now()}`,
      };
    } catch (err: any) {
      console.error('[PocketCRM Native Email] Cloudflare Email Send failed:', err);
      return {
        success: false,
        error: err.message || 'Cloudflare Native Email dispatch failed. Please verify Email Routing is enabled for builtnetworks.com in Cloudflare Dashboard.',
      };
    }
  } catch (err: any) {
    console.error('[PocketCRM Native Email] Document email generation or assembly failed:', err);
    return {
      success: false,
      error: err.message || 'Failed to generate document or assemble email message.',
    };
  }
}
