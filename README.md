# PocketCRM — Edge CRM, Quoting, Invoicing & Tax Analytics

A production-grade, offline-capable Progressive Web App (PWA) and edge billing system built on **Cloudflare Workers**, **Cloudflare D1**, **Cloudflare R2**, **Cloudflare Email Routing**, **Drizzle ORM**, **Better Auth (RBAC)**, **Hono**, and **React 19 + Tailwind CSS + Radix UI**.

Deployed live on Cloudflare Edge: **[pocketcrm.builtnetworks.com](https://pocketcrm.builtnetworks.com)** (and [pocketcrm.curtislamasters.workers.dev](https://pocketcrm.curtislamasters.workers.dev)).

---

## 🌟 Key Capabilities

### 1. Quoting, Invoicing & Full-Page Composer
- **Dedicated Full-Page Document Composer**: Line-item level editing with live discount, dual-tax, and subtotal calculations.
- **Service Catalog**: Quick item auto-fill from an itemized product & services inventory.
- **Document Lifecycles**:
  - *Estimates / Quotes*: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Approved` / `Accepted` / `Rejected` $\rightarrow$ 1-Click Conversion to Invoice.
  - *Invoices*: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Partial` / `Paid` $\rightarrow$ `Overdue` $\rightarrow$ `Cancelled`.
- **Edge PDF Generation**: High-performance, pixel-perfect PDF 1.4 rendering executed directly inside Cloudflare Workers without headless browsers.
- **Native Cloudflare Email Dispatch**: Dispatch invoices and quotes with embedded PDF attachments and 1-click portal action links directly from the edge via Cloudflare Workers `env.EMAIL` binding.

### 2. Public Client Portal & Online Collections
- **Client Portal (`/portal/:token`)**: Frictionless, unauthenticated customer view guarded by 128-bit cryptographic tokens.
- **Edge-Native Stripe Checkout**: Seamlessly accept Credit Cards, Apple Pay, Google Pay, and low-fee US ACH Direct Debit without heavy Node SDKs.
- **Automated Payment Webhooks**: Cloudflare Workers edge webhook handler (`/api/webhooks/stripe`) verifying HMAC-SHA256 signatures via Web Crypto, auto-marking invoices as paid, recording balance due, and logging immutable audit records.
- **1-Click Estimate Acceptance**: Customers sign estimates online with digital name sign-off. PocketCRM transitions the estimate to `accepted`, creates a linked invoice, and alerts the owner via email.

### 3. Automated Recurring Retainers & Schedules
- **Draft for Review Mode**: Adheres to strict SMB safety—recurring retainer schedules automatically generate **draft invoices** rather than auto-sending to clients prematurely.
- **Cloudflare Native Cron Trigger**: Scheduled daily at 14:00 UTC (`0 14 * * *`) at zero marginal compute cost on the Cloudflare Workers paid plan.
- **Owner Review Banner**: The Dashboard and Invoices tabs alert you with a prominent banner when draft invoices are waiting for your review.
- **Dedicated Recurring Tab**: Full retainer schedule lifecycle (weekly to annual frequencies, pause/resume, and on-demand "Run Now" execution).

### 4. State-Specific & Iowa Tax Analytics
- **Iowa Single-Sales-Factor Apportionment**: Automatically isolates Iowa in-state gross receipts from out-of-state revenue (Form IA 1040 Schedule C / IA 1120).
- **Cash vs. Accrual Accounting Method**: Real-time toggling between cash received vs. invoices billed.
- **Sales Tax & Local Option (LOST) Breakdown**: Itemized 6% Iowa State Sales Tax and 1% Local Option Sales Tax (e.g. Union County / Creston) collections.
- **Quarterly Estimated Tax Schedule**: Grouped by statutory Iowa voucher payment deadlines (Q1: April 30, Q2: July 1, Q3: October 1, Q4: January 31).
- **Accounts Receivable (A/R) Aging**: 5-bucket aging schedule (`Current`, `1–30`, `31–60`, `61–90`, `90+` days overdue).
- **1-Click CPA Tax Packet CSV Export**: Generates an audit-ready tax and invoice register spreadsheet.

### 5. Progressive Web App (PWA) & Mobile-First UX
- **Installable Native App**: Custom Web App Manifest (`standalone` mode) and full icon suite for iOS & Android home screens.
- **Offline Shell**: Service Worker with Cache-First static asset caching and Network-First document routing.
- **Thumb-Zone Navigation**: Fixed bottom navigation bar with an elevated **Floating Action Button (+)** for instant creation of Invoices, Quotes, and Clients.
- **Responsive Mobile Cards**: Data-dense desktop tables gracefully convert to swipeable, touch-friendly mobile cards on viewports $<640\text{px}$.

### 6. Enterprise Security & Auditability
- **Role-Based Access Control (RBAC)**: Fine-grained permissions (`admin`, `member`, `viewer`) managed by Better Auth.
- **Re-Authentication for High-Risk Actions**: Admin password confirmation required for permanent document deletions.
- **Immutable Audit Trail**: Structured event logging recording actor, entity ID, action, and timestamp.
- **Outbox Email Delivery Logs**: Live visibility into email deliverability and simulated/production dispatch statuses.

---

## 🏛️ Architecture & Repository Layout

```text
├── src/
│   ├── db/
│   │   ├── schema.ts            # Drizzle SQLite/D1 schema (clients, documents, items, templates, logs, payments, recurring)
│   │   ├── client.ts            # Dual-driver factory: Cloudflare D1 (Worker) + better-sqlite3 (offline tooling)
│   │   ├── seed.ts              # Local database seeder with sequential migration runner
│   │   └── migrations/          # Versioned D1 SQL migration files (tracked in git)
│   ├── lib/
│   │   ├── auth.ts              # Better Auth + Drizzle D1 adapter & session middleware
│   │   ├── calculations.ts      # Tax, discount, and document total engine
│   │   ├── email.ts             # Native Cloudflare Email dispatcher with MIME multipart PDF attachments & portal links
│   │   ├── pdf.ts               # Pure TypeScript edge PDF 1.4 binary generator
│   │   ├── portal-token.ts      # 128-bit cryptographic portal token generator
│   │   ├── r2.ts                # Cloudflare R2 bucket integration for assets & documents
│   │   ├── recurring-cron.ts    # Recurring retainer schedule advancement & draft invoice generation
│   │   ├── stripe.ts            # Edge Stripe Checkout & Web Crypto HMAC-SHA256 signature verification
│   │   └── audit.ts             # Immutable audit logging helper
│   ├── routes/
│   │   ├── auth.ts              # User authentication, session management, and RBAC
│   │   ├── clients.ts           # Customer management & CSV import
│   │   ├── documents.ts         # Base document operations
│   │   ├── estimates.ts         # Estimates & quote approval lifecycles
│   │   ├── invoices.ts          # Invoice lifecycles, payment recording, and PDF streaming
│   │   ├── items.ts             # Service catalog management
│   │   ├── portal.ts            # Public client portal endpoints (view, PDF stream, checkout, accept/decline)
│   │   ├── recurring.ts         # Recurring retainer schedules CRUD & manual Run Now trigger
│   │   ├── reports.ts           # State tax analytics, Iowa apportionment, A/R aging & CSV exports
│   │   ├── templates.ts         # Visual document templates & branding
│   │   └── webhooks.ts          # Stripe webhook reconciliation listener
│   ├── client/                  # React 19 + Tailwind CSS + Lucide Icons SPA
│   │   ├── components/
│   │   │   └── RecurringTab.tsx # Recurring retainers & subscription schedules UI
│   │   ├── App.tsx              # Main application shell, tabs, bottom bar, and view logic
│   │   ├── PortalApp.tsx        # Customer-facing public portal SPA (pay invoice, sign estimate)
│   │   ├── main.tsx             # Entry point, portal route detection & Service Worker registration
│   │   └── styles.css           # Global typography, mobile safe-areas, and touch targets
│   └── index.ts                 # Hono Cloudflare Worker API router, scheduled() cron export & static asset handler
├── public/                      # PWA assets (manifest.webmanifest, sw.js, app icons)
├── docs/                        # Specifications, plans, and architectural RFCs
│   ├── superpowers/plans/       # Feature roadmaps and technical implementation plans
│   │   └── 2026-10-27-portal-stripe-and-recurring-cron.md # Portal, Stripe & Recurring Cron plan
├── CUSTOMER_AUTO_FEED_PLAN.md   # Customer discovery, enrichment, and webhook ingestion roadmap
├── MULTITENANT_PLAN.md          # Multi-tenant D1/R2 scaling and tenant isolation architecture
├── FEATURE_ADD.md               # Feature wishlist & prioritized product backlog
├── wrangler.jsonc               # Cloudflare Worker configuration (D1, R2, EMAIL, CRONS, ASSETS)
└── package.json                 # Dependencies & automation scripts
```
│   ├── superpowers/plans/       # Feature roadmaps and technical implementation plans
├── CUSTOMER_AUTO_FEED_PLAN.md   # Customer discovery, enrichment, and webhook ingestion roadmap
├── MULTITENANT_PLAN.md          # Multi-tenant D1/R2 scaling and tenant isolation architecture
├── FEATURE_ADD.md               # Feature wishlist & prioritized product backlog
├── wrangler.jsonc               # Cloudflare Worker configuration (D1, R2, EMAIL, ASSETS)
└── package.json                 # Dependencies & automation scripts
```

---

## 🚀 Quick Start & Local Development

### 1. Prerequisites
- **Node.js** v20+
- **Cloudflare Wrangler CLI** (`npm i -g wrangler` or run via `npx wrangler`)

### 2. Installation
```bash
git clone https://github.com/bangsmackpow/pocketcrm.git
cd pocketcrm
npm install
```

### 3. Database Setup (Local D1)
```bash
# Apply migrations to local SQLite emulator
npm run db:migrate:local
```

### 4. Running the Dev Server
```bash
# Terminal 1: Cloudflare Worker backend (:8787)
npm run dev:worker

# Terminal 2: Vite React frontend (:5173 with proxy to :8787)
npm run dev
```

---

## 📦 Build & Deployment

To deploy directly to Cloudflare Workers from your local environment:

```bash
# Verify TypeScript types
npm run typecheck

# Build Vite client bundles
npm run build

# Deploy assets and worker script to Cloudflare Edge
npm run deploy
```

---

## 💰 Infrastructure & Operational Cost Model

PocketCRM is engineered to run at maximum cost efficiency on a **$5/month Cloudflare Workers Paid** subscription with zero egress fees:

| Resource | Monthly Included Quota | Typical Single-Tenant Usage | 50-Tenant Usage |
| :--- | :--- | :--- | :--- |
| **Worker Requests** | 10,000,000 / month | ~5,000 (<0.1%) | ~250,000 (2.5%) |
| **D1 Row Reads** | 25,000,000,000 / month | ~50,000 (<0.01%) | ~500,000 (<0.01%) |
| **D1 Storage** | 5 GB included | ~20 MB (0.4%) | ~300 MB (6%) |
| **R2 Storage (PDFs/Logos)** | 10 GB included | ~50 MB (0.5%) | ~1.5 GB (15%) |
| **R2 Egress Bandwidth** | **Unlimited (100% Free)** | Free | Free |
| **Total Cloudflare Bill** | **$5.00 / month** | **$5.00 / month** | **$5.00 / month** |

### Built-in Cost Guardrails
- **Zero Binary Storage in D1**: All PDF snapshots, receipts, and logos are stored in R2; D1 only stores small metadata keys.
- **Optimized R2 Operations**: Assets are fetched by exact key (`Class B`, $0.36/M) rather than expensive bucket listings (`Class A`, $4.50/M).
- **Edge Rate Limiting**: WAF and Bot Fight Mode protect against runaway scraping or infinite polling loops.

---

## 🔒 Security & Privacy Notice
- Legacy database dumps, private customer PII, and migration files (`*.sqlite`, `*.db`, `docs/legacy/`, `scripts/`) are strictly excluded via `.gitignore` and must **never** be pushed to GitHub.
- First-party code adheres to strict Content Security Policies, CORS origin validation, and parameterized SQL queries to prevent injection vulnerabilities.
