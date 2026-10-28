import { eq, and, lte, asc } from 'drizzle-orm';
import {
  recurringSchedules,
  recurringScheduleItems,
  documents,
  documentItems,
  clients,
} from '../db/schema';
import { createD1Client, type AppDatabase } from '../db/client';
import { generatePortalToken } from './portal-token';
import { recordAuditLog } from './audit';
import { createMimeMessage } from 'mimetext';
import { EmailMessage } from 'cloudflare:email';
import type { CloudflareBindings } from './auth';

/**
 * Calculates the next execution date string (YYYY-MM-DD) based on frequency
 */
export function advanceScheduleDate(currentDateStr: string, frequency: string): string {
  const [y, m, d] = currentDateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));

  switch (frequency) {
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case 'quarterly':
      date.setUTCMonth(date.getUTCMonth() + 3);
      break;
    case 'annually':
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
    case 'monthly':
    default:
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
  }

  return date.toISOString().slice(0, 10);
}

/**
 * Generates an invoice draft from a recurring schedule record
 */
export async function generateInvoiceFromSchedule(
  db: AppDatabase,
  scheduleId: string,
  env: CloudflareBindings,
  todayStr: string = new Date().toISOString().slice(0, 10)
): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  const [schedule] = await db
    .select()
    .from(recurringSchedules)
    .where(eq(recurringSchedules.id, scheduleId))
    .limit(1);

  if (!schedule) return null;

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, schedule.clientId))
    .limit(1);

  if (!client) return null;

  const items = await db
    .select()
    .from(recurringScheduleItems)
    .where(eq(recurringScheduleItems.scheduleId, schedule.id))
    .orderBy(asc(recurringScheduleItems.sortOrder));

  // Determine sequential invoice number: INV-YYYY-XXXX
  const currentYear = new Date().getFullYear();
  const allDocs = (await db.select({ documentNumber: documents.documentNumber }).from(documents)) as {
    documentNumber: string;
  }[];
  const invoiceNumbers = allDocs
    .map((d: { documentNumber: string }) => d.documentNumber)
    .filter((num: string) => num.startsWith(`INV-${currentYear}-`));

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

  // Calculate payment due date
  const now = new Date();
  const paymentDays = client.paymentTermsDays ?? 30;
  const dueDateObj = new Date(now.getTime() + paymentDays * 24 * 60 * 60 * 1000);
  const dueDateStr = dueDateObj.toISOString().slice(0, 10);

  const invoiceId = `doc_inv_${crypto.randomUUID()}`;
  const portalToken = generatePortalToken();

  // Create invoice as 'draft' for review
  await db.insert(documents).values({
    id: invoiceId,
    documentNumber: invoiceNumber,
    type: 'invoice',
    status: 'draft',
    clientId: schedule.clientId,
    templateId: schedule.templateId,
    portalToken,
    portalTokenCreatedAt: now,
    issueDate: todayStr,
    dueDate: dueDateStr,
    currency: schedule.currency,
    discountType: schedule.discountType,
    discountValue: schedule.discountValue,
    subtotal: schedule.subtotal,
    discountTotal: schedule.discountTotal,
    taxTotal: schedule.taxTotal,
    total: schedule.total,
    amountPaid: 0,
    amountDue: schedule.total,
    notes: schedule.notes,
    terms: schedule.terms,
    createdBy: schedule.createdBy,
    createdAt: now,
    updatedAt: now,
  });

  // Copy line items
  for (const itm of items) {
    await db.insert(documentItems).values({
      id: `item_${crypto.randomUUID()}`,
      documentId: invoiceId,
      sortOrder: itm.sortOrder,
      name: itm.name,
      description: itm.description,
      quantity: itm.quantity,
      unit: itm.unit,
      unitPrice: itm.unitPrice,
      discountType: itm.discountType,
      discountValue: itm.discountValue,
      taxName: itm.taxName,
      taxRate: itm.taxRate,
      taxCompound: itm.taxCompound,
      secondTaxName: itm.secondTaxName,
      secondTaxRate: itm.secondTaxRate,
      secondTaxCompound: itm.secondTaxCompound,
      lineSubtotal: itm.lineSubtotal,
      lineDiscountAmount: itm.lineDiscountAmount,
      lineTaxAmount: itm.lineTaxAmount,
      lineTotal: itm.lineTotal,
      createdAt: now,
    });
  }

  // Advance schedule to next interval
  const nextDate = advanceScheduleDate(todayStr, schedule.frequency);
  await db
    .update(recurringSchedules)
    .set({
      lastRunDate: todayStr,
      nextRunDate: nextDate,
      updatedAt: now,
    })
    .where(eq(recurringSchedules.id, schedule.id));

  // Record audit trail
  await recordAuditLog({
    db,
    user: null,
    action: 'recurring.draft_generated',
    entityType: 'invoice',
    entityId: invoiceId,
    metadata: {
      scheduleId: schedule.id,
      profileName: schedule.profileName,
      invoiceNumber,
      clientName: client.companyName,
      total: schedule.total,
      nextRunDate: nextDate,
    },
  });

  // Send admin notification reminder
  if (schedule.sendAdminReminder && env.EMAIL) {
    const adminEmail = env.ADMIN_NOTIFICATION_EMAIL || env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com';
    const baseUrl = env.BETTER_AUTH_URL || 'https://pocketcrm.builtnetworks.com';

    try {
      const msg = createMimeMessage();
      msg.setSender({ name: 'PocketCRM Billing Engine', addr: env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com' });
      msg.setRecipient({ name: 'Administrator', addr: adminEmail });
      msg.setSubject(`[Review Needed] Recurring Draft Invoice #${invoiceNumber} for ${client.companyName}`);
      msg.addMessage({
        contentType: 'text/html',
        data: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #2563eb; margin-top: 0;">📋 Recurring Invoice Draft Generated</h2>
            <p>A new recurring invoice draft has been prepared for <strong>${client.companyName}</strong> under schedule <em>${schedule.profileName}</em>.</p>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                <tr><td style="padding: 4px 0; color: #64748b;">Invoice Number:</td><td style="font-weight: 600;">#${invoiceNumber}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;">Client:</td><td style="font-weight: 600;">${client.companyName}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;">Total Amount:</td><td style="font-weight: 600;">$${schedule.total.toFixed(2)} ${schedule.currency}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;">Next Schedule Date:</td><td style="font-weight: 600;">${nextDate}</td></tr>
                <tr><td style="padding: 4px 0; color: #64748b;">Status:</td><td><span style="background: #e2e8f0; color: #334155; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">DRAFT (Review Required)</span></td></tr>
              </table>
            </div>

            <div style="text-align: center; margin: 28px 0;">
              <a href="${baseUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; display: inline-block;">
                Open PocketCRM to Review &amp; Send &rarr;
              </a>
            </div>

            <p style="font-size: 12px; color: #94a3b8; text-align: center;">This invoice was not sent to the customer and is waiting in your Drafts folder.</p>
          </div>
        `,
      });
      const rawMime = msg.asRaw();
      const cfMsg = new EmailMessage(env.EMAIL_FROM || 'invoicing@billing.builtnetworks.com', adminEmail, rawMime);
      await env.EMAIL.send(cfMsg);
    } catch (emailErr) {
      console.warn('[Recurring Engine] Admin reminder email failed:', emailErr);
    }
  }

  return { invoiceId, invoiceNumber };
}

/**
 * Cloudflare Worker Scheduled Cron Handler
 * Evaluates active recurring schedules where nextRunDate <= CURRENT_DATE
 */
export async function handleScheduledRecurringCron(env: CloudflareBindings): Promise<void> {
  const db = createD1Client(env.DB);
  const todayStr = new Date().toISOString().slice(0, 10);

  console.log(`[Recurring Cron] Starting daily recurring billing evaluation for ${todayStr}...`);

  const dueSchedules = await db
    .select()
    .from(recurringSchedules)
    .where(
      and(
        eq(recurringSchedules.status, 'active'),
        lte(recurringSchedules.nextRunDate, todayStr)
      )
    );

  console.log(`[Recurring Cron] Found ${dueSchedules.length} recurring schedules due for execution.`);

  for (const schedule of dueSchedules) {
    try {
      const result = await generateInvoiceFromSchedule(db, schedule.id, env, todayStr);
      if (result) {
        console.log(`[Recurring Cron] Successfully created draft #${result.invoiceNumber} for schedule ${schedule.profileName}`);
      }
    } catch (err) {
      console.error(`[Recurring Cron] Error executing schedule ${schedule.id}:`, err);
    }
  }

  console.log('[Recurring Cron] Execution run completed.');
}
