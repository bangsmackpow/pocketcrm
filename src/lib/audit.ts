import { auditLogs } from '../db/schema';
import type { AppDatabase } from '../db/client';
import type { AuthenticatedUser } from './auth';

export interface AuditLogInput {
  db: AppDatabase;
  user?: AuthenticatedUser | null;
  action: string;
  entityType: 'client' | 'invoice' | 'estimate' | 'template' | 'import' | 'user' | 'system';
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await input.db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID()}`,
      actorId: input.user?.id ?? null,
      actorEmail: input.user?.email ?? 'system@pocketcrm.dev',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn('[AuditLog] Non-fatal error writing audit log:', err);
  }
}
