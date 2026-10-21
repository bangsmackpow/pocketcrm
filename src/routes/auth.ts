import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
  createAuth,
  requireRole,
  type AppEnv,
} from '../lib/auth';
import { rateLimit } from '../lib/rate-limit';
import { users, accounts, auditLogs } from '../db/schema';
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
 * Public registration is explicitly disabled (managed accounts only)
 */
authRoutes.post('/sign-up/email', (c) => {
  return c.json(
    {
      error: 'RegistrationDisabled',
      message: 'Self-serve registration is disabled. Please contact an administrator or manager.',
    },
    403
  );
});

/**
 * User Manager: List all users (Admin & Member/Manager access)
 */
authRoutes.get('/users', requireRole('member'), async (c) => {
  const db = c.get('db');
  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      banned: users.banned,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return c.json({ users: allUsers });
});

/**
 * User Manager: Create new managed user (Admin only)
 */
const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

authRoutes.post(
  '/users',
  requireRole('admin'),
  zValidator('json', createUserSchema),
  async (c) => {
    const db = c.get('db');
    const actor = c.get('user');
    const body = c.req.valid('json');

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);

    if (existing) {
      return c.json({ error: 'A user with this email already exists.' }, 409);
    }

    const now = new Date();
    const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const hashedPassword = await hashPassword(body.password);

    const [newUser] = await db
      .insert(users)
      .values({
        id: userId,
        name: body.name,
        email: body.email.toLowerCase(),
        emailVerified: true,
        role: body.role,
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(accounts).values({
      id: `acc_${crypto.randomUUID().slice(0, 12)}`,
      accountId: userId,
      providerId: 'credential',
      userId: userId,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditLog({
      db,
      user: actor,
      action: 'user.created_by_admin',
      entityType: 'user',
      entityId: userId,
      metadata: { name: body.name, email: body.email, role: body.role },
    });

    return c.json({ user: newUser }, 201);
  }
);

/**
 * User Manager: Update user info (name, email, role, banned status)
 */
const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  banned: z.boolean().optional(),
});

authRoutes.put(
  '/users/:id',
  requireRole('admin'),
  zValidator('json', updateUserSchema),
  async (c) => {
    const db = c.get('db');
    const actor = c.get('user');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Safety: Prevent an admin from demoting or banning their own active account
    if (actor?.id === id) {
      if (body.role && body.role !== 'admin') {
        return c.json({ error: 'SelfDemotionForbidden', message: 'You cannot revoke your own administrator privileges.' }, 400);
      }
      if (body.banned === true) {
        return c.json({ error: 'SelfBanForbidden', message: 'You cannot ban your own active account.' }, 400);
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.email ? { email: body.email.toLowerCase() } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.banned !== undefined ? { banned: body.banned } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    await recordAuditLog({
      db,
      user: actor,
      action: 'user.updated_by_admin',
      entityType: 'user',
      entityId: id,
      metadata: body,
    });

    return c.json({ user: updated });
  }
);

/**
 * User Manager: Reset user password (Admin only)
 */
const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

authRoutes.post(
  '/users/:id/reset-password',
  requireRole('admin'),
  zValidator('json', resetPasswordSchema),
  async (c) => {
    const db = c.get('db');
    const actor = c.get('user');
    const id = c.req.param('id');
    const { newPassword } = c.req.valid('json');

    const [targetUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!targetUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    const hashedPassword = await hashPassword(newPassword);
    const now = new Date();

    const [acc] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, id))
      .limit(1);

    if (acc) {
      await db
        .update(accounts)
        .set({
          password: hashedPassword,
          updatedAt: now,
        })
        .where(eq(accounts.id, acc.id));
    } else {
      await db.insert(accounts).values({
        id: `acc_${crypto.randomUUID().slice(0, 12)}`,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      });
    }

    await recordAuditLog({
      db,
      user: actor,
      action: 'user.password_reset_by_admin',
      entityType: 'user',
      entityId: id,
      metadata: { userEmail: targetUser.email },
    });

    return c.json({ success: true, message: 'Password reset successfully' });
  }
);

/**
 * User Manager: Delete user (Admin only)
 */
authRoutes.delete('/users/:id', requireRole('admin'), async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const id = c.req.param('id');

  if (actor?.id === id) {
    return c.json({ error: 'You cannot delete your own account.' }, 400);
  }

  await db.delete(users).where(eq(users.id, id));

  await recordAuditLog({
    db,
    user: actor,
    action: 'user.deleted_by_admin',
    entityType: 'user',
    entityId: id,
  });

  return c.json({ success: true, id });
});

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
 * Rate-limited Sign-In Route (Prevents credential stuffing & brute-force attacks)
 */
authRoutes.post(
  '/sign-in/email',
  rateLimit({
    windowMs: 60_000,
    max: 5,
    keyPrefix: 'auth_login',
    message: 'Too many failed login attempts. Please wait 1 minute before trying again.',
  }),
  async (c) => {
    const auth = createAuth(c.env);
    return auth.handler(c.req.raw);
  }
);

/**
 * Delegate standard Better Auth endpoints:
 * - POST /api/auth/sign-in/email
 * - POST /api/auth/sign-out
 * - GET  /api/auth/get-session
 */
authRoutes.on(['GET', 'POST'], '/*', async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});
