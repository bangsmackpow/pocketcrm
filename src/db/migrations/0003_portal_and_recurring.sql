-- Migration: 0003_portal_and_recurring.sql
-- Adds public portal token, acceptance metadata, and Stripe transaction columns to documents
ALTER TABLE documents ADD COLUMN portal_token TEXT;
ALTER TABLE documents ADD COLUMN portal_token_created_at INTEGER;
ALTER TABLE documents ADD COLUMN accepted_at INTEGER;
ALTER TABLE documents ADD COLUMN accepted_by_signature TEXT;
ALTER TABLE documents ADD COLUMN accepted_by_email TEXT;
ALTER TABLE documents ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE documents ADD COLUMN stripe_payment_intent_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS documents_portal_token_idx ON documents(portal_token);

-- Payments ledger
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL,
  transaction_reference TEXT,
  notes TEXT,
  actor_email TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS payments_doc_idx ON payments(document_id);
CREATE INDEX IF NOT EXISTS payments_ref_idx ON payments(transaction_reference);
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON payments(created_at);

-- Recurring Retainers & Schedules
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  template_id TEXT REFERENCES document_templates(id) ON DELETE SET NULL,
  profile_name TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  next_run_date TEXT NOT NULL,
  last_run_date TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  discount_type TEXT NOT NULL DEFAULT 'percentage',
  discount_value REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  auto_send_mode TEXT NOT NULL DEFAULT 'draft_only',
  send_admin_reminder INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS recurring_schedules_client_idx ON recurring_schedules(client_id);
CREATE INDEX IF NOT EXISTS recurring_schedules_next_run_idx ON recurring_schedules(status, next_run_date);

-- Recurring Schedule Line Items
CREATE TABLE IF NOT EXISTS recurring_schedule_items (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES recurring_schedules(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'hrs',
  unit_price REAL NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'percentage',
  discount_value REAL NOT NULL DEFAULT 0,
  tax_name TEXT DEFAULT 'Tax',
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_compound INTEGER NOT NULL DEFAULT 0,
  second_tax_name TEXT,
  second_tax_rate REAL NOT NULL DEFAULT 0,
  second_tax_compound INTEGER NOT NULL DEFAULT 0,
  line_subtotal REAL NOT NULL DEFAULT 0,
  line_discount_amount REAL NOT NULL DEFAULT 0,
  line_tax_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS rec_items_schedule_idx ON recurring_schedule_items(schedule_id);
CREATE INDEX IF NOT EXISTS rec_items_sort_idx ON recurring_schedule_items(schedule_id, sort_order);
