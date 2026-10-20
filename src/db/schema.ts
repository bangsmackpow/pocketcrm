import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export type UserRole = 'admin' | 'member' | 'viewer';

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'converted';
export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';
export type DocumentStatus = EstimateStatus | InvoiceStatus;
export type DocumentType = 'estimate' | 'invoice';
export type DiscountType = 'percentage' | 'fixed';

// ============================================================================
// BETTER AUTH + RBAC TABLES
// ============================================================================

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    role: text('role').$type<UserRole>().notNull().default('member'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)]
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('sessions_token_idx').on(table.token),
    index('sessions_user_id_idx').on(table.userId),
  ]
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)]
);

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).default(sql`(unixepoch() * 1000)`),
});

// ============================================================================
// CRM CLIENTS TABLE
// ============================================================================

export interface ClientContact {
  name: string;
  email: string;
  phone?: string;
  role?: string;
  isPrimary?: boolean;
}

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export const clients = sqliteTable(
  'clients',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(), // Unique client identifier (e.g. CLI-001 or external slug)
    companyName: text('company_name').notNull(),
    contactName: text('contact_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    website: text('website'),
    taxIdentifier: text('tax_identifier'), // VAT / EIN / GST ID
    paymentTermsDays: integer('payment_terms_days').notNull().default(30), // Net 15, Net 30, etc.
    currency: text('currency').notNull().default('USD'),
    billingAddress: text('billing_address', { mode: 'json' }).$type<BillingAddress>().notNull(),
    shippingAddress: text('shipping_address', { mode: 'json' }).$type<BillingAddress>(),
    contacts: text('contacts', { mode: 'json' }).$type<ClientContact[]>().notNull().default([]),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('clients_code_idx').on(table.code),
    index('clients_email_idx').on(table.email),
    index('clients_company_name_idx').on(table.companyName),
  ]
);

// ============================================================================
// CONFIGURABLE DOCUMENT TEMPLATES
// ============================================================================

export interface DocumentTemplateStyles {
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  headerBg: string;
  tableBorderColor: string;
  customCssVars: Record<string, string>;
}

export const documentTemplates = sqliteTable('document_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  logoR2Key: text('logo_r2_key'),
  logoPlacement: text('logo_placement').$type<'left' | 'center' | 'right'>().notNull().default('left'),
  companyHeaderText: text('company_header_text').notNull().default('PocketCRM Solutions Inc.'),
  paymentInstructions: text('payment_instructions')
    .notNull()
    .default('ACH / Wire Transfer to Routing #021000021, Account #994012831. Please include the invoice number in the memo.'),
  footerLegalClause: text('footer_legal_clause')
    .notNull()
    .default('Late payments are subject to a 1.5% monthly finance charge. All deliverables remain property of the issuer until settled in full.'),
  styles: text('styles', { mode: 'json' }).$type<DocumentTemplateStyles>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ============================================================================
// DOCUMENTS (INVOICES & ESTIMATES/QUOTES)
// ============================================================================

export interface DocumentAttachment {
  key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    documentNumber: text('document_number').notNull(), // e.g., INV-2026-0001 or EST-2026-0001
    type: text('type').$type<DocumentType>().notNull(), // 'invoice' | 'estimate'
    status: text('status').$type<DocumentStatus>().notNull().default('draft'),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    templateId: text('template_id').references(() => documentTemplates.id, { onDelete: 'set null' }),
    convertedToDocumentId: text('converted_to_document_id'), // Estimate -> Invoice linkage
    sourceEstimateId: text('source_estimate_id'), // Invoice -> Estimate linkage
    issueDate: text('issue_date').notNull(), // ISO YYYY-MM-DD
    dueDate: text('due_date').notNull(), // ISO YYYY-MM-DD (or expiry date for estimate)
    currency: text('currency').notNull().default('USD'),
    discountType: text('discount_type').$type<DiscountType>().notNull().default('percentage'),
    discountValue: real('discount_value').notNull().default(0),
    subtotal: real('subtotal').notNull().default(0),
    discountTotal: real('discount_total').notNull().default(0),
    taxTotal: real('tax_total').notNull().default(0),
    total: real('total').notNull().default(0),
    amountPaid: real('amount_paid').notNull().default(0),
    amountDue: real('amount_due').notNull().default(0),
    notes: text('notes'),
    terms: text('terms'),
    pdfR2Key: text('pdf_r2_key'),
    attachments: text('attachments', { mode: 'json' }).$type<DocumentAttachment[]>().notNull().default([]),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('documents_number_idx').on(table.documentNumber),
    index('documents_type_status_idx').on(table.type, table.status),
    index('documents_client_id_idx').on(table.clientId),
    index('documents_issue_date_idx').on(table.issueDate),
  ]
);

// ============================================================================
// DOCUMENT LINE ITEMS
// ============================================================================

export const documentItems = sqliteTable(
  'document_items',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull(),
    description: text('description').default(''),
    quantity: real('quantity').notNull().default(1),
    unit: text('unit').notNull().default('hrs'),
    unitPrice: real('unit_price').notNull().default(0),
    discountType: text('discount_type').$type<DiscountType>().notNull().default('percentage'),
    discountValue: real('discount_value').notNull().default(0),
    taxName: text('tax_name').default('Tax'),
    taxRate: real('tax_rate').notNull().default(0), // Percentage e.g. 8.25
    taxCompound: integer('tax_compound', { mode: 'boolean' }).notNull().default(false),
    secondTaxName: text('second_tax_name'),
    secondTaxRate: real('second_tax_rate').notNull().default(0),
    secondTaxCompound: integer('second_tax_compound', { mode: 'boolean' }).notNull().default(false),
    lineSubtotal: real('line_subtotal').notNull().default(0),
    lineDiscountAmount: real('line_discount_amount').notNull().default(0),
    lineTaxAmount: real('line_tax_amount').notNull().default(0),
    lineTotal: real('line_total').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index('document_items_doc_id_idx').on(table.documentId)]
);

// ============================================================================
// AUDIT LOGS
// ============================================================================

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    action: text('action').notNull(), // e.g., 'invoice.status_transition', 'estimate.converted', 'csv.imported'
    entityType: text('entity_type').notNull(), // 'client' | 'invoice' | 'estimate' | 'template' | 'import'
    entityId: text('entity_id').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text('ip_address'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_created_at_idx').on(table.createdAt),
  ]
);

// ============================================================================
// RELATIONS
// ============================================================================

export const clientsRelations = relations(clients, ({ many }) => ({
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  client: one(clients, {
    fields: [documents.clientId],
    references: [clients.id],
  }),
  template: one(documentTemplates, {
    fields: [documents.templateId],
    references: [documentTemplates.id],
  }),
  items: many(documentItems),
}));

export const documentItemsRelations = relations(documentItems, ({ one }) => ({
  document: one(documents, {
    fields: [documentItems.documentId],
    references: [documents.id],
  }),
}));
