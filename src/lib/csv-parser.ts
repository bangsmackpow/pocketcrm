import Papa from 'papaparse';
import { z } from 'zod';
import {
  calculateDocumentTotals,
  type CalculatedLineItem,
} from './calculations';
import type {
  DiscountType,
  DocumentStatus,
  DocumentType,
} from '../db/schema';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_STATUSES = [
  'draft',
  'sent',
  'approved',
  'rejected',
  'converted',
  'partial',
  'paid',
  'overdue',
  'cancelled',
] as const;

/**
 * Deterministic CSV Row Schema for Quotes & Invoices
 * Supports both canonical human-readable headers ("Document Number") and snake_case aliases ("document_number").
 */
export const CsvRowSchema = z.object({
  documentNumber: z
    .string()
    .trim()
    .min(1, 'Document Number is required')
    .max(64, 'Document Number exceeds 64 chars'),
  documentType: z
    .enum(['invoice', 'estimate'])
    .optional(),
  clientIdentifier: z
    .string()
    .trim()
    .min(1, 'Client Identifier is required'),
  issueDate: z
    .string()
    .trim()
    .regex(ISO_DATE_REGEX, 'Issue Date must be in YYYY-MM-DD format'),
  dueDate: z
    .string()
    .trim()
    .regex(ISO_DATE_REGEX, 'Due Date must be in YYYY-MM-DD format'),
  status: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (val): val is DocumentStatus =>
        (VALID_STATUSES as readonly string[]).includes(val),
      {
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`,
      }
    ),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Currency must be a 3-letter ISO code (e.g., USD, EUR, GBP)'),
  lineItemName: z
    .string()
    .trim()
    .min(1, 'Line Item Name is required'),
  lineItemDescription: z
    .string()
    .trim()
    .optional()
    .default(''),
  quantity: z.coerce
    .number({ invalid_type_error: 'Quantity must be a valid number' })
    .positive('Quantity must be greater than 0'),
  unitPrice: z.coerce
    .number({ invalid_type_error: 'Unit Price must be a valid number' })
    .min(0, 'Unit Price cannot be negative'),
  taxRate: z.coerce
    .number({ invalid_type_error: 'Tax Rate must be a valid number' })
    .min(0, 'Tax Rate cannot be negative')
    .max(100, 'Tax Rate cannot exceed 100%'),
  discountType: z
    .enum(['percentage', 'fixed'])
    .optional()
    .default('percentage'),
  discountValue: z.coerce
    .number()
    .min(0)
    .optional()
    .default(0),
  taxCompound: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes'),
});

export type ValidatedCsvRow = z.infer<typeof CsvRowSchema>;

export interface CsvRowError {
  rowNumber: number; // 1-based CSV data row index (header is row 1, first data row is row 2)
  documentNumber?: string;
  field: string;
  message: string;
}

export interface GroupedCsvDocument {
  documentNumber: string;
  type: DocumentType;
  clientIdentifier: string;
  issueDate: string;
  dueDate: string;
  status: DocumentStatus;
  currency: string;
  discountType: DiscountType;
  discountValue: number;
  items: CalculatedLineItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  sourceRows: number[];
}

export interface CsvParseResult {
  totalRows: number;
  validRowCount: number;
  documents: GroupedCsvDocument[];
  errors: CsvRowError[];
}

function normalizeHeaderRecord(rawRow: Record<string, unknown>): Record<string, unknown> {
  const getField = (...keys: string[]) => {
    for (const k of keys) {
      if (rawRow[k] !== undefined && rawRow[k] !== '') {
        return rawRow[k];
      }
      // Case-insensitive match
      const foundKey = Object.keys(rawRow).find(
        (rk) => rk.trim().toLowerCase() === k.toLowerCase()
      );
      if (foundKey && rawRow[foundKey] !== undefined && rawRow[foundKey] !== '') {
        return rawRow[foundKey];
      }
    }
    return undefined;
  };

  return {
    documentNumber: getField('Document Number', 'document_number', 'doc_number') ?? '',
    documentType: getField('Document Type', 'document_type', 'type'),
    clientIdentifier: getField('Client Identifier', 'client_identifier', 'client_code', 'client_id') ?? '',
    issueDate: getField('Issue Date', 'issue_date') ?? '',
    dueDate: getField('Due Date', 'due_date') ?? '',
    status: getField('Status', 'status') ?? 'draft',
    currency: getField('Currency', 'currency') ?? 'USD',
    lineItemName: getField('Line Item Name', 'line_item_name', 'item_name') ?? '',
    lineItemDescription: getField('Line Item Description', 'line_item_description', 'description') ?? '',
    quantity: getField('Quantity', 'quantity', 'qty'),
    unitPrice: getField('Unit Price', 'unit_price', 'price'),
    taxRate: getField('Tax Rate', 'tax_rate', 'tax') ?? 0,
    discountType: getField('Discount Type', 'discount_type') ?? 'percentage',
    discountValue: getField('Discount Value', 'discount_value', 'discount') ?? 0,
    taxCompound: getField('Compound Tax', 'tax_compound', 'compound_tax') ?? false,
  };
}

function inferDocumentType(
  documentNumber: string,
  explicitType?: 'invoice' | 'estimate',
  defaultType: DocumentType = 'invoice'
): DocumentType {
  if (explicitType === 'invoice' || explicitType === 'estimate') {
    return explicitType;
  }
  const upper = documentNumber.toUpperCase();
  if (upper.startsWith('EST') || upper.startsWith('QUO')) {
    return 'estimate';
  }
  if (upper.startsWith('INV')) {
    return 'invoice';
  }
  return defaultType;
}

/**
 * Parses and validates raw CSV content using PapaParse and Zod, grouping rows into
 * parent Document headers and child Line Items with deterministic financial totals.
 */
export function parseAndValidateDocumentsCsv(
  csvText: string,
  defaultDocumentType: DocumentType = 'invoice'
): CsvParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(csvText.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const errors: CsvRowError[] = [];

  for (const pErr of parsed.errors) {
    errors.push({
      rowNumber: (pErr.row ?? 0) + 2,
      field: 'csv_format',
      message: pErr.message,
    });
  }

  const rawRows = parsed.data || [];
  const docGroups = new Map<
    string,
    {
      header: ValidatedCsvRow;
      type: DocumentType;
      rows: { rowNumber: number; data: ValidatedCsvRow }[];
    }
  >();

  let validRowCount = 0;

  rawRows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2; // 1-based + header row
    const normalized = normalizeHeaderRecord(rawRow);
    const validation = CsvRowSchema.safeParse(normalized);

    if (!validation.success) {
      for (const issue of validation.error.issues) {
        errors.push({
          rowNumber,
          documentNumber: String(normalized.documentNumber || ''),
          field: issue.path.join('.') || 'row',
          message: issue.message,
        });
      }
      return;
    }

    const validRow = validation.data;
    const docNum = validRow.documentNumber;
    const inferredType = inferDocumentType(
      docNum,
      validRow.documentType,
      defaultDocumentType
    );

    const existingGroup = docGroups.get(docNum);
    if (existingGroup) {
      // Ensure consistent header metadata across line items of the same document
      if (existingGroup.header.clientIdentifier !== validRow.clientIdentifier) {
        errors.push({
          rowNumber,
          documentNumber: docNum,
          field: 'clientIdentifier',
          message: `Conflicting Client Identifier "${validRow.clientIdentifier}" for Document "${docNum}" (expected "${existingGroup.header.clientIdentifier}")`,
        });
        return;
      }
      if (existingGroup.header.currency !== validRow.currency) {
        errors.push({
          rowNumber,
          documentNumber: docNum,
          field: 'currency',
          message: `Conflicting Currency "${validRow.currency}" for Document "${docNum}" (expected "${existingGroup.header.currency}")`,
        });
        return;
      }
      existingGroup.rows.push({ rowNumber, data: validRow });
    } else {
      docGroups.set(docNum, {
        header: validRow,
        type: inferredType,
        rows: [{ rowNumber, data: validRow }],
      });
    }

    validRowCount++;
  });

  const documents: GroupedCsvDocument[] = [];

  for (const [docNum, group] of docGroups.entries()) {
    const calc = calculateDocumentTotals(
      group.rows.map((r) => ({
        name: r.data.lineItemName,
        description: r.data.lineItemDescription,
        quantity: r.data.quantity,
        unit: 'hrs',
        unitPrice: r.data.unitPrice,
        discountType: r.data.discountType,
        discountValue: r.data.discountValue,
        taxName: 'Tax',
        taxRate: r.data.taxRate,
        taxCompound: r.data.taxCompound,
      })),
      'percentage',
      0,
      group.header.status === 'paid' ? undefined : 0
    );

    const amountPaid = group.header.status === 'paid' ? calc.total : 0;
    const amountDue = group.header.status === 'paid' ? 0 : calc.total;

    documents.push({
      documentNumber: docNum,
      type: group.type,
      clientIdentifier: group.header.clientIdentifier,
      issueDate: group.header.issueDate,
      dueDate: group.header.dueDate,
      status: group.header.status,
      currency: group.header.currency,
      discountType: 'percentage',
      discountValue: 0,
      items: calc.items,
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      taxTotal: calc.taxTotal,
      total: calc.total,
      amountPaid,
      amountDue,
      sourceRows: group.rows.map((r) => r.rowNumber),
    });
  }

  return {
    totalRows: rawRows.length,
    validRowCount,
    documents,
    errors,
  };
}

export const SAMPLE_CSV_TEMPLATE = `Document Number,Client Identifier,Issue Date,Due Date,Status,Currency,Line Item Name,Line Item Description,Quantity,Unit Price,Tax Rate
INV-2026-0101,CLI-ACME,2026-10-15,2026-11-14,sent,USD,Edge Worker Deployment,Global Cloudflare D1 + R2 setup,25,160,8.25
INV-2026-0101,CLI-ACME,2026-10-15,2026-11-14,sent,USD,Security Compliance Audit,SOC2 Type II penetration testing,12,210,8.25
EST-2026-0102,CLI-LUMON,2026-10-18,2026-11-18,sent,USD,Custom Analytics Portal,Real-time telemetry dashboard with RBAC,40,145,8.00`;
