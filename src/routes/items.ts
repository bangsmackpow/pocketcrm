import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, asc } from 'drizzle-orm';
import { catalogItems } from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import { recordAuditLog } from '../lib/audit';

export const itemRoutes = new Hono<AppEnv>();

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  unitPrice: z.coerce.number().min(0, 'Unit price must be positive'),
  unit: z.string().trim().default('hrs'),
  defaultTaxRate: z.coerce.number().min(0).max(100).default(0),
  isActive: z.boolean().optional().default(true),
});

/**
 * List all catalog items (all authenticated users with viewer role)
 */
itemRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const items = await db
    .select()
    .from(catalogItems)
    .orderBy(asc(catalogItems.name));

  return c.json({ items });
});

/**
 * Create a new catalog item (Admin & Member/Manager)
 */
itemRoutes.post(
  '/',
  requireRole('member'),
  zValidator('json', itemSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const body = c.req.valid('json');
    const now = new Date();
    const id = `item_${crypto.randomUUID().slice(0, 12)}`;

    const [created] = await db
      .insert(catalogItems)
      .values({
        id,
        name: body.name,
        description: body.description ?? '',
        unitPrice: body.unitPrice,
        unit: body.unit,
        defaultTaxRate: body.defaultTaxRate,
        isActive: body.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'catalog_item.created',
      entityType: 'system',
      entityId: id,
      metadata: { name: body.name, unitPrice: body.unitPrice },
    });

    return c.json({ item: created }, 201);
  }
);

/**
 * Update a catalog item (Admin & Member/Manager)
 */
itemRoutes.put(
  '/:id',
  requireRole('member'),
  zValidator('json', itemSchema.partial()),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const [updated] = await db
      .update(catalogItems)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(catalogItems.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: 'Catalog item not found' }, 404);
    }

    await recordAuditLog({
      db,
      user,
      action: 'catalog_item.updated',
      entityType: 'system',
      entityId: id,
      metadata: body,
    });

    return c.json({ item: updated });
  }
);

/**
 * Delete a catalog item (Admin & Member/Manager)
 */
itemRoutes.delete('/:id', requireRole('member'), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const id = c.req.param('id');

  await db.delete(catalogItems).where(eq(catalogItems.id, id));

  await recordAuditLog({
    db,
    user,
    action: 'catalog_item.deleted',
    entityType: 'system',
    entityId: id,
  });

  return c.json({ success: true, id });
});
