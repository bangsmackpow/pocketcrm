import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './auth';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

let lastCleanup = Date.now();
function cleanupStaleEntries() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.resetAt) {
      memoryStore.delete(key);
    }
  }
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  keyGenerator?: (c: any) => string;
  message?: string;
}

/**
 * Edge-compatible in-isolate sliding window rate limiter
 */
export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyPrefix = 'rl',
    keyGenerator = (c) =>
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for') ||
      c.req.header('x-real-ip') ||
      'anonymous-ip',
    message = 'Too many requests. Please wait and try again later.',
  } = options;

  return createMiddleware<AppEnv>(async (c, next) => {
    cleanupStaleEntries();

    const clientKey = keyGenerator(c);
    const fullKey = `${keyPrefix}:${clientKey}`;
    const now = Date.now();

    let record = memoryStore.get(fullKey);
    if (!record || now > record.resetAt) {
      record = { count: 1, resetAt: now + windowMs };
      memoryStore.set(fullKey, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSeconds));

    if (record.count > max) {
      c.header('Retry-After', String(resetSeconds));
      return c.json(
        {
          error: 'TooManyRequests',
          message,
          retryAfterSeconds: resetSeconds,
        },
        429
      );
    }

    await next();
  });
}
