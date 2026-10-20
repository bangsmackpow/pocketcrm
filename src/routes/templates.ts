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
  logoUrl: z.string().optional().nullable(),
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
        logoUrl: body.logoUrl ?? null,
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
  requireRole('member'),
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
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
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

/**
 * Upload logo for template and persist to Cloudflare R2
 */
templateRoutes.post(
  '/:id/logo',
  requireRole('member'),
  zValidator(
    'json',
    z.object({
      imageDataBase64: z.string().min(1),
      filename: z.string().default('logo.png'),
      contentType: z.string().default('image/png'),
    })
  ),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const id = c.req.param('id');
    const { imageDataBase64, filename, contentType } = c.req.valid('json');

    let logoUrl = imageDataBase64; // Fallback to inline data URL
    let r2Key: string | null = null;

    if (c.env.STORAGE) {
      try {
        const cleanBase64 = imageDataBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        const binaryStr = atob(cleanBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        r2Key = `logos/${id}_${Date.now()}_${safeFilename}`;

        await c.env.STORAGE.put(r2Key, bytes, {
          httpMetadata: { contentType },
          customMetadata: { templateId: id, uploadedBy: user?.email ?? 'unknown' },
        });

        logoUrl = `/api/storage/${r2Key}`;
      } catch (err) {
        console.warn('[Logo Upload] Failed to write to R2, keeping data URL:', err);
      }
    }

    const [updated] = await db
      .update(documentTemplates)
      .set({
        logoUrl,
        logoR2Key: r2Key,
        updatedAt: new Date(),
      })
      .where(eq(documentTemplates.id, id))
      .returning();

    await recordAuditLog({
      db,
      user,
      action: 'template.logo_uploaded',
      entityType: 'template',
      entityId: id,
      metadata: { r2Key, filename },
    });

    return c.json({ template: updated, logoUrl });
  }
);
