CREATE TABLE IF NOT EXISTS `email_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text REFERENCES `documents`(`id`) ON DELETE SET NULL,
  `document_number` text NOT NULL,
  `document_type` text NOT NULL,
  `recipient_email` text NOT NULL,
  `recipient_name` text,
  `sender_email` text NOT NULL,
  `subject` text NOT NULL,
  `status` text NOT NULL,
  `message_id` text,
  `error_message` text,
  `actor_email` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS `email_logs_doc_idx` ON `email_logs` (`document_id`);
CREATE INDEX IF NOT EXISTS `email_logs_status_idx` ON `email_logs` (`status`);
CREATE INDEX IF NOT EXISTS `email_logs_recipient_idx` ON `email_logs` (`recipient_email`);
CREATE INDEX IF NOT EXISTS `email_logs_created_at_idx` ON `email_logs` (`created_at`);
