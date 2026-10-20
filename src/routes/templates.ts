import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { documentTemplates } from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import { recordAuditLog } from '../lib/audit';

export const templateRoutes = new Hono<AppEnv>();

const templateStylesSchema = z.object({
  primaryColor: z.string().default('#0f172a'),
  accentColor: z.string().default('#2563eb'),
  fontFamily: z.string().default('Inter, system-ui, sans-serif'),
  headerBg: z.string().default('#f8fafc'),
  tableBorderColor: z.string().default('#e2e8f0'),
  customCssVars: z.record(z.string(), z.string()).default({}),
});

const upsertTemplateSchema = z.object({
  name: z.string().trim().min(1),
  isDefault: z.boolean().optional().default(false),
  logoPlacement: z.enum(['left', 'center', 'right']).default('left'),
  companyHeaderText: z.string().min(1),
  paymentInstructions: z.string().min(1),
  footerLegalClause: z.string().min(1),
  styles: templateStylesSchema,
});

templateRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const rows = await db
    .select()
    .from(documentTemplates)
    .orderBy(desc(documentTemplates.isDefault), desc(documentTemplates.updatedAt));

  return c.json({ templates: rows });
});

templateRoutes.post(
  '/',
  requireRole('admin'),
  zValidator('json', upsertTemplateSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const body = c.req.valid('json');
    const now = new Date();
    const id = `tpl_${crypto.randomUUID().slice(0, 10)}`;

    if (body.isDefault) {
      await db.update(documentTemplates).set({ isDefault: false });
    }

    const [created] = await db
      .insert(documentTemplates)
      .values({
        id,
        name: body.name,
        isDefault: body.isDefault,
        logoPlacement: body.logoPlacement,
        companyHeaderText: body.companyHeaderText,
        paymentInstructions: body.paymentInstructions,
        footerLegalClause: body.footerLegalClause,
        styles: body.styles,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'template.created',
      entityType: 'template',
      entityId: id,
      metadata: { name: body.name },
    });

    return c.json({ template: created }, 201);
  }
);

templateRoutes.put(
  '/:id',
  requireRole('admin'),
  zValidator('json', upsertTemplateSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    if (body.isDefault) {
      await db.update(documentTemplates).set({ isDefault: false });
    }

    const [updated] = await db
      .update(documentTemplates)
      .set({
        name: body.name,
        isDefault: body.isDefault,
        logoPlacement: body.logoPlacement,
        companyHeaderText: body.companyHeaderText,
        paymentInstructions: body.paymentInstructions,
        footerLegalClause: body.footerLegalClause,
        styles: body.styles,
        updatedAt: new Date(),
      })
      .where(eq(documentTemplates.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: 'Template not found' }, 404);
    }

    await recordAuditLog({
      db,
      user,
      action: 'template.updated',
      entityType: 'template',
      entityId: id,
      metadata: { name: body.name },
    });

    return c.json({ template: updated });
  }
);
