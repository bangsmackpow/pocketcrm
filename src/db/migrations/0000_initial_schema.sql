CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `email_verified` integer DEFAULT 0 NOT NULL,
  `image` text,
  `role` text DEFAULT 'member' NOT NULL,
  `banned` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_idx` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `token` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `ip_address` text,
  `user_agent` text,
  `user_id` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sessions_token_idx` ON `sessions` (`token`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_user_id_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `user_id` text NOT NULL,
  `access_token` text,
  `refresh_token` text,
  `id_token` text,
  `access_token_expires_at` integer,
  `refresh_token_expires_at` integer,
  `scope` text,
  `password` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `accounts_user_id_idx` ON `accounts` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verifications` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000),
  `updated_at` integer DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `clients` (
  `id` text PRIMARY KEY NOT NULL,
  `code` text NOT NULL,
  `company_name` text NOT NULL,
  `contact_name` text NOT NULL,
  `email` text NOT NULL,
  `phone` text,
  `website` text,
  `tax_identifier` text,
  `payment_terms_days` integer DEFAULT 30 NOT NULL,
  `currency` text DEFAULT 'USD' NOT NULL,
  `billing_address` text NOT NULL,
  `shipping_address` text,
  `contacts` text DEFAULT '[]' NOT NULL,
  `notes` text,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_by` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `clients_code_idx` ON `clients` (`code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `clients_email_idx` ON `clients` (`email`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `clients_company_name_idx` ON `clients` (`company_name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `is_default` integer DEFAULT 0 NOT NULL,
  `logo_r2_key` text,
  `logo_url` text,
  `logo_placement` text DEFAULT 'left' NOT NULL,
  `company_header_text` text DEFAULT 'PocketCRM Solutions Inc.' NOT NULL,
  `payment_instructions` text NOT NULL,
  `footer_legal_clause` text NOT NULL,
  `styles` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `documents` (
  `id` text PRIMARY KEY NOT NULL,
  `document_number` text NOT NULL,
  `type` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `client_id` text NOT NULL,
  `template_id` text,
  `converted_to_document_id` text,
  `source_estimate_id` text,
  `issue_date` text NOT NULL,
  `due_date` text NOT NULL,
  `currency` text DEFAULT 'USD' NOT NULL,
  `discount_type` text DEFAULT 'percentage' NOT NULL,
  `discount_value` real DEFAULT 0 NOT NULL,
  `subtotal` real DEFAULT 0 NOT NULL,
  `discount_total` real DEFAULT 0 NOT NULL,
  `tax_total` real DEFAULT 0 NOT NULL,
  `total` real DEFAULT 0 NOT NULL,
  `amount_paid` real DEFAULT 0 NOT NULL,
  `amount_due` real DEFAULT 0 NOT NULL,
  `notes` text,
  `terms` text,
  `pdf_r2_key` text,
  `attachments` text DEFAULT '[]' NOT NULL,
  `created_by` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`template_id`) REFERENCES `document_templates`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `documents_number_idx` ON `documents` (`document_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_type_status_idx` ON `documents` (`type`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_client_id_idx` ON `documents` (`client_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_issue_date_idx` ON `documents` (`issue_date`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_items` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '',
  `quantity` real DEFAULT 1 NOT NULL,
  `unit` text DEFAULT 'hrs' NOT NULL,
  `unit_price` real DEFAULT 0 NOT NULL,
  `discount_type` text DEFAULT 'percentage' NOT NULL,
  `discount_value` real DEFAULT 0 NOT NULL,
  `tax_name` text DEFAULT 'Tax',
  `tax_rate` real DEFAULT 0 NOT NULL,
  `tax_compound` integer DEFAULT 0 NOT NULL,
  `second_tax_name` text,
  `second_tax_rate` real DEFAULT 0 NOT NULL,
  `second_tax_compound` integer DEFAULT 0 NOT NULL,
  `line_subtotal` real DEFAULT 0 NOT NULL,
  `line_discount_amount` real DEFAULT 0 NOT NULL,
  `line_tax_amount` real DEFAULT 0 NOT NULL,
  `line_total` real DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_items_doc_id_idx` ON `document_items` (`document_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `catalog_items` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '',
  `unit_price` real DEFAULT 0 NOT NULL,
  `unit` text DEFAULT 'hrs' NOT NULL,
  `default_tax_rate` real DEFAULT 0 NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text,
  `actor_email` text,
  `action` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL,
  `ip_address` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_entity_idx` ON `audit_logs` (`entity_type`, `entity_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);
