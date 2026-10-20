-- PocketCRM Initial Remote Seed

INSERT OR IGNORE INTO users (id, name, email, email_verified, role, banned, created_at, updated_at)
VALUES 
  ('usr_admin_01', 'Elena Vance (Admin)', 'admin@pocketcrm.dev', 1, 'admin', 0, unixepoch() * 1000, unixepoch() * 1000),
  ('usr_member_01', 'Marcus Sterling (Account Exec)', 'marcus@pocketcrm.dev', 1, 'member', 0, unixepoch() * 1000, unixepoch() * 1000),
  ('usr_viewer_01', 'Aria Chen (Auditor)', 'auditor@pocketcrm.dev', 1, 'viewer', 0, unixepoch() * 1000, unixepoch() * 1000);

-- Credential accounts with password 'Admin123!@#'
INSERT OR IGNORE INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
VALUES
  ('acc_admin_01', 'usr_admin_01', 'credential', 'usr_admin_01', '6e5bdf69dde0e8abfe437fde04e3164f:b9268875d38160e02edff056dcc2b684e5270e4dd8c0194683c1aaf3fb0a4fc44d429e93f315122bffd7536ae26e92c7806a4162656ababf920fc97a0d35c539', unixepoch() * 1000, unixepoch() * 1000),
  ('acc_member_01', 'usr_member_01', 'credential', 'usr_member_01', '6e5bdf69dde0e8abfe437fde04e3164f:b9268875d38160e02edff056dcc2b684e5270e4dd8c0194683c1aaf3fb0a4fc44d429e93f315122bffd7536ae26e92c7806a4162656ababf920fc97a0d35c539', unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO document_templates (id, name, is_default, logo_placement, company_header_text, payment_instructions, footer_legal_clause, styles, created_at, updated_at)
VALUES (
  'tpl_modern_slate',
  'Executive Slate (Default)',
  1,
  'left',
  'PocketCRM Cloud Enterprise LLC\n742 Evergreen Terrace, Suite 400\nAustin, TX 78701 • Tax ID: US-94-8821034',
  'Wire / ACH: Silicon Valley Commercial Bank • Routing: 121000358 • Account: 8839201944\nPlease reference the Document Number on remittance advice.',
  'All quotes are valid for 30 days from issue date. Past-due invoices accrue 1.5% monthly interest or the maximum permitted by law.',
  '{"primaryColor":"#0f172a","accentColor":"#2563eb","fontFamily":"Inter, system-ui, sans-serif","headerBg":"#f8fafc","tableBorderColor":"#e2e8f0","customCssVars":{"--doc-border-radius":"8px","--doc-header-padding":"24px"}}',
  unixepoch() * 1000,
  unixepoch() * 1000
);

INSERT OR IGNORE INTO clients (id, code, company_name, contact_name, email, phone, website, tax_identifier, payment_terms_days, currency, billing_address, contacts, notes, is_active, created_by, created_at, updated_at)
VALUES 
  ('cli_acme_corp', 'CLI-ACME', 'Acme Orbital Logistics', 'Wile E. Coyote', 'ap@acme-orbital.io', '+1 (415) 890-2311', 'https://acme-orbital.io', 'US-EIN-77-0491823', 30, 'USD', '{"line1":"100 Propulsion Way","city":"San Francisco","state":"CA","postalCode":"94107","country":"US"}', '[{"name":"Wile E. Coyote","email":"ap@acme-orbital.io","phone":"+1 (415) 890-2311","role":"VP Procurement","isPrimary":true}]', 'Enterprise tier partner.', 1, 'usr_admin_01', unixepoch() * 1000, unixepoch() * 1000),
  ('cli_lumon_ind', 'CLI-LUMON', 'Lumon Biotech Industries', 'Harmony Cobel', 'finance@lumon.industries', '+1 (212) 555-0192', 'https://lumon.industries', 'US-EIN-13-9920112', 15, 'USD', '{"line1":"1 Kier Plaza","city":"Kier","state":"NJ","postalCode":"07030","country":"US"}', '[{"name":"Harmony Cobel","email":"finance@lumon.industries","role":"Director of Operations","isPrimary":true}]', 'Strict Net-15 compliance.', 1, 'usr_admin_01', unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO documents (id, document_number, type, status, client_id, template_id, issue_date, due_date, currency, discount_type, discount_value, subtotal, discount_total, tax_total, total, amount_paid, amount_due, notes, terms, created_by, created_at, updated_at)
VALUES 
  ('doc_inv_2026_001', 'INV-2026-0001', 'invoice', 'sent', 'cli_acme_corp', 'tpl_modern_slate', '2026-10-01', '2026-10-31', 'USD', 'percentage', 5, 8000, 400, 627, 8227, 0, 8227, 'Q4 Dedicated Edge Infrastructure Retainer.', 'Net 30 days', 'usr_admin_01', unixepoch() * 1000, unixepoch() * 1000),
  ('doc_est_2026_001', 'EST-2026-0001', 'estimate', 'approved', 'cli_lumon_ind', 'tpl_modern_slate', '2026-10-10', '2026-11-10', 'USD', 'fixed', 250, 4500, 250, 340, 4590, 0, 4590, 'Custom telemetry pipeline & automated reporting portal.', 'Valid for 30 days', 'usr_member_01', unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO document_items (id, document_id, sort_order, name, description, quantity, unit, unit_price, discount_type, discount_value, tax_name, tax_rate, tax_compound, line_subtotal, line_discount_amount, line_tax_amount, line_total, created_at)
VALUES 
  ('item_inv_001_1', 'doc_inv_2026_001', 0, 'Cloudflare Workers Edge Architecture Retainer', 'Dedicated high-availability D1 + R2 infrastructure engineering', 40, 'hrs', 150, 'percentage', 0, 'State Tax', 8.25, 0, 6000, 0, 470.25, 6470.25, unixepoch() * 1000),
  ('item_inv_001_2', 'doc_inv_2026_001', 1, 'Penetration Testing & Zero-Trust Hardening', 'Comprehensive RBAC and API endpoint verification', 10, 'hrs', 200, 'percentage', 0, 'State Tax', 8.25, 0, 2000, 0, 156.75, 2156.75, unixepoch() * 1000),
  ('item_est_001_1', 'doc_est_2026_001', 0, 'Biometric Telemetry Data Ingestion Module', 'Batch CSV + stream ingestion with D1 atomic commits', 30, 'hrs', 150, 'percentage', 0, 'NJ Sales Tax', 8.0, 0, 4500, 0, 340, 4840, unixepoch() * 1000);

INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_email, action, entity_type, entity_id, metadata, ip_address, created_at)
VALUES ('aud_seed_001', 'usr_admin_01', 'admin@pocketcrm.dev', 'system.seeded', 'system', 'pocketcrm', '{"status":"ready"}', '127.0.0.1', unixepoch() * 1000);
