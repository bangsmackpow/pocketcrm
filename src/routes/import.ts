import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import {
  clients,
  documents,
  documentItems,
  type DocumentType,
} from '../db/schema';
import { requireRole, type AppEnv } from '../lib/auth';
import {
  parseAndValidateDocumentsCsv,
  SAMPLE_CSV_TEMPLATE,
  type CsvRowError,
} from '../lib/csv-parser';
import { putCsvImportBackup } from '../lib/r2';
import { recordAuditLog } from '../lib/audit';

export const importRoutes = new Hono<AppEnv>();

export const ITEMS_CSV_TEMPLATE = `Item Name,Description,Quantity,Unit,Unit Price,Tax Rate,Compound Tax
Cloudflare Workers Edge Engineering,High availability D1 + R2 infrastructure,40,hrs,150.00,8.25,false
Security & Compliance Review,RBAC audit and endpoint hardening,10,hrs,200.00,8.25,false`;

/**
 * Download CSV template for line items import
 */
importRoutes.get('/items-template', requireRole('viewer'), (c) => {
  return new Response(ITEMS_CSV_TEMPLATE, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pocketcrm_items_template.csv"',
    },
  });
});

/**
 * Download the deterministic CSV template for bulk Quotes & Invoices import
 */
importRoutes.get('/template', requireRole('viewer'), (c) => {
  return new Response(SAMPLE_CSV_TEMPLATE, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pocketcrm_documents_template.csv"',
    },
  });
});

const csvImportRequestSchema = z.object({
  csvText: z.string().min(1, 'CSV content cannot be empty'),
  defaultDocumentType: z.enum(['invoice', 'estimate']).optional().default('invoice'),
  dryRun: z.boolean().optional().default(false),
  autoCreateMissingClients: z.boolean().optional().default(false),
});

/**
 * Templated CSV Ingestion Route:
 * 1. Parses & validates rows using PapaParse + Zod
 * 2. Resolves Client Identifiers against D1 `clients` table
 * 3. Archives raw CSV to Cloudflare R2 (`STORAGE`)
 * 4. Executes atomic `db.batch()` for each document header + child line items
 * 5. Returns comprehensive row-level error reporting and imported document summary
 */
importRoutes.post(
  '/csv',
  requireRole('member'),
  zValidator('json', csvImportRequestSchema),
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const {
      csvText,
      defaultDocumentType,
      dryRun,
      autoCreateMissingClients,
    } = c.req.valid('json');

    const parseResult = parseAndValidateDocumentsCsv(
      csvText,
      defaultDocumentType as DocumentType
    );

    const rowErrors: CsvRowError[] = [...parseResult.errors];

    // Load existing clients to resolve Client Identifier by code, id, or email
    const allClients = await db.select().from(clients);
    const clientLookup = new Map<string, string>();
    for (const cli of allClients) {
      clientLookup.set(cli.code.toUpperCase(), cli.id);
      clientLookup.set(cli.id, cli.id);
      clientLookup.set(cli.email.toLowerCase(), cli.id);
    }

    // Check existing document numbers to prevent duplicate collisions
    const existingDocs = await db
      .select({
        id: documents.id,
        documentNumber: documents.documentNumber,
      })
      .from(documents);
    const existingDocNumbers = new Set(
      existingDocs.map((d) => d.documentNumber.toUpperCase())
    );

    const readyDocuments: Array<{
      docGroup: (typeof parseResult.documents)[number];
      resolvedClientId: string;
    }> = [];

    const now = new Date();

    for (const docGroup of parseResult.documents) {
      if (existingDocNumbers.has(docGroup.documentNumber.toUpperCase())) {
        for (const rowNum of docGroup.sourceRows) {
          rowErrors.push({
            rowNumber: rowNum,
            documentNumber: docGroup.documentNumber,
            field: 'Document Number',
            message: `Document Number "${docGroup.documentNumber}" already exists in the database.`,
          });
        }
        continue;
      }

      const identifierKey = docGroup.clientIdentifier.trim();
      let resolvedClientId =
        clientLookup.get(identifierKey.toUpperCase()) ||
        clientLookup.get(identifierKey) ||
        clientLookup.get(identifierKey.toLowerCase());

      if (!resolvedClientId && autoCreateMissingClients && !dryRun) {
        const newClientId = `cli_${crypto.randomUUID().slice(0, 12)}`;
        const cleanCode = identifierKey.toUpperCase().slice(0, 24);
        await db.insert(clients).values({
          id: newClientId,
          code: cleanCode,
          companyName: identifierKey,
          contactName: 'Accounts Payable',
          email: `${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '')}@imported-client.local`,
          paymentTermsDays: 30,
          currency: docGroup.currency,
          billingAddress: {
            line1: 'Imported via CSV',
            city: 'Austin',
            state: 'TX',
            postalCode: '78701',
            country: 'US',
          },
          contacts: [],
          isActive: true,
          createdBy: user?.id ?? null,
          createdAt: now,
          updatedAt: now,
        });
        clientLookup.set(cleanCode, newClientId);
        resolvedClientId = newClientId;
      }

      if (!resolvedClientId) {
        for (const rowNum of docGroup.sourceRows) {
          rowErrors.push({
            rowNumber: rowNum,
            documentNumber: docGroup.documentNumber,
            field: 'Client Identifier',
            message: `Client Identifier "${docGroup.clientIdentifier}" was not found. Create the client first or enable autoCreateMissingClients.`,
          });
        }
        continue;
      }

      readyDocuments.push({
        docGroup,
        resolvedClientId,
      });
    }

    if (dryRun) {
      return c.json({
        dryRun: true,
        totalRows: parseResult.totalRows,
        validRowCount: parseResult.validRowCount,
        readyDocumentCount: readyDocuments.length,
        documentsPreview: readyDocuments.map((r) => r.docGroup),
        errors: rowErrors,
      });
    }

    // Store CSV backup in Cloudflare R2 before committing D1 batches
    let r2BackupKey: string | null = null;
    if (c.env.STORAGE) {
      try {
        const storedBackup = await putCsvImportBackup(
          c.env.STORAGE,
          csvText,
          user?.email
        );
        r2BackupKey = storedBackup.key;
      } catch (err) {
        console.warn('[CSV Import] R2 backup skipped/failed:', err);
      }
    }

    const importedDocuments: Array<{
      id: string;
      documentNumber: string;
      type: DocumentType;
      total: number;
      currency: string;
      itemCount: number;
    }> = [];

    // Execute atomic D1 batch operations (db.batch()) per parent Document + child Line Items
    for (const { docGroup, resolvedClientId } of readyDocuments) {
      const docId = `doc_${docGroup.type === 'estimate' ? 'est' : 'inv'}_${crypto.randomUUID().slice(0, 12)}`;

      const headerStmt = db.insert(documents).values({
        id: docId,
        documentNumber: docGroup.documentNumber,
        type: docGroup.type,
        status: docGroup.status,
        clientId: resolvedClientId,
        templateId: 'tpl_modern_slate',
        issueDate: docGroup.issueDate,
        dueDate: docGroup.dueDate,
        currency: docGroup.currency,
        discountType: docGroup.discountType,
        discountValue: docGroup.discountValue,
        subtotal: docGroup.subtotal,
        discountTotal: docGroup.discountTotal,
        taxTotal: docGroup.taxTotal,
        total: docGroup.total,
        amountPaid: docGroup.amountPaid,
        amountDue: docGroup.amountDue,
        notes: 'Imported via Templated CSV Engine',
        terms: docGroup.type === 'estimate' ? 'Valid for 30 days' : 'Net 30 days',
        createdBy: user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      });

      const itemStmts = docGroup.items.map((item, idx) =>
        db.insert(documentItems).values({
          id: `item_${crypto.randomUUID().slice(0, 12)}`,
          documentId: docId,
          sortOrder: idx,
          name: item.name,
          description: item.description ?? '',
          quantity: item.quantity,
          unit: item.unit ?? 'hrs',
          unitPrice: item.unitPrice,
          discountType: item.discountType ?? 'percentage',
          discountValue: item.discountValue ?? 0,
          taxName: item.taxName ?? 'Tax',
          taxRate: item.taxRate ?? 0,
          taxCompound: Boolean(item.taxCompound),
          secondTaxRate: 0,
          secondTaxCompound: false,
          lineSubtotal: item.lineSubtotal,
          lineDiscountAmount: item.lineDiscountAmount,
          lineTaxAmount: item.lineTaxAmount,
          lineTotal: item.lineTotal,
          createdAt: now,
        })
      );

      try {
        await db.batch([headerStmt, ...itemStmts]);
        importedDocuments.push({
          id: docId,
          documentNumber: docGroup.documentNumber,
          type: docGroup.type,
          total: docGroup.total,
          currency: docGroup.currency,
          itemCount: docGroup.items.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Atomic D1 batch insert failed';
        for (const rowNum of docGroup.sourceRows) {
          rowErrors.push({
            rowNumber: rowNum,
            documentNumber: docGroup.documentNumber,
            field: 'database_batch',
            message: msg,
          });
        }
      }
    }

    await recordAuditLog({
      db,
      user,
      action: 'csv.imported',
      entityType: 'import',
      entityId: r2BackupKey || `import_${Date.now()}`,
      metadata: {
        totalRows: parseResult.totalRows,
        importedCount: importedDocuments.length,
        errorCount: rowErrors.length,
        r2BackupKey,
      },
    });

    return c.json(
      {
        dryRun: false,
        totalRows: parseResult.totalRows,
        validRowCount: parseResult.validRowCount,
        importedCount: importedDocuments.length,
        importedDocuments,
        r2BackupKey,
        errors: rowErrors,
      },
      importedDocuments.length > 0 ? 201 : 422
    );
  }
);
