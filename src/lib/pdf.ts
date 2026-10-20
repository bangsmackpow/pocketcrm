import type {
  clients,
  documents,
  documentItems,
  documentTemplates,
  DocumentTemplateStyles,
} from '../db/schema';

export type ClientRecord = typeof clients.$inferSelect;
export type DocumentRecord = typeof documents.$inferSelect;
export type DocumentItemRecord = typeof documentItems.$inferSelect;
export type TemplateRecord = typeof documentTemplates.$inferSelect;

export interface DocumentRenderContext {
  document: DocumentRecord;
  client: ClientRecord;
  items: DocumentItemRecord[];
  template?: TemplateRecord | null;
}

const DEFAULT_STYLES: DocumentTemplateStyles = {
  primaryColor: '#0f172a',
  accentColor: '#2563eb',
  fontFamily: 'Inter, system-ui, sans-serif',
  headerBg: '#f8fafc',
  tableBorderColor: '#e2e8f0',
  customCssVars: {
    '--doc-border-radius': '8px',
    '--doc-header-padding': '24px',
  },
};

function escapeHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');
}

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Generates a styled HTML representation of an Invoice or Estimate honoring
 * all configurable template settings (custom CSS variables, logo placement,
 * payment instructions, and legal footer clauses).
 */
export function renderDocumentTemplateHtml(ctx: DocumentRenderContext): string {
  const { document: doc, client, items, template } = ctx;
  const styles = template?.styles ?? DEFAULT_STYLES;
  const logoPlacement = template?.logoPlacement ?? 'left';
  const companyHeader =
    template?.companyHeaderText ??
    'PocketCRM Cloud Enterprise LLC\n742 Evergreen Terrace, Suite 400\nAustin, TX 78701';
  const paymentInstructions =
    template?.paymentInstructions ??
    'Wire / ACH transfer due within terms. Please reference Document Number on remittance.';
  const footerLegal =
    template?.footerLegalClause ??
    'Thank you for your business. Past-due balances are subject to a 1.5% monthly late fee.';

  const customVarsCss = Object.entries(styles.customCssVars || {})
    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)};`)
    .join(' ');

  const docTitle = doc.type === 'estimate' ? 'ESTIMATE / QUOTE' : 'INVOICE';
  const justifyLogo =
    logoPlacement === 'center'
      ? 'center'
      : logoPlacement === 'right'
      ? 'flex-end'
      : 'flex-start';

  const rowsHtml = items
    .map(
      (item, idx) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid var(--table-border);">${idx + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--table-border);">
          <div style="font-weight:600;color:var(--primary-color);">${escapeHtml(item.name)}</div>
          ${
            item.description
              ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(item.description)}</div>`
              : ''
          }
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--table-border);text-align:right;">${item.quantity} ${escapeHtml(item.unit)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--table-border);text-align:right;">${formatMoney(item.unitPrice, doc.currency)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--table-border);text-align:right;">${item.taxRate}%${item.taxCompound ? ' (C)' : ''}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--table-border);text-align:right;font-weight:600;">${formatMoney(item.lineTotal, doc.currency)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(docTitle)} ${escapeHtml(doc.documentNumber)}</title>
  <style>
    :root {
      --primary-color: ${escapeHtml(styles.primaryColor)};
      --accent-color: ${escapeHtml(styles.accentColor)};
      --font-family: ${escapeHtml(styles.fontFamily)};
      --header-bg: ${escapeHtml(styles.headerBg)};
      --table-border: ${escapeHtml(styles.tableBorderColor)};
      ${customVarsCss}
    }
    body {
      font-family: var(--font-family);
      color: var(--primary-color);
      margin: 0;
      padding: 32px;
      background: #ffffff;
      line-height: 1.5;
    }
    .doc-card {
      max-width: 840px;
      margin: 0 auto;
      border: 1px solid var(--table-border);
      border-radius: var(--doc-border-radius, 8px);
      overflow: hidden;
    }
    .doc-header {
      background: var(--header-bg);
      padding: var(--doc-header-padding, 24px);
      border-bottom: 1px solid var(--table-border);
    }
    .logo-row {
      display: flex;
      justify-content: ${justifyLogo};
      margin-bottom: 16px;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--accent-color);
      color: #fff;
      font-weight: 700;
      padding: 8px 16px;
      border-radius: 6px;
      letter-spacing: 0.04em;
    }
    .meta-grid {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 24px;
    }
    .status-chip {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      background: var(--accent-color);
      color: #ffffff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      background: var(--header-bg);
      color: var(--primary-color);
      text-align: left;
      padding: 10px 12px;
      border-bottom: 2px solid var(--table-border);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .totals-box {
      width: 280px;
      margin-left: auto;
      margin-top: 20px;
      font-size: 13px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
    }
    .totals-row.grand {
      border-top: 2px solid var(--primary-color);
      font-size: 16px;
      font-weight: 700;
      color: var(--accent-color);
      padding-top: 10px;
      margin-top: 6px;
    }
    .footer-section {
      padding: 20px 24px;
      background: var(--header-bg);
      border-top: 1px solid var(--table-border);
      font-size: 12px;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="doc-card">
    <div class="doc-header">
      <div class="logo-row">
        <div class="brand-badge">POCKETCRM • ${escapeHtml(docTitle)}</div>
      </div>
      <div class="meta-grid">
        <div style="white-space:pre-line;font-size:13px;">${escapeHtml(companyHeader)}</div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:800;color:var(--accent-color);">${escapeHtml(doc.documentNumber)}</div>
          <div style="margin:6px 0;"><span class="status-chip">${escapeHtml(doc.status)}</span></div>
          <div style="font-size:12px;color:#475569;">Issue Date: <strong>${escapeHtml(doc.issueDate)}</strong></div>
          <div style="font-size:12px;color:#475569;">Due Date: <strong>${escapeHtml(doc.dueDate)}</strong></div>
        </div>
      </div>
    </div>

    <div style="padding:24px;">
      <div style="margin-bottom:20px;font-size:13px;">
        <div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;">Billed To</div>
        <div style="font-size:15px;font-weight:700;margin-top:2px;">${escapeHtml(client.companyName)} (${escapeHtml(client.code)})</div>
        <div>Attn: ${escapeHtml(client.contactName)} • ${escapeHtml(client.email)}</div>
        <div>${escapeHtml(client.billingAddress?.line1)}, ${escapeHtml(client.billingAddress?.city)}, ${escapeHtml(client.billingAddress?.state)} ${escapeHtml(client.billingAddress?.postalCode)}, ${escapeHtml(client.billingAddress?.country)}</div>
        ${client.taxIdentifier ? `<div>Tax ID: ${escapeHtml(client.taxIdentifier)}</div>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:36px;">#</th>
            <th>Item & Description</th>
            <th style="text-align:right;">Qty</th>
            <th style="text-align:right;">Unit Price</th>
            <th style="text-align:right;">Tax</th>
            <th style="text-align:right;">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="totals-box">
        <div class="totals-row"><span>Subtotal</span><span>${formatMoney(doc.subtotal, doc.currency)}</span></div>
        <div class="totals-row"><span>Discount</span><span>-${formatMoney(doc.discountTotal, doc.currency)}</span></div>
        <div class="totals-row"><span>Tax Total</span><span>${formatMoney(doc.taxTotal, doc.currency)}</span></div>
        <div class="totals-row grand"><span>Total</span><span>${formatMoney(doc.total, doc.currency)}</span></div>
        ${
          doc.type === 'invoice'
            ? `<div class="totals-row"><span>Amount Paid</span><span>${formatMoney(doc.amountPaid, doc.currency)}</span></div>
               <div class="totals-row" style="font-weight:700;"><span>Balance Due</span><span>${formatMoney(doc.amountDue, doc.currency)}</span></div>`
            : ''
        }
      </div>

      ${
        doc.notes
          ? `<div style="margin-top:20px;font-size:12px;"><strong>Notes:</strong> ${escapeHtml(doc.notes)}</div>`
          : ''
      }
    </div>

    <div class="footer-section">
      <div style="margin-bottom:8px;"><strong>Payment Instructions:</strong><br/>${escapeHtml(paymentInstructions)}</div>
      <div style="font-size:11px;color:#64748b;">${escapeHtml(footerLegal)}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates a valid, self-contained PDF 1.4 binary document on Cloudflare Workers edge
 * without requiring native canvas or headless browser dependencies.
 */
export function generateDocumentPdfBuffer(ctx: DocumentRenderContext): Uint8Array {
  const { document: doc, client, items, template } = ctx;
  const docTitle = doc.type === 'estimate' ? 'ESTIMATE / QUOTE' : 'INVOICE';

  const lines: string[] = [
    `POCKETCRM - ${docTitle} #${doc.documentNumber}`,
    `Status: ${doc.status.toUpperCase()}   |   Issue Date: ${doc.issueDate}   |   Due Date: ${doc.dueDate}`,
    `--------------------------------------------------------------------------------`,
    `Client: ${client.companyName} (${client.code}) - Attn: ${client.contactName}`,
    `Email: ${client.email}   |   Tax ID: ${client.taxIdentifier || 'N/A'}`,
    `Address: ${client.billingAddress?.line1 || ''}, ${client.billingAddress?.city || ''} ${client.billingAddress?.postalCode || ''}`,
    `--------------------------------------------------------------------------------`,
    `LINE ITEMS:`,
  ];

  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.name}  [Qty: ${item.quantity} ${item.unit} @ ${formatMoney(item.unitPrice, doc.currency)} | Tax: ${item.taxRate}%]  = ${formatMoney(item.lineTotal, doc.currency)}`
    );
    if (item.description) {
      lines.push(`    ${item.description.slice(0, 90)}`);
    }
  });

  lines.push(
    `--------------------------------------------------------------------------------`,
    `Subtotal:       ${formatMoney(doc.subtotal, doc.currency)}`,
    `Discount Total: -${formatMoney(doc.discountTotal, doc.currency)}`,
    `Tax Total:      ${formatMoney(doc.taxTotal, doc.currency)}`,
    `GRAND TOTAL:    ${formatMoney(doc.total, doc.currency)}`
  );

  if (doc.type === 'invoice') {
    lines.push(
      `Amount Paid:    ${formatMoney(doc.amountPaid, doc.currency)}`,
      `Balance Due:    ${formatMoney(doc.amountDue, doc.currency)}`
    );
  }

  if (template?.paymentInstructions) {
    lines.push(
      `--------------------------------------------------------------------------------`,
      `Payment Instructions: ${template.paymentInstructions.replace(/\r?\n/g, ' ')}`
    );
  }
  if (template?.footerLegalClause) {
    lines.push(`Terms: ${template.footerLegalClause.replace(/\r?\n/g, ' ')}`);
  }

  // Construct PDF content stream commands
  let y = 750;
  const streamCommands: string[] = ['BT', '/F1 10 Tf'];
  for (const line of lines) {
    if (y < 50) break;
    streamCommands.push(`1 0 0 1 45 ${y} Tm (${escapePdfText(line)}) Tj`);
    y -= 16;
  }
  streamCommands.push('ET');
  const streamBody = streamCommands.join('\n');

  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
