CREATE INDEX IF NOT EXISTS `document_items_doc_sort_idx` ON `document_items` (`document_id`, `sort_order`);
CREATE INDEX IF NOT EXISTS `audit_logs_action_idx` ON `audit_logs` (`action`);
