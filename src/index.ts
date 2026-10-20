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

app.use('/api/*', logger());
app.use(
  '/api/*',
  cors({
    origin: (origin) => origin || '*',
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'x-demo-user-id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);
app.use('/api/*', sessionMiddleware);

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
 */
app.get('/api/storage/*', requireRole('viewer'), async (c) => {
  const key = c.req.path.replace(/^\/api\/storage\//, '');
  if (!key || !c.env.STORAGE) {
    return c.json({ error: 'Storage key not found' }, 404);
  }
  const obj = await getR2Object(c.env.STORAGE, key);
  if (!obj) {
    return c.json({ error: 'Object not found in R2' }, 404);
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
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
