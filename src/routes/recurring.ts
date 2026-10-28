import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, asc } from 'drizzle-orm';
import {
  recurringSchedules,
  recurringScheduleItems,
  clients,
  documentTemplates,
} from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import { calculateDocumentTotals } from '../lib/calculations';
import { generateInvoiceFromSchedule } from '../lib/recurring-cron';
import { recordAuditLog } from '../lib/audit';

export const recurringRoutes = new Hono<AppEnv>();

const scheduleItemSchema = z.object({
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

const createScheduleSchema = z.object({
  clientId: z.string().trim().min(1),
  profileName: z.string().trim().min(1, 'Profile name is required'),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually']).default('monthly'),
  nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid YYYY-MM-DD date required'),
  templateId: z.string().optional(),
  currency: z.string().length(3).toUpperCase().default('USD'),
  discountType: z.enum(['percentage', 'fixed']).default('percentage'),
  discountValue: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  sendAdminReminder: z.boolean().default(true),
  items: z.array(scheduleItemSchema).min(1, 'At least one line item is required'),
});

/**
 * List all recurring schedules with client metadata
 */
recurringRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');

  const schedules = await db
    .select({
      schedule: recurringSchedules,
      client: {
        id: clients.id,
        companyName: clients.companyName,
        contactName: clients.contactName,
        email: clients.email,
      },
    })
    .from(recurringSchedules)
    .innerJoin(clients, eq(recurringSchedules.clientId, clients.id))
    .orderBy(desc(recurringSchedules.nextRunDate));

  return c.json({
    schedules: schedules.map((s) => ({
      ...s.schedule,
      client: s.client,
    })),
  });
});

/**
 * Get single recurring schedule with line items
 */
recurringRoutes.get('/:id', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [schedule] = await db
    .select()
    .from(recurringSchedules)
    .where(eq(recurringSchedules.id, id))
    .limit(1);

  if (!schedule) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, schedule.clientId))
    .limit(1);

  const items = await db
    .select()
    .from(recurringScheduleItems)
    .where(eq(recurringScheduleItems.scheduleId, schedule.id))
    .orderBy(asc(recurringScheduleItems.sortOrder));

  return c.json({
    schedule,
    client,
    items,
  });
});

/**
 * Create a new recurring schedule
 */
recurringRoutes.post('/', requireRole('member'), zValidator('json', createScheduleSchema), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const body = c.req.valid('json');

  const [client] = await db.select().from(clients).where(eq(clients.id, body.clientId)).limit(1);
  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  const calculated = calculateDocumentTotals(
    body.items.map((i, idx) => ({ ...i, sortOrder: idx })),
    body.discountType,
    body.discountValue
  );

  const scheduleId = `rec_${crypto.randomUUID()}`;
  const now = new Date();

  await db.insert(recurringSchedules).values({
    id: scheduleId,
    clientId: body.clientId,
    templateId: body.templateId ?? 'tpl_modern_slate',
    profileName: body.profileName,
    frequency: body.frequency,
    nextRunDate: body.nextRunDate,
    currency: body.currency,
    discountType: body.discountType,
    discountValue: body.discountValue,
    subtotal: calculated.subtotal,
    discountTotal: calculated.discountTotal,
    taxTotal: calculated.taxTotal,
    total: calculated.total,
    notes: body.notes,
    terms: body.terms,
    status: 'active',
    autoSendMode: 'draft_only',
    sendAdminReminder: body.sendAdminReminder,
    createdBy: user?.id,
    createdAt: now,
    updatedAt: now,
  });

  for (let idx = 0; idx < calculated.items.length; idx++) {
    const item = calculated.items[idx];
    await db.insert(recurringScheduleItems).values({
      id: `ritm_${crypto.randomUUID()}`,
      scheduleId,
      sortOrder: idx,
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

  await recordAuditLog({
    db,
    user,
    action: 'recurring.created',
    entityType: 'invoice',
    entityId: scheduleId,
    metadata: {
      profileName: body.profileName,
      clientName: client.companyName,
      total: calculated.total,
      frequency: body.frequency,
      nextRunDate: body.nextRunDate,
    },
  });

  return c.json({
    success: true,
    id: scheduleId,
    message: `Recurring retainer "${body.profileName}" configured successfully.`,
  });
});

/**
 * Update recurring schedule
 */
recurringRoutes.put('/:id', requireRole('member'), zValidator('json', createScheduleSchema), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existing] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id)).limit(1);
  if (!existing) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  const calculated = calculateDocumentTotals(
    body.items.map((i, idx) => ({ ...i, sortOrder: idx })),
    body.discountType,
    body.discountValue
  );

  const now = new Date();

  await db
    .update(recurringSchedules)
    .set({
      clientId: body.clientId,
      templateId: body.templateId ?? existing.templateId,
      profileName: body.profileName,
      frequency: body.frequency,
      nextRunDate: body.nextRunDate,
      currency: body.currency,
      discountType: body.discountType,
      discountValue: body.discountValue,
      subtotal: calculated.subtotal,
      discountTotal: calculated.discountTotal,
      taxTotal: calculated.taxTotal,
      total: calculated.total,
      notes: body.notes,
      terms: body.terms,
      sendAdminReminder: body.sendAdminReminder,
      updatedAt: now,
    })
    .where(eq(recurringSchedules.id, id));

  // Replace line items
  await db.delete(recurringScheduleItems).where(eq(recurringScheduleItems.scheduleId, id));

  for (let idx = 0; idx < calculated.items.length; idx++) {
    const item = calculated.items[idx];
    await db.insert(recurringScheduleItems).values({
      id: `ritm_${crypto.randomUUID()}`,
      scheduleId: id,
      sortOrder: idx,
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

  await recordAuditLog({
    db,
    user,
    action: 'recurring.updated',
    entityType: 'invoice',
    entityId: id,
    metadata: {
      profileName: body.profileName,
      total: calculated.total,
    },
  });

  return c.json({ success: true, message: 'Recurring schedule updated' });
});

/**
 * Toggle Active / Paused
 */
recurringRoutes.post('/:id/toggle', requireRole('member'), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const id = c.req.param('id');

  const [schedule] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id)).limit(1);
  if (!schedule) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  const newStatus = schedule.status === 'active' ? 'paused' : 'active';

  await db
    .update(recurringSchedules)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(recurringSchedules.id, id));

  await recordAuditLog({
    db,
    user,
    action: 'recurring.status_changed',
    entityType: 'invoice',
    entityId: id,
    metadata: {
      profileName: schedule.profileName,
      previousStatus: schedule.status,
      newStatus,
    },
  });

  return c.json({ success: true, status: newStatus });
});

/**
 * Manually trigger recurring schedule draft generation right now
 */
recurringRoutes.post('/:id/run-now', requireRole('member'), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const id = c.req.param('id');

  const [schedule] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id)).limit(1);
  if (!schedule) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  const result = await generateInvoiceFromSchedule(db, id, c.env);
  if (!result) {
    return c.json({ error: 'Failed to generate recurring invoice draft' }, 500);
  }

  await recordAuditLog({
    db,
    user,
    action: 'recurring.manual_run',
    entityType: 'invoice',
    entityId: result.invoiceId,
    metadata: {
      scheduleId: id,
      invoiceNumber: result.invoiceNumber,
      profileName: schedule.profileName,
    },
  });

  return c.json({
    success: true,
    message: `Draft invoice #${result.invoiceNumber} created and waiting in Drafts.`,
    invoiceNumber: result.invoiceNumber,
    invoiceId: result.invoiceId,
  });
});

/**
 * Delete a recurring schedule
 */
recurringRoutes.delete('/:id', requireRole('admin'), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const id = c.req.param('id');

  const [schedule] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id)).limit(1);
  if (!schedule) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  await db.delete(recurringScheduleItems).where(eq(recurringScheduleItems.scheduleId, id));
  await db.delete(recurringSchedules).where(eq(recurringSchedules.id, id));

  await recordAuditLog({
    db,
    user,
    action: 'recurring.deleted',
    entityType: 'invoice',
    entityId: id,
    metadata: {
      profileName: schedule.profileName,
    },
  });

  return c.json({ success: true, message: 'Recurring schedule deleted' });
});
