import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.LOCAL_SQLITE_PATH || './.wrangler/state/v3/d1/miniflare-D1DatabaseObject/pocketcrm.sqlite',
  },
  verbose: true,
  strict: true,
});
