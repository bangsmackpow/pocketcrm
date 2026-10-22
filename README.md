# PocketCRM — Edge CRM, Quoting, Invoicing & Tax Analytics

A production-grade, offline-capable Progressive Web App (PWA) and edge billing system built on **Cloudflare Workers**, **Cloudflare D1**, **Cloudflare R2**, **Cloudflare Email Routing**, **Drizzle ORM**, **Better Auth (RBAC)**, **Hono**, and **React 19 + Tailwind CSS + Radix UI**.

Deployed live on Cloudflare Edge: **[pocketcrm.builtnetworks.com](https://pocketcrm.builtnetworks.com)** (and [pocketcrm.curtislamasters.workers.dev](https://pocketcrm.curtislamasters.workers.dev)).

---

## 🌟 Key Capabilities

### 1. Quoting, Invoicing & Full-Page Composer
- **Dedicated Full-Page Document Composer**: Line-item level editing with live discount, dual-tax, and subtotal calculations.
- **Service Catalog**: Quick item auto-fill from an itemized product & services inventory.
- **Document Lifecycles**:
  - *Estimates / Quotes*: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Approved` / `Rejected` $\rightarrow$ 1-Click Conversion to Invoice.
  - *Invoices*: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Partial` / `Paid` $\rightarrow$ `Overdue` $\rightarrow$ `Cancelled`.
- **Edge PDF Generation**: High-performance, pixel-perfect PDF 1.4 rendering executed directly inside Cloudflare Workers without headless browsers.
- **Native Cloudflare Email Dispatch**: Dispatch invoices and quotes with embedded PDF attachments directly from the edge via Cloudflare Workers `env.EMAIL` binding.

### 2. State-Specific & Iowa Tax Analytics
- **Iowa Single-Sales-Factor Apportionment**: Automatically isolates Iowa in-state gross receipts from out-of-state revenue (Form IA 1040 Schedule C / IA 1120).
- **Cash vs. Accrual Accounting Method**: Real-time toggling between cash received vs. invoices billed.
- **Sales Tax & Local Option (LOST) Breakdown**: Itemized 6% Iowa State Sales Tax and 1% Local Option Sales Tax (e.g. Union County / Creston) collections.
- **Quarterly Estimated Tax Schedule**: Grouped by statutory Iowa voucher payment deadlines (Q1: April 30, Q2: July 1, Q3: October 1, Q4: January 31).
- **Accounts Receivable (A/R) Aging**: 5-bucket aging schedule (`Current`, `1–30`, `31–60`, `61–90`, `90+` days overdue).
- **1-Click CPA Tax Packet CSV Export**: Generates an audit-ready tax and invoice register spreadsheet.

### 3. Progressive Web App (PWA) & Mobile-First UX
- **Installable Native App**: Custom Web App Manifest (`standalone` mode) and full icon suite for iOS & Android home screens.
- **Offline Shell**: Service Worker with Cache-First static asset caching and Network-First document routing.
- **Thumb-Zone Navigation**: Fixed bottom navigation bar with an elevated **Floating Action Button (+)** for instant creation of Invoices, Quotes, and Clients.
- **Responsive Mobile Cards**: Data-dense desktop tables gracefully convert to swipeable, touch-friendly mobile cards on viewports $<640\text{px}$.

### 4. Enterprise Security & Auditability
- **Role-Based Access Control (RBAC)**: Fine-grained permissions (`admin`, `member`, `viewer`) managed by Better Auth.
- **Re-Authentication for High-Risk Actions**: Admin password confirmation required for permanent document deletions.
- **Immutable Audit Trail**: Structured event logging recording actor, entity ID, action, and timestamp.
- **Outbox Email Delivery Logs**: Live visibility into email deliverability and simulated/production dispatch statuses.

---

## 🏛️ Architecture & Repository Layout

```text
├── src/
│   ├── db/
│   │   ├── schema.ts            # Drizzle SQLite/D1 schema (clients, documents, document_items, templates, audit_logs, email_logs)
│   │   ├── client.ts            # Dual-driver factory: Cloudflare D1 (Worker) + better-sqlite3 (offline tooling)
│   │   ├── seed.ts              # Local database seeder
│   │   └── migrations/          # D1 SQL migration files
│   ├── lib/
│   │   ├── auth.ts              # Better Auth + Drizzle D1 adapter & session middleware
│   │   ├── calculations.ts      # Tax, discount, and document total engine
│   │   ├── email.ts             # Native Cloudflare Email dispatcher with MIME multipart PDF attachments
│   │   ├── pdf.ts               # Pure TypeScript edge PDF 1.4 binary generator
│   │   ├── r2.ts                # Cloudflare R2 bucket integration for assets & documents
│   │   └── audit.ts             # Immutable audit logging helper
│   ├── routes/
│   │   ├── auth.ts              # User authentication, session management, and RBAC
│   │   ├── clients.ts           # Customer management & CSV import
│   │   ├── documents.ts         # Base document operations
│   │   ├── estimates.ts         # Estimates & quote approval lifecycles
│   │   ├── invoices.ts          # Invoice lifecycles, payment recording, and PDF streaming
│   │   ├── items.ts             # Service catalog management
│   │   ├── reports.ts           # State tax analytics, Iowa apportionment, A/R aging & CSV exports
│   │   └── templates.ts         # Visual document templates & branding
│   ├── client/                  # React 19 + Tailwind CSS + Lucide Icons SPA
│   │   ├── App.tsx              # Main application shell, tabs, bottom bar, and view logic
│   │   ├── main.tsx             # Entry point & PWA service worker registration
│   │   └── styles.css           # Global typography, mobile safe-areas, and touch targets
│   └── index.ts                 # Hono Cloudflare Worker API router & static asset handler
├── public/                      # PWA assets (manifest.webmanifest, sw.js, app icons)
├── docs/                        # Specifications, plans, and architectural RFCs
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

## 🔒 Security & Privacy Notice
- Legacy database dumps, private customer PII, and migration files (`*.sqlite`, `*.db`, `docs/legacy/`, `scripts/`) are strictly excluded via `.gitignore` and must **never** be pushed to GitHub.
- First-party code adheres to strict Content Security Policies, CORS origin validation, and parameterized SQL queries to prevent injection vulnerabilities.
