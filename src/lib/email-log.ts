import { emailLogs, type DocumentType, type EmailDispatchStatus } from '../db/schema';
import type { AppDatabase } from '../db/client';
import type { AuthenticatedUser } from './auth';

export interface EmailLogInput {
  db: AppDatabase;
  documentId?: string | null;
  documentNumber: string;
  documentType: DocumentType;
  recipientEmail: string;
  recipientName?: string | null;
  senderEmail: string;
  subject: string;
  status: EmailDispatchStatus;
  messageId?: string | null;
  errorMessage?: string | null;
  user?: AuthenticatedUser | null;
}

export async function recordEmailLog(input: EmailLogInput): Promise<void> {
  try {
    await input.db.insert(emailLogs).values({
      id: `eml_${crypto.randomUUID()}`,
      documentId: input.documentId ?? null,
      documentNumber: input.documentNumber,
      documentType: input.documentType,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? null,
      senderEmail: input.senderEmail,
      subject: input.subject,
      status: input.status,
      messageId: input.messageId ?? null,
      errorMessage: input.errorMessage ?? null,
      actorEmail: input.user?.email ?? 'system',
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn('[EmailLog] Non-fatal error writing email log:', err);
  }
}
