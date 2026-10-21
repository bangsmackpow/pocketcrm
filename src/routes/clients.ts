import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, like, or } from 'drizzle-orm';
import Papa from 'papaparse';
import { clients, documents } from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import { recordAuditLog } from '../lib/audit';
import { rateLimit } from '../lib/rate-limit';
import { putCsvImportBackup } from '../lib/r2';

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

export const CLIENT_CSV_TEMPLATE = `Company Name,Client Code,Contact Name,Email,Phone,Tax Identifier,Payment Terms (Days),Currency,Address Line 1,City,State,Postal Code,Country,Notes
Stark Industries,CLI-STARK,Tony Stark,ap@stark.io,+1 (212) 555-0100,US-EIN-12-3456789,30,USD,10880 Malibu Point,Malibu,CA,90265,US,Enterprise tier partner
Wayne Enterprises,CLI-WAYNE,Bruce Wayne,finance@wayne.com,+1 (212) 555-0199,US-EIN-98-7654321,15,USD,1007 Mountain Drive,Gotham,NJ,07001,US,Preferred Net 15 terms`;

const ClientCsvRowSchema = z.object({
  companyName: z.string().trim().min(1, 'Company Name is required'),
  code: z.string().trim().min(2, 'Client Code is required'),
  contactName: z.string().trim().min(1, 'Contact Name is required'),
  email: z.string().trim().email('Valid Email is required'),
  phone: z.string().trim().optional(),
  taxIdentifier: z.string().trim().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).default(30),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  line1: z.string().trim().min(1, 'Address Line 1 is required'),
  city: z.string().trim().min(1, 'City is required'),
  state: z.string().trim().optional().default(''),
  postalCode: z.string().trim().min(1, 'Postal Code is required'),
  country: z.string().trim().default('US'),
  notes: z.string().trim().optional().default(''),
});

/**
 * Download CSV Template for Bulk Customer/Client Import
 */
clientRoutes.get('/template', requireRole('viewer'), (c) => {
  return new Response(CLIENT_CSV_TEMPLATE, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pocketcrm_clients_template.csv"',
    },
  });
});

/**
 * List clients with optional search filter and capped pagination
 */
clientRoutes.get('/', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const q = c.req.query('q')?.trim();
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));
  const offset = (page - 1) * limit;

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
        .limit(limit)
        .offset(offset)
    : await db
        .select()
        .from(clients)
        .orderBy(desc(clients.createdAt))
        .limit(limit)
        .offset(offset);

  return c.json({
    clients: rows,
    pagination: {
      page,
      limit,
      count: rows.length,
    },
  });
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
 * Bulk Import Clients from CSV with PapaParse, Zod, and Atomic D1 Batch
 * Protected by payload length bounds (5MB) and rate limiting
 */
clientRoutes.post(
  '/import-csv',
  requireRole('member'),
  rateLimit({
    windowMs: 60_000,
    max: 5,
    keyPrefix: 'client_import_csv',
    message: 'Client CSV import rate limit reached. Please wait 1 minute before importing more clients.',
  }),
  zValidator(
    'json',
    z.object({
      csvText: z.string().min(1, 'CSV content cannot be empty').max(5_000_000, 'CSV content exceeds 5MB limit'),
    })
  ),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const { csvText } = c.req.valid('json');

    const parsed = Papa.parse<Record<string, unknown>>(csvText.trim(), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });

    const getField = (row: Record<string, unknown>, ...keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== '') return row[k];
        const match = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase());
        if (match && row[match] !== undefined && row[match] !== '') return row[match];
      }
      return undefined;
    };

    const errors: Array<{ rowNumber: number; field: string; message: string }> = [];
    const validRows: Array<z.infer<typeof ClientCsvRowSchema>> = [];

    // Pre-load existing client codes and emails
    const existing = await db.select({ code: clients.code, email: clients.email }).from(clients);
    const existingCodes = new Set(existing.map((e) => e.code.toUpperCase()));

    parsed.data.forEach((rawRow, idx) => {
      const rowNumber = idx + 2;
      const normalized = {
        companyName: getField(rawRow, 'Company Name', 'company_name', 'name') ?? '',
        code: getField(rawRow, 'Client Code', 'client_code', 'code') ?? '',
        contactName: getField(rawRow, 'Contact Name', 'contact_name', 'contact') ?? '',
        email: getField(rawRow, 'Email', 'email_address', 'email') ?? '',
        phone: getField(rawRow, 'Phone', 'phone_number'),
        taxIdentifier: getField(rawRow, 'Tax Identifier', 'tax_id', 'vat'),
        paymentTermsDays: getField(rawRow, 'Payment Terms (Days)', 'payment_terms_days', 'terms') ?? 30,
        currency: getField(rawRow, 'Currency', 'currency') ?? 'USD',
        line1: getField(rawRow, 'Address Line 1', 'address_line_1', 'line1', 'address') ?? '',
        city: getField(rawRow, 'City', 'city') ?? '',
        state: getField(rawRow, 'State', 'state') ?? '',
        postalCode: getField(rawRow, 'Postal Code', 'postal_code', 'zip') ?? '',
        country: getField(rawRow, 'Country', 'country') ?? 'US',
        notes: getField(rawRow, 'Notes', 'notes') ?? '',
      };

      const res = ClientCsvRowSchema.safeParse(normalized);
      if (!res.success) {
        for (const issue of res.error.issues) {
          errors.push({
            rowNumber,
            field: issue.path.join('.'),
            message: issue.message,
          });
        }
        return;
      }

      if (existingCodes.has(res.data.code.toUpperCase())) {
        errors.push({
          rowNumber,
          field: 'Client Code',
          message: `Client Code "${res.data.code}" already exists in the database.`,
        });
        return;
      }

      existingCodes.add(res.data.code.toUpperCase());
      validRows.push(res.data);
    });

    if (validRows.length === 0) {
      return c.json(
        {
          error: 'No valid client rows found',
          errors,
          totalRows: parsed.data.length,
          importedCount: 0,
        },
        422
      );
    }

    // Save CSV backup to R2 if available
    let r2BackupKey: string | null = null;
    if (c.env.STORAGE) {
      try {
        const stored = await putCsvImportBackup(c.env.STORAGE, csvText, user?.email);
        r2BackupKey = stored.key;
      } catch (err) {
        console.warn('[Client CSV Import] R2 backup skipped:', err);
      }
    }

    const now = new Date();
    const insertStatements = validRows.map((r) => {
      const id = `cli_${crypto.randomUUID().slice(0, 12)}`;
      return db.insert(clients).values({
        id,
        code: r.code.toUpperCase(),
        companyName: r.companyName,
        contactName: r.contactName,
        email: r.email,
        phone: r.phone ?? null,
        taxIdentifier: r.taxIdentifier ?? null,
        paymentTermsDays: r.paymentTermsDays,
        currency: r.currency,
        billingAddress: {
          line1: r.line1,
          city: r.city,
          state: r.state,
          postalCode: r.postalCode,
          country: r.country,
        },
        contacts: [
          {
            name: r.contactName,
            email: r.email,
            phone: r.phone,
            isPrimary: true,
          },
        ],
        notes: r.notes ?? 'Imported via CSV',
        isActive: true,
        createdBy: user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      });
    });

    if (insertStatements.length > 0) {
      await db.batch(insertStatements as [typeof insertStatements[0], ...typeof insertStatements]);
    }

    await recordAuditLog({
      db,
      user,
      action: 'client.bulk_csv_imported',
      entityType: 'client',
      entityId: r2BackupKey || `import_${Date.now()}`,
      metadata: {
        importedCount: validRows.length,
        errorCount: errors.length,
      },
    });

    return c.json(
      {
        importedCount: validRows.length,
        totalRows: parsed.data.length,
        errors,
        r2BackupKey,
      },
      201
    );
  }
);

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
