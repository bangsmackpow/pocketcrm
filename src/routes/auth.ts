import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import {
  createAuth,
  requireRole,
  type AppEnv,
} from '../lib/auth';
import { users, auditLogs } from '../db/schema';
import { recordAuditLog } from '../lib/audit';

export const authRoutes = new Hono<AppEnv>();

/**
 * Current authenticated user session endpoint
 */
authRoutes.get('/me', async (c) => {
  const currentUser = c.get('user');
  return c.json({
    user: currentUser,
  });
});

/**
 * Admin-only: Update a user's RBAC role ('admin' | 'member' | 'viewer')
 */
const updateRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']),
  banned: z.boolean().optional(),
});

authRoutes.patch(
  '/users/:id/role',
  requireRole('admin'),
  zValidator('json', updateRoleSchema),
  async (c) => {
    const db = c.get('db');
    const actor = c.get('user');
    const targetId = c.req.param('id');
    const body = c.req.valid('json');

    const [updated] = await db
      .update(users)
      .set({
        role: body.role,
        ...(body.banned !== undefined ? { banned: body.banned } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetId))
      .returning();

    if (!updated) {
      return c.json({ error: 'User not found' }, 404);
    }

    await recordAuditLog({
      db,
      user: actor,
      action: 'user.role_updated',
      entityType: 'user',
      entityId: targetId,
      metadata: { newRole: body.role, banned: body.banned },
    });

    return c.json({ user: updated });
  }
);

/**
 * Audit Logs viewer (accessible to authenticated users with minimum viewer role)
 */
authRoutes.get('/audit-logs', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const logs = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);

  return c.json({ auditLogs: logs });
});

/**
 * Delegate standard Better Auth endpoints:
 * - POST /api/auth/sign-in/email
 * - POST /api/auth/sign-up/email
 * - POST /api/auth/sign-out
 * - GET  /api/auth/get-session
 */
authRoutes.on(['GET', 'POST'], '/*', async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});
