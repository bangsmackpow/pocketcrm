import { drizzle as drizzleD1, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type AppDatabase = DrizzleD1Database<typeof schema>;

/**
 * Primary runtime database factory for Cloudflare Workers (D1 binding).
 */
export function createD1Client(d1: D1Database): AppDatabase {
  return drizzleD1(d1, { schema });
}

/**
 * Offline / CLI local database factory using better-sqlite3.
 * Strictly used for local offline migration & seeding scripts outside Worker runtime.
 */
export async function createLocalSqliteClient(sqliteFilePath?: string) {
  const [{ default: Database }, { drizzle: drizzleSqlite }] = await Promise.all([
    import('better-sqlite3'),
    import('drizzle-orm/better-sqlite3'),
  ]);

  const resolvedPath =
    sqliteFilePath ||
    process.env.LOCAL_SQLITE_PATH ||
    './.wrangler/state/v3/d1/miniflare-D1DatabaseObject/pocketcrm.sqlite';

  const sqlite = new Database(resolvedPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return {
    db: drizzleSqlite(sqlite, { schema }),
    raw: sqlite,
  };
}
