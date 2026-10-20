import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { createD1Client, type AppDatabase } from '../db/client';
import * as schema from '../db/schema';
import type { UserRole } from '../db/schema';

export interface CloudflareBindings {
  DB: D1Database;
  STORAGE: R2Bucket;
  ASSETS?: Fetcher;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  APP_NAME?: string;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AppVariables {
  db: AppDatabase;
  user: AuthenticatedUser | null;
}

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: AppVariables;
};

/**
 * Initializes a Better Auth instance bound to the request's Cloudflare D1 database via Drizzle.
 */
export function createAuth(env: CloudflareBindings) {
  const db = createD1Client(env.DB);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    secret: env.BETTER_AUTH_SECRET || 'pocketcrm-edge-secret-key-minimum-32-chars-2026',
    baseURL: env.BETTER_AUTH_URL || 'http://localhost:5173',
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'member',
          input: false,
        },
        banned: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
  });
}

const ROLE_WEIGHT: Record<UserRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
};

export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return (ROLE_WEIGHT[userRole] ?? 0) >= (ROLE_WEIGHT[requiredRole] ?? 99);
}

/**
 * Middleware that attaches the Drizzle D1 client and resolves the Better Auth session.
 * Also supports `x-demo-user-id` for quick interactive persona switching in demo/development mode.
 */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = createD1Client(c.env.DB);
  c.set('db', db);

  let resolvedUser: AuthenticatedUser | null = null;

  try {
    const auth = createAuth(c.env);
    const sessionData = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (sessionData?.user) {
      resolvedUser = {
        id: sessionData.user.id,
        name: sessionData.user.name,
        email: sessionData.user.email,
        role: ((sessionData.user as Record<string, unknown>).role as UserRole) || 'member',
      };
    }
  } catch {
    // Fallback to persona header or unauthenticated
  }

  if (!resolvedUser) {
    const demoUserId = c.req.header('x-demo-user-id');
    if (demoUserId) {
      try {
        const [found] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, demoUserId))
          .limit(1);
        if (found && !found.banned) {
          resolvedUser = {
            id: found.id,
            name: found.name,
            email: found.email,
            role: found.role,
          };
        }
      } catch {
        // Ignore if table not yet initialized
      }
    }
  }

  c.set('user', resolvedUser);
  await next();
});

/**
 * RBAC Guard Middleware requiring a minimum role ('viewer' | 'member' | 'admin').
 */
export function requireRole(minimumRole: UserRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Authentication required to access this resource.',
        },
        401
      );
    }

    if (!hasMinimumRole(user.role, minimumRole)) {
      return c.json(
        {
          error: 'Forbidden',
          message: `Insufficient permissions. Required role: ${minimumRole}, current role: ${user.role}.`,
        },
        403
      );
    }

    await next();
  });
}
