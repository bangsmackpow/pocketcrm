import { PDFDocument, StandardFonts, rgb, RGB, PDFPage, PDFFont } from 'pdf-lib';
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

function hexToRgb(hex: string | undefined | null, defaultRgb: RGB): RGB {
  if (!hex || !hex.startsWith('#')) return defaultRgb;
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return rgb(r, g, b);
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
  }
  return defaultRgb;
}

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    const words = para.split(' ');
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function drawTextRight(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: rightX - width,
    y,
    font,
    size,
    color,
  });
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
        ${
          template?.logoUrl
            ? `<img src="${escapeHtml(template.logoUrl)}" alt="Logo" style="max-height: 54px; max-width: 220px; object-fit: contain;" />`
            : `<div class="brand-badge">POCKETCRM • ${escapeHtml(docTitle)}</div>`
        }
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
 * Generates an executive, publication-grade PDF 1.4 binary document on Cloudflare Workers edge
 * using pdf-lib with styled vector layout, typography, status badges, itemized tables, and totals.
 */
export async function generateDocumentPdfBuffer(ctx: DocumentRenderContext): Promise<Uint8Array> {
  const { document: doc, client, items, template } = ctx;
  const styles = template?.styles ?? DEFAULT_STYLES;

  const pdfDoc = await PDFDocument.create();

  // Standard Type 1 fonts
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // US Letter geometry: 612 x 792 pt
  const pageWidth = 612;
  const pageHeight = 792;
  const marginX = 40;
  const contentWidth = pageWidth - marginX * 2; // 532 pt

  // Colors
  const accentColor = hexToRgb(styles.accentColor, rgb(0.15, 0.39, 0.92));
  const lightBgColor = hexToRgb(styles.headerBg, rgb(0.97, 0.98, 0.99));
  const borderColor = hexToRgb(styles.tableBorderColor, rgb(0.89, 0.91, 0.94));
  const mutedTextColor = rgb(0.39, 0.45, 0.55);
  const darkTextColor = rgb(0.06, 0.09, 0.16);
  const whiteColor = rgb(1, 1, 1);
  const emeraldColor = rgb(0.06, 0.62, 0.43);
  const slateRowBg = rgb(0.98, 0.99, 1.0);

  const docTitle = doc.type === 'estimate' ? 'ESTIMATE / QUOTE' : 'INVOICE';
  const companyHeader =
    template?.companyHeaderText ??
    'PocketCRM Cloud Enterprise LLC\n742 Evergreen Terrace, Suite 400\nAustin, TX 78701';
  const paymentInstructions =
    template?.paymentInstructions ??
    'Wire / ACH transfer due within terms. Please reference Document Number on remittance.';
  const footerLegal =
    template?.footerLegalClause ??
    'Thank you for your business. Past-due balances are subject to a 1.5% monthly late fee.';

  // Attempt to embed logo image if present
  let logoImage: any = null;
  if (template?.logoUrl) {
    try {
      if (template.logoUrl.startsWith('data:image/png;base64,')) {
        const base64 = template.logoUrl.replace('data:image/png;base64,', '');
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        logoImage = await pdfDoc.embedPng(bytes);
      } else if (
        template.logoUrl.startsWith('data:image/jpeg;base64,') ||
        template.logoUrl.startsWith('data:image/jpg;base64,')
      ) {
        const base64 = template.logoUrl.replace(/^data:image\/(jpeg|jpg);base64,/, '');
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        logoImage = await pdfDoc.embedJpg(bytes);
      } else if (template.logoUrl.startsWith('http://') || template.logoUrl.startsWith('https://')) {
        const resp = await fetch(template.logoUrl);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          const bytes = new Uint8Array(ab);
          const ctype = resp.headers.get('content-type') || '';
          if (ctype.includes('jpeg') || ctype.includes('jpg')) {
            logoImage = await pdfDoc.embedJpg(bytes);
          } else {
            logoImage = await pdfDoc.embedPng(bytes);
          }
        }
      }
    } catch {
      logoImage = null;
    }
  }

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let currentY = 750;

  // 1. Header Card (Background card with logo + company info + doc metadata)
  const headerCardHeight = 100;
  const headerCardY = currentY - headerCardHeight;
  currentPage.drawRectangle({
    x: marginX,
    y: headerCardY,
    width: contentWidth,
    height: headerCardHeight,
    color: lightBgColor,
    borderColor: borderColor,
    borderWidth: 1,
  });

  // Top Left: Logo or Brand Badge
  if (logoImage) {
    const scale = Math.min(180 / logoImage.width, 42 / logoImage.height, 1);
    const logoW = logoImage.width * scale;
    const logoH = logoImage.height * scale;
    currentPage.drawImage(logoImage, {
      x: marginX + 16,
      y: headerCardY + headerCardHeight - 16 - logoH,
      width: logoW,
      height: logoH,
    });
  } else {
    // Brand Badge Pill
    const badgeW = 160;
    const badgeH = 24;
    const badgeX = marginX + 16;
    const badgeY = headerCardY + headerCardHeight - 16 - badgeH;
    currentPage.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeW,
      height: badgeH,
      color: accentColor,
    });
    currentPage.drawText(`POCKETCRM • ${docTitle}`, {
      x: badgeX + 10,
      y: badgeY + 7,
      font: fontBold,
      size: 9,
      color: whiteColor,
    });
  }

  // Company info below logo
  const companyLines = companyHeader.split(/\r?\n/);
  let compY = headerCardY + 36;
  for (const cLine of companyLines.slice(0, 3)) {
    if (!cLine.trim()) continue;
    currentPage.drawText(cLine.trim(), {
      x: marginX + 16,
      y: compY,
      font: fontRegular,
      size: 8,
      color: mutedTextColor,
    });
    compY -= 11;
  }

  // Top Right: Document Title, Number, Status Badge & Dates
  const rightAlignX = marginX + contentWidth - 16;

  // Document Number
  const docNumText = `#${doc.documentNumber}`;
  const docNumWidth = fontBold.widthOfTextAtSize(docNumText, 16);
  currentPage.drawText(docNumText, {
    x: rightAlignX - docNumWidth,
    y: headerCardY + headerCardHeight - 28,
    font: fontBold,
    size: 16,
    color: accentColor,
  });

  // Status Badge Pill
  const statusUpper = doc.status.toUpperCase();
  const statusW = fontBold.widthOfTextAtSize(statusUpper, 8) + 16;
  const statusH = 16;
  const statusX = rightAlignX - statusW;
  const statusY = headerCardY + headerCardHeight - 50;

  let statusBg = accentColor;
  if (['PAID', 'ACCEPTED'].includes(statusUpper)) {
    statusBg = emeraldColor;
  } else if (['DRAFT'].includes(statusUpper)) {
    statusBg = mutedTextColor;
  } else if (['OVERDUE', 'REJECTED'].includes(statusUpper)) {
    statusBg = rgb(0.88, 0.18, 0.25);
  }

  currentPage.drawRectangle({
    x: statusX,
    y: statusY,
    width: statusW,
    height: statusH,
    color: statusBg,
  });
  currentPage.drawText(statusUpper, {
    x: statusX + 8,
    y: statusY + 4,
    font: fontBold,
    size: 8,
    color: whiteColor,
  });

  // Issue & Due Dates
  const issueDateStr = `Issue Date: ${doc.issueDate}`;
  const issueDateW = fontRegular.widthOfTextAtSize(issueDateStr, 8.5);
  currentPage.drawText(issueDateStr, {
    x: rightAlignX - issueDateW,
    y: headerCardY + 30,
    font: fontRegular,
    size: 8.5,
    color: mutedTextColor,
  });

  const dueDateStr = `Due Date: ${doc.dueDate}`;
  const dueDateW = fontBold.widthOfTextAtSize(dueDateStr, 8.5);
  currentPage.drawText(dueDateStr, {
    x: rightAlignX - dueDateW,
    y: headerCardY + 16,
    font: fontBold,
    size: 8.5,
    color: darkTextColor,
  });

  currentY = headerCardY - 14;

  // 2. Billed To Card
  const billedCardHeight = 72;
  const billedCardY = currentY - billedCardHeight;
  currentPage.drawRectangle({
    x: marginX,
    y: billedCardY,
    width: contentWidth,
    height: billedCardHeight,
    color: lightBgColor,
    borderColor: borderColor,
    borderWidth: 1,
  });

  currentPage.drawText('BILLED TO', {
    x: marginX + 16,
    y: billedCardY + billedCardHeight - 16,
    font: fontBold,
    size: 8,
    color: mutedTextColor,
  });

  const clientHeader = `${client.companyName} (${client.code})`;
  currentPage.drawText(clientHeader, {
    x: marginX + 16,
    y: billedCardY + billedCardHeight - 30,
    font: fontBold,
    size: 11,
    color: darkTextColor,
  });

  const contactLine = `Attn: ${client.contactName} • ${client.email}${client.phone ? ` • ${client.phone}` : ''}`;
  currentPage.drawText(contactLine, {
    x: marginX + 16,
    y: billedCardY + billedCardHeight - 44,
    font: fontRegular,
    size: 8.5,
    color: mutedTextColor,
  });

  const addr = client.billingAddress;
  const addrLine = [addr?.line1, addr?.city, addr?.state, addr?.postalCode, addr?.country]
    .filter(Boolean)
    .join(', ');
  const taxIdPart = client.taxIdentifier ? `   |   Tax ID: ${client.taxIdentifier}` : '';
  currentPage.drawText(`${addrLine}${taxIdPart}`, {
    x: marginX + 16,
    y: billedCardY + billedCardHeight - 58,
    font: fontRegular,
    size: 8.5,
    color: mutedTextColor,
  });

  currentY = billedCardY - 16;

  // 3. Table Header Function
  const drawTableHeader = (page: PDFPage, y: number) => {
    page.drawRectangle({
      x: marginX,
      y: y - 18,
      width: contentWidth,
      height: 20,
      color: rgb(0.94, 0.96, 0.98),
      borderColor: borderColor,
      borderWidth: 1,
    });

    page.drawText('#', { x: marginX + 10, y: y - 13, font: fontBold, size: 8, color: darkTextColor });
    page.drawText('ITEM & DESCRIPTION', { x: marginX + 35, y: y - 13, font: fontBold, size: 8, color: darkTextColor });

    drawTextRight(page, 'QTY', marginX + 355, y - 13, fontBold, 8, darkTextColor);
    drawTextRight(page, 'UNIT PRICE', marginX + 430, y - 13, fontBold, 8, darkTextColor);
    drawTextRight(page, 'TAX', marginX + 475, y - 13, fontBold, 8, darkTextColor);
    drawTextRight(page, 'LINE TOTAL', marginX + contentWidth - 12, y - 13, fontBold, 8, darkTextColor);
  };

  // Draw initial table header
  drawTableHeader(currentPage, currentY);
  currentY -= 24;

  // 4. Render Line Items with Dynamic Wrapping & Pagination
  items.forEach((item, idx) => {
    const descLines = item.description
      ? wrapText(item.description, 270, fontRegular, 8)
      : [];
    const itemRowHeight = Math.max(22, 16 + descLines.length * 10);

    // Multi-page check
    if (currentY - itemRowHeight < 150) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      currentY = 750;
      drawTableHeader(currentPage, currentY);
      currentY -= 24;
    }

    // Alternating row subtle shading
    if (idx % 2 === 1) {
      currentPage.drawRectangle({
        x: marginX,
        y: currentY - itemRowHeight + 4,
        width: contentWidth,
        height: itemRowHeight,
        color: slateRowBg,
      });
    }

    // Index
    currentPage.drawText(`${idx + 1}`, {
      x: marginX + 10,
      y: currentY - 8,
      font: fontRegular,
      size: 8.5,
      color: mutedTextColor,
    });

    // Item Name
    currentPage.drawText(item.name, {
      x: marginX + 35,
      y: currentY - 8,
      font: fontBold,
      size: 9,
      color: darkTextColor,
    });

    // Item Description (wrapped lines)
    let dY = currentY - 18;
    for (const dLine of descLines) {
      currentPage.drawText(dLine, {
        x: marginX + 35,
        y: dY,
        font: fontRegular,
        size: 8,
        color: mutedTextColor,
      });
      dY -= 10;
    }

    // Numeric columns (right-aligned)
    const qtyStr = `${item.quantity} ${item.unit}`;
    drawTextRight(currentPage, qtyStr, marginX + 355, currentY - 8, fontRegular, 8.5, darkTextColor);

    const priceStr = formatMoney(item.unitPrice, doc.currency);
    drawTextRight(currentPage, priceStr, marginX + 430, currentY - 8, fontRegular, 8.5, darkTextColor);

    const taxStr = `${item.taxRate}%${item.taxCompound ? ' (C)' : ''}`;
    drawTextRight(currentPage, taxStr, marginX + 475, currentY - 8, fontRegular, 8.5, mutedTextColor);

    const lineTotalStr = formatMoney(item.lineTotal, doc.currency);
    drawTextRight(currentPage, lineTotalStr, marginX + contentWidth - 12, currentY - 8, fontBold, 9, darkTextColor);

    // Row divider
    currentPage.drawLine({
      start: { x: marginX, y: currentY - itemRowHeight + 4 },
      end: { x: marginX + contentWidth, y: currentY - itemRowHeight + 4 },
      thickness: 0.5,
      color: borderColor,
    });

    currentY -= itemRowHeight;
  });

  currentY -= 12;

  // 5. Summary / Totals Block (Right side)
  const summaryBoxHeight = doc.type === 'invoice' ? 116 : 84;
  if (currentY - summaryBoxHeight < 70) {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    currentY = 750;
  }

  const totalsBoxW = 210;
  const totalsBoxX = marginX + contentWidth - totalsBoxW;
  const totalsBoxY = currentY - summaryBoxHeight;

  currentPage.drawRectangle({
    x: totalsBoxX,
    y: totalsBoxY,
    width: totalsBoxW,
    height: summaryBoxHeight,
    color: lightBgColor,
    borderColor: borderColor,
    borderWidth: 1,
  });

  let totY = currentY - 16;
  const drawTotalLine = (label: string, value: string, isBold = false, isAccent = false) => {
    currentPage.drawText(label, {
      x: totalsBoxX + 14,
      y: totY,
      font: isBold ? fontBold : fontRegular,
      size: isAccent ? 11 : 8.5,
      color: isAccent ? accentColor : darkTextColor,
    });
    drawTextRight(
      currentPage,
      value,
      totalsBoxX + totalsBoxW - 14,
      totY,
      isBold ? fontBold : fontRegular,
      isAccent ? 11 : 8.5,
      isAccent ? accentColor : darkTextColor
    );
    totY -= 16;
  };

  drawTotalLine('Subtotal', formatMoney(doc.subtotal, doc.currency));
  if (doc.discountTotal > 0) {
    drawTotalLine('Discount', `-${formatMoney(doc.discountTotal, doc.currency)}`);
  }
  drawTotalLine('Tax Total', formatMoney(doc.taxTotal, doc.currency));

  // Divider above Grand Total
  currentPage.drawLine({
    start: { x: totalsBoxX + 10, y: totY + 10 },
    end: { x: totalsBoxX + totalsBoxW - 10, y: totY + 10 },
    thickness: 1,
    color: borderColor,
  });

  drawTotalLine('GRAND TOTAL', formatMoney(doc.total, doc.currency), true, true);

  if (doc.type === 'invoice') {
    drawTotalLine('Amount Paid', formatMoney(doc.amountPaid, doc.currency));
    const balanceDueLabel = 'Balance Due';
    const balanceDueStr = formatMoney(doc.amountDue, doc.currency);
    currentPage.drawText(balanceDueLabel, {
      x: totalsBoxX + 14,
      y: totY,
      font: fontBold,
      size: 9.5,
      color: doc.amountDue > 0 ? rgb(0.85, 0.2, 0.2) : emeraldColor,
    });
    drawTextRight(
      currentPage,
      balanceDueStr,
      totalsBoxX + totalsBoxW - 14,
      totY,
      fontBold,
      9.5,
      doc.amountDue > 0 ? rgb(0.85, 0.2, 0.2) : emeraldColor
    );
  }

  // 6. Left Side: Payment Instructions & Notes
  const leftBoxW = totalsBoxX - marginX - 16;
  let leftY = currentY - 14;

  if (doc.notes) {
    currentPage.drawText('Notes:', {
      x: marginX + 4,
      y: leftY,
      font: fontBold,
      size: 8.5,
      color: darkTextColor,
    });
    leftY -= 12;
    const noteLines = wrapText(doc.notes, leftBoxW - 8, fontRegular, 8);
    for (const nLine of noteLines.slice(0, 3)) {
      currentPage.drawText(nLine, {
        x: marginX + 4,
        y: leftY,
        font: fontRegular,
        size: 8,
        color: mutedTextColor,
      });
      leftY -= 10;
    }
    leftY -= 6;
  }

  if (paymentInstructions) {
    const instLines = wrapText(paymentInstructions, leftBoxW - 20, fontRegular, 8);
    const instBoxH = Math.min(60, 20 + instLines.length * 10);
    const instBoxY = Math.max(totalsBoxY, leftY - instBoxH);
    currentPage.drawRectangle({
      x: marginX,
      y: instBoxY,
      width: leftBoxW,
      height: instBoxH,
      color: lightBgColor,
      borderColor: borderColor,
      borderWidth: 0.5,
    });

    currentPage.drawText('Payment Instructions:', {
      x: marginX + 10,
      y: instBoxY + instBoxH - 14,
      font: fontBold,
      size: 8,
      color: darkTextColor,
    });

    let pY = instBoxY + instBoxH - 24;
    for (const pLine of instLines.slice(0, 3)) {
      currentPage.drawText(pLine, {
        x: marginX + 10,
        y: pY,
        font: fontRegular,
        size: 7.5,
        color: mutedTextColor,
      });
      pY -= 10;
    }
  }

  // 7. Page Footers (on all pages)
  const totalPages = pdfDoc.getPageCount();
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const p = pdfDoc.getPage(pIdx);
    p.drawLine({
      start: { x: marginX, y: 36 },
      end: { x: marginX + contentWidth, y: 36 },
      thickness: 0.5,
      color: borderColor,
    });

    const footerText = footerLegal ? footerLegal.replace(/\r?\n/g, ' ') : 'Thank you for your business.';
    p.drawText(footerText.slice(0, 100), {
      x: marginX,
      y: 24,
      font: fontRegular,
      size: 7,
      color: mutedTextColor,
    });

    const pageNumText = `Page ${pIdx + 1} of ${totalPages}`;
    drawTextRight(p, pageNumText, marginX + contentWidth, 24, fontRegular, 7, mutedTextColor);
  }

  return await pdfDoc.save();
}
