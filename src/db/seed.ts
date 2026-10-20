import fs from 'node:fs';
import path from 'node:path';
import { createLocalSqliteClient } from './client';
import {
  users,
  clients,
  documentTemplates,
  documents,
  documentItems,
  auditLogs,
} from './schema';

async function seed() {
  const dbPath =
    process.env.LOCAL_SQLITE_PATH ||
    path.resolve(process.cwd(), '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/pocketcrm.sqlite');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  console.log(`[Seed] Initializing offline SQLite database at: ${dbPath}`);
  const { db, raw } = await createLocalSqliteClient(dbPath);

  // Apply initial migration SQL if tables don't exist
  const migrationPath = path.resolve(process.cwd(), 'src/db/migrations/0000_initial_schema.sql');
  if (fs.existsSync(migrationPath)) {
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      raw.exec(stmt);
    }
  }

  const now = new Date();

  // 1. Seed Users (Admin, Member, Viewer)
  const seedUsers = [
    {
      id: 'usr_admin_01',
      name: 'Elena Vance (Admin)',
      email: 'admin@pocketcrm.dev',
      emailVerified: true,
      role: 'admin' as const,
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'usr_member_01',
      name: 'Marcus Sterling (Account Exec)',
      email: 'marcus@pocketcrm.dev',
      emailVerified: true,
      role: 'member' as const,
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'usr_viewer_01',
      name: 'Aria Chen (Auditor)',
      email: 'auditor@pocketcrm.dev',
      emailVerified: true,
      role: 'viewer' as const,
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const u of seedUsers) {
    db.insert(users).values(u).onConflictDoNothing().run();
  }

  // 2. Seed Default Document Template
  const defaultTemplateId = 'tpl_modern_slate';
  db.insert(documentTemplates)
    .values({
      id: defaultTemplateId,
      name: 'Executive Slate (Default)',
      isDefault: true,
      logoPlacement: 'left',
      companyHeaderText: 'PocketCRM Cloud Enterprise LLC\n742 Evergreen Terrace, Suite 400\nAustin, TX 78701 • Tax ID: US-94-8821034',
      paymentInstructions:
        'Wire / ACH: Silicon Valley Commercial Bank • Routing: 121000358 • Account: 8839201944\nPlease reference the Document Number on remittance advice.',
      footerLegalClause:
        'All quotes are valid for 30 days from issue date. Past-due invoices accrue 1.5% monthly interest or the maximum permitted by law.',
      styles: {
        primaryColor: '#0f172a',
        accentColor: '#2563eb',
        fontFamily: 'Inter, system-ui, sans-serif',
        headerBg: '#f8fafc',
        tableBorderColor: '#e2e8f0',
        customCssVars: {
          '--doc-border-radius': '8px',
          '--doc-header-padding': '24px',
          '--doc-badge-style': 'pill',
        },
      },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  // 3. Seed Clients
  const seedClients = [
    {
      id: 'cli_acme_corp',
      code: 'CLI-ACME',
      companyName: 'Acme Orbital Logistics',
      contactName: 'Wile E. Coyote',
      email: 'ap@acme-orbital.io',
      phone: '+1 (415) 890-2311',
      website: 'https://acme-orbital.io',
      taxIdentifier: 'US-EIN-77-0491823',
      paymentTermsDays: 30,
      currency: 'USD',
      billingAddress: {
        line1: '100 Propulsion Way',
        line2: 'Building B',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94107',
        country: 'US',
      },
      contacts: [
        {
          name: 'Wile E. Coyote',
          email: 'ap@acme-orbital.io',
          phone: '+1 (415) 890-2311',
          role: 'VP Procurement',
          isPrimary: true,
        },
      ],
      notes: 'Enterprise tier partner. Prefer consolidated monthly invoicing.',
      isActive: true,
      createdBy: 'usr_admin_01',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cli_lumon_ind',
      code: 'CLI-LUMON',
      companyName: 'Lumon Biotech Industries',
      contactName: 'Harmony Cobel',
      email: 'finance@lumon.industries',
      phone: '+1 (212) 555-0192',
      website: 'https://lumon.industries',
      taxIdentifier: 'US-EIN-13-9920112',
      paymentTermsDays: 15,
      currency: 'USD',
      billingAddress: {
        line1: '1 Kier Plaza',
        city: 'Kier',
        state: 'NJ',
        postalCode: '07030',
        country: 'US',
      },
      contacts: [
        {
          name: 'Harmony Cobel',
          email: 'finance@lumon.industries',
          role: 'Director of Operations',
          isPrimary: true,
        },
      ],
      notes: 'Strict Net-15 compliance.',
      isActive: true,
      createdBy: 'usr_admin_01',
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const c of seedClients) {
    db.insert(clients).values(c).onConflictDoNothing().run();
  }

  // 4. Seed Sample Invoice & Estimate
  db.insert(documents)
    .values({
      id: 'doc_inv_2026_001',
      documentNumber: 'INV-2026-0001',
      type: 'invoice',
      status: 'sent',
      clientId: 'cli_acme_corp',
      templateId: defaultTemplateId,
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      currency: 'USD',
      discountType: 'percentage',
      discountValue: 5,
      subtotal: 8000,
      discountTotal: 400,
      taxTotal: 627,
      total: 8227,
      amountPaid: 0,
      amountDue: 8227,
      notes: 'Q4 Dedicated Edge Infrastructure Retainer & Security Audit.',
      terms: 'Net 30 days',
      createdBy: 'usr_admin_01',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  db.insert(documentItems)
    .values([
      {
        id: 'item_inv_001_1',
        documentId: 'doc_inv_2026_001',
        sortOrder: 0,
        name: 'Cloudflare Workers Edge Architecture Retainer',
        description: 'Dedicated high-availability D1 + R2 infrastructure engineering (40 hrs)',
        quantity: 40,
        unit: 'hrs',
        unitPrice: 150,
        discountType: 'percentage',
        discountValue: 0,
        taxName: 'State Tax',
        taxRate: 8.25,
        taxCompound: false,
        secondTaxRate: 0,
        secondTaxCompound: false,
        lineSubtotal: 6000,
        lineDiscountAmount: 0,
        lineTaxAmount: 470.25,
        lineTotal: 6470.25,
        createdAt: now,
      },
      {
        id: 'item_inv_001_2',
        documentId: 'doc_inv_2026_001',
        sortOrder: 1,
        name: 'Penetration Testing & Zero-Trust Hardening',
        description: 'Comprehensive RBAC and API endpoint verification',
        quantity: 10,
        unit: 'hrs',
        unitPrice: 200,
        discountType: 'percentage',
        discountValue: 0,
        taxName: 'State Tax',
        taxRate: 8.25,
        taxCompound: false,
        secondTaxRate: 0,
        secondTaxCompound: false,
        lineSubtotal: 2000,
        lineDiscountAmount: 0,
        lineTaxAmount: 156.75,
        lineTotal: 2156.75,
        createdAt: now,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(documents)
    .values({
      id: 'doc_est_2026_001',
      documentNumber: 'EST-2026-0001',
      type: 'estimate',
      status: 'approved',
      clientId: 'cli_lumon_ind',
      templateId: defaultTemplateId,
      issueDate: '2026-10-10',
      dueDate: '2026-11-10',
      currency: 'USD',
      discountType: 'fixed',
      discountValue: 250,
      subtotal: 4500,
      discountTotal: 250,
      taxTotal: 340,
      total: 4590,
      amountPaid: 0,
      amountDue: 4590,
      notes: 'Custom telemetry pipeline & automated reporting portal.',
      terms: 'Valid for 30 days',
      createdBy: 'usr_member_01',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  db.insert(documentItems)
    .values({
      id: 'item_est_001_1',
      documentId: 'doc_est_2026_001',
      sortOrder: 0,
      name: 'Biometric Telemetry Data Ingestion Module',
      description: 'Batch CSV + stream ingestion with D1 atomic commits',
      quantity: 30,
      unit: 'hrs',
      unitPrice: 150,
      discountType: 'percentage',
      discountValue: 0,
      taxName: 'NJ Sales Tax',
      taxRate: 8.0,
      taxCompound: false,
      secondTaxRate: 0,
      secondTaxCompound: false,
      lineSubtotal: 4500,
      lineDiscountAmount: 0,
      lineTaxAmount: 340,
      lineTotal: 4840,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();

  db.insert(auditLogs)
    .values({
      id: 'aud_seed_001',
      actorId: 'usr_admin_01',
      actorEmail: 'admin@pocketcrm.dev',
      action: 'system.seeded',
      entityType: 'system',
      entityId: 'pocketcrm',
      metadata: {
        usersCount: 3,
        clientsCount: 2,
        documentsCount: 2,
      },
      ipAddress: '127.0.0.1',
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();

  console.log('[Seed] Successfully seeded offline SQLite database.');
  raw.close();
}

seed().catch((err) => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
