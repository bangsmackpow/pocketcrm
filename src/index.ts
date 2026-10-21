import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { desc } from 'drizzle-orm';
import {
  sessionMiddleware,
  requireRole,
  type AppEnv,
} from './lib/auth';
import { authRoutes } from './routes/auth';
import { clientRoutes } from './routes/clients';
import { invoiceRoutes } from './routes/invoices';
import { estimateRoutes } from './routes/estimates';
import { importRoutes } from './routes/import';
import { templateRoutes } from './routes/templates';
import { itemRoutes } from './routes/items';
import {
  clients,
  documents,
  auditLogs,
} from './db/schema';
import { getR2Object } from './lib/r2';
import { roundCurrency } from './lib/calculations';

const app = new Hono<AppEnv>();

// 1. Universal Security Response Headers Middleware
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (c.req.url.startsWith('https://')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
});

app.use('/api/*', logger());

// 2. Strict CORS Allowlist Validation
function isAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (
      host === 'pocketcrm.builtnetworks.com' ||
      host === 'builtnetworks.com' ||
      host.endsWith('.builtnetworks.com') ||
      host === 'pocketcrm.curtislamasters.workers.dev' ||
      host.endsWith('.workers.dev') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    ) {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

app.use(
  '/api/*',
  cors({
    origin: (origin) => isAllowedOrigin(origin),
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  })
);
app.use('/api/*', sessionMiddleware);

// 3. Centralized Production Error Boundary
app.onError((err, c) => {
  console.error('[Unhandled Server Exception]', err);
  const rayId = c.req.header('cf-ray') || crypto.randomUUID();
  return c.json(
    {
      error: 'InternalServerError',
      message: 'An unexpected system error occurred. Please try again or contact support.',
      requestId: rayId,
    },
    500
  );
});

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: c.env.APP_NAME || 'PocketCRM Edge',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Executive Dashboard KPIs & Recent Activity
 */
app.get('/api/dashboard', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const [allClients, allDocs, recentAudits] = await Promise.all([
    db.select().from(clients),
    db.select().from(documents).orderBy(desc(documents.issueDate)),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(15),
  ]);

  const invoices = allDocs.filter((d) => d.type === 'invoice');
  const estimates = allDocs.filter((d) => d.type === 'estimate');

  const totalInvoiced = roundCurrency(
    invoices
      .filter((i) => i.status !== 'cancelled')
      .reduce((acc, i) => acc + i.total, 0)
  );
  const totalCollected = roundCurrency(
    invoices
      .filter((i) => i.status !== 'cancelled')
      .reduce((acc, i) => acc + i.amountPaid, 0)
  );
  const totalOutstanding = roundCurrency(
    invoices
      .filter((i) => ['sent', 'partial', 'overdue'].includes(i.status))
      .reduce((acc, i) => acc + i.amountDue, 0)
  );
  const overdueAmount = roundCurrency(
    invoices
      .filter((i) => i.status === 'overdue')
      .reduce((acc, i) => acc + i.amountDue, 0)
  );
  const openPipelineValue = roundCurrency(
    estimates
      .filter((e) => ['draft', 'sent', 'approved'].includes(e.status))
      .reduce((acc, e) => acc + e.total, 0)
  );

  return c.json({
    kpis: {
      activeClients: allClients.filter((cl) => cl.isActive).length,
      totalInvoiced,
      totalCollected,
      totalOutstanding,
      overdueAmount,
      openPipelineValue,
      invoiceCount: invoices.length,
      estimateCount: estimates.length,
    },
    recentAudits,
  });
});

/**
 * R2 Object Reader Route (/api/storage/:key+)
 * Restricted to verified public logos and rendered PDFs; blocks path traversal and internal backup dumps.
 */
app.get('/api/storage/*', requireRole('viewer'), async (c) => {
  const rawKey = c.req.path.replace(/^\/api\/storage\//, '');
  if (!rawKey || !c.env.STORAGE) {
    return c.json({ error: 'Storage key not found' }, 404);
  }

  // Normalize key & verify allowed prefixes
  const key = rawKey.replace(/^\/+/, '');
  const isAllowed =
    (key.startsWith('logos/') ||
      key.startsWith('pdfs/invoices/') ||
      key.startsWith('pdfs/estimates/')) &&
    !key.includes('..');

  if (!isAllowed) {
    return c.json(
      {
        error: 'Forbidden',
        message: 'Direct access to this storage path is restricted.',
      },
      403
    );
  }

  const obj = await getR2Object(c.env.STORAGE, key);
  if (!obj) {
    return c.json({ error: 'Object not found in R2' }, 404);
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers });
});

// Mount core domain routes
app.route('/api/auth', authRoutes);
app.route('/api/clients', clientRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/estimates', estimateRoutes);
app.route('/api/import', importRoutes);
app.route('/api/templates', templateRoutes);
app.route('/api/items', itemRoutes);

// Fallback to Cloudflare Pages/Workers SPA static assets
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json(
    {
      error: 'Not Found',
      message: 'API route not found and static ASSETS binding is not attached.',
    },
    404
  );
});

export default app;
