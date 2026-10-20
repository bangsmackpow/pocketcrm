# PocketCRM — Edge CRM, Quoting & Invoicing System

Production-grade CRM, Quoting/Estimating, and Invoicing platform built on **Cloudflare Workers/Pages**, **Cloudflare D1**, **Cloudflare R2**, **Drizzle ORM**, **Better Auth (RBAC)**, **Hono**, and **React + Tailwind CSS + Radix UI**.

---

## Architecture & Repository Layout

```text
├── src/
│   ├── db/
│   │   ├── schema.ts          # Drizzle ORM SQLite/D1 schema (users, sessions, accounts, clients, documents, document_items, document_templates, audit_logs)
│   │   ├── client.ts          # Dual-driver factory: Drizzle D1 (Worker runtime) + better-sqlite3 (offline CLI migrations/seeding)
│   │   ├── seed.ts            # Offline local SQLite seeder (users, clients, templates, invoices, estimates)
│   │   └── migrations/        # SQL migrations applied to local/remote Cloudflare D1
│   ├── lib/
│   │   ├── auth.ts            # Better Auth + Drizzle D1 adapter & RBAC middleware (admin, member, viewer)
│   │   ├── calculations.ts    # Line items engine (unit prices, quantities, discounts, simple & compound taxes) + state machine validators
│   │   ├── csv-parser.ts      # PapaParse + Zod deterministic CSV parser & document/line-item grouping
│   │   ├── pdf.ts             # Configurable HTML template & native PDF 1.4 edge binary generator
│   │   ├── r2.ts              # Cloudflare R2 storage adapter (PDFs, attachments, CSV import backups)
│   │   └── audit.ts           # Immutable audit trail logger
│   ├── routes/
│   │   ├── auth.ts            # Better Auth endpoints + RBAC role management + audit logs
│   │   ├── clients.ts         # CRM Client CRUD (contacts, billing/shipping addresses, tax IDs, payment terms)
│   │   ├── estimates.ts       # Estimates/Quotes workflow (Draft -> Sent -> Approved/Rejected -> Converted to Invoice)
│   │   ├── invoices.ts        # Invoices workflow (Draft -> Sent -> Partial/Paid -> Overdue -> Cancelled) + payments & R2 attachments
│   │   ├── import.ts          # Templated CSV Ingestion Engine using atomic D1 db.batch() & row-level error reporting
│   │   └── templates.ts       # Configurable document templates (custom CSS variables, logo placement, payment & legal clauses)
│   ├── client/                # React 19 + Tailwind CSS + Radix UI Single Page Application
│   └── index.ts               # Hono Cloudflare Worker entry point with ASSETS SPA fallback
├── wrangler.jsonc             # Cloudflare Worker configuration with D1 ("DB"), R2 ("STORAGE"), and SPA ("ASSETS") bindings
├── drizzle.config.ts          # Drizzle Kit configuration for local/D1 schema management
└── .github/workflows/ci.yml   # GitHub CI workflow for AGY -> GitHub -> Cloudflare auto-builds
```

---

## Quick Start & Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Initialize & seed local SQLite / D1 database:**
   ```bash
   npm run db:migrate:local
   npm run db:seed:local
   ```

3. **Run local development servers:**
   ```bash
   # Terminal 1: Cloudflare Worker + D1 + R2 on :8787
   npm run dev:worker

   # Terminal 2: Vite SPA on :5173 (proxies /api/* to :8787)
   npm run dev
   ```

4. **Cloudflare Auto-Build (GitHub Integration):**
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
