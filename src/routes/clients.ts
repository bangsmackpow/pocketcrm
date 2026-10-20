import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, like, or } from 'drizzle-orm';
import { clients, documents } from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import { recordAuditLog } from '../lib/audit';

export const clientRoutes = new Hono<AppEnv>();

const addressSchema = z.object({
  line1: z.string().min(1, 'Address line 1 is required'),
  line2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().optional(),
  postalCode: z.string().min(1, 'Postal code is required'),
  country: z.string().min(1, 'Country is required').default('US'),
});

const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

const createClientSchema = z.object({
  code: z.string().trim().min(2).max(32),
  companyName: z.string().trim().min(1),
  contactName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().optional(),
  website: z.string().optional(),
  taxIdentifier: z.string().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  billingAddress: addressSchema,
  shippingAddress: addressSchema.optional(),
  contacts: z.array(contactSchema).optional().default([]),
  notes: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});

/**
 * List all clients with optional search filter
 */
clientRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const q = c.req.query('q')?.trim();

  const rows = q
    ? await db
        .select()
        .from(clients)
        .where(
          or(
            like(clients.companyName, `%${q}%`),
            like(clients.code, `%${q}%`),
            like(clients.email, `%${q}%`),
            like(clients.contactName, `%${q}%`)
          )
        )
        .orderBy(desc(clients.createdAt))
    : await db.select().from(clients).orderBy(desc(clients.createdAt));

  return c.json({ clients: rows });
});

/**
 * Get single client details + associated documents (invoices & estimates)
 */
clientRoutes.get('/:id', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  const clientDocs = await db
    .select()
    .from(documents)
    .where(eq(documents.clientId, id))
    .orderBy(desc(documents.issueDate));

  return c.json({
    client,
    documents: clientDocs,
  });
});

/**
 * Create a new client (requires 'member' or 'admin' role)
 */
clientRoutes.post(
  '/',
  requireRole('member'),
  zValidator('json', createClientSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const body = c.req.valid('json');
    const now = new Date();
    const id = `cli_${crypto.randomUUID().slice(0, 12)}`;

    const [created] = await db
      .insert(clients)
      .values({
        id,
        code: body.code.toUpperCase(),
        companyName: body.companyName,
        contactName: body.contactName,
        email: body.email,
        phone: body.phone ?? null,
        website: body.website ?? null,
        taxIdentifier: body.taxIdentifier ?? null,
        paymentTermsDays: body.paymentTermsDays,
        currency: body.currency,
        billingAddress: body.billingAddress,
        shippingAddress: body.shippingAddress ?? null,
        contacts:
          body.contacts.length > 0
            ? body.contacts
            : [
                {
                  name: body.contactName,
                  email: body.email,
                  phone: body.phone,
                  isPrimary: true,
                },
              ],
        notes: body.notes ?? null,
        isActive: body.isActive,
        createdBy: user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'client.created',
      entityType: 'client',
      entityId: created.id,
      metadata: { code: created.code, companyName: created.companyName },
    });

    return c.json({ client: created }, 201);
  }
);

/**
 * Update an existing client
 */
clientRoutes.put(
  '/:id',
  requireRole('member'),
  zValidator('json', createClientSchema.partial()),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const [updated] = await db
      .update(clients)
      .set({
        ...body,
        ...(body.code ? { code: body.code.toUpperCase() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(clients.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: 'Client not found' }, 404);
    }

    await recordAuditLog({
      db,
      user,
      action: 'client.updated',
      entityType: 'client',
      entityId: id,
      metadata: { updatedFields: Object.keys(body) },
    });

    return c.json({ client: updated });
  }
);

/**
 * Delete a client (requires 'admin' role)
 */
clientRoutes.delete('/:id', requireRole('admin'), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const id = c.req.param('id');

  await db.delete(clients).where(eq(clients.id, id));

  await recordAuditLog({
    db,
    user,
    action: 'client.deleted',
    entityType: 'client',
    entityId: id,
  });

  return c.json({ deleted: true, id });
});
