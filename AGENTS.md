# PocketCRM — Developer & AI Agent Guide (`AGENTS.md`)

This guide serves as the definitive reference for AI coding agents and human developers maintaining, enhancing, or debugging **PocketCRM**.

---

## 1. System Overview & Technology Stack

PocketCRM is an edge-native, offline-capable CRM, quoting, invoicing, and tax analytics platform built entirely on Cloudflare's serverless infrastructure:

| Component | Technology | Role & Details |
| :--- | :--- | :--- |
| **Compute / API Gateway** | **Cloudflare Workers** via **Hono** | Global serverless edge compute with zero-cold-start latency. Handles routing, auth, PDF rendering, email dispatch, and reporting. |
| **Database** | **Cloudflare D1** via **Drizzle ORM** | Distributed SQLite at the edge. Schema managed in `src/db/schema.ts`. |
| **Object Storage** | **Cloudflare R2** | S3-compatible asset store for business logos, document attachments, and rendered PDF snapshots. |
| **Email Delivery** | **Cloudflare Worker Email (`env.EMAIL`)** | Direct edge email dispatch with MIME multipart generator (`mimetext`) and binary PDF attachments. |
| **Authentication & RBAC** | **Better Auth + Drizzle D1** | Session tokens, password hashing, and role-based permissions (`admin`, `member`, `viewer`). |
| **Frontend Framework** | **React 19 + Vite** | Single Page Application with client-side routing, optimistic UI, and instant search. |
| **Styling** | **Tailwind CSS + Lucide Icons** | Dark/light theme support, mobile notch safe-area handling (`pb-safe`), and responsive breakpoints. |
| **PWA Engine** | **Service Worker + Web App Manifest** | Standalone home screen installation on iOS/Android, Cache-First static asset caching, Network-First navigation. |

---

## 2. Essential Commands

```bash
# Typecheck TypeScript (Strict mode)
npm run typecheck

# Build Vite client bundles
npm run build

# Deploy assets & worker script to Cloudflare Edge
npx wrangler deploy
# Or using the alias:
npm run deploy

# Database migrations
npm run db:migrate:local     # Apply migrations to local miniflare SQLite
npm run db:migrate:remote    # Apply migrations to live Cloudflare D1
```

> [!IMPORTANT]
> **Always run `npm run typecheck` and `npm run build` before deploying or committing changes.**

---

## 3. Directory Layout & Key Modules

```text
src/
├── db/
│   ├── schema.ts            # Canonical Drizzle ORM schema (Users, Clients, Documents, Items, Templates, Logs)
│   └── migrations/          # Versioned D1 SQL migration files
├── lib/
│   ├── auth.ts              # Better Auth initialization, RBAC helper (requireRole), and session middleware
│   ├── calculations.ts      # Pure math engine for line items, discounts, dual taxes, and roundCurrency
│   ├── email.ts             # Cloudflare Workers MIME email builder & attachment encoder
│   ├── pdf.ts               # Pure TypeScript edge PDF 1.4 binary generator (no headless browser needed)
│   ├── r2.ts                # Cloudflare R2 bucket reader & writer
│   └── audit.ts             # Immutable audit trail logger
├── routes/
│   ├── auth.ts              # Login, logout, session verification, user management
│   ├── clients.ts           # Client CRUD and batch CSV import
│   ├── estimates.ts         # Estimate workflows & 1-click conversion to invoices
│   ├── invoices.ts          # Invoice workflows, payment recording, PDF streaming, email dispatch
│   ├── items.ts             # Service & product catalog
│   ├── reports.ts           # State tax analytics, Iowa apportionment, A/R aging & CSV exports
│   └── templates.ts         # Visual document templates & branding
├── client/
│   ├── App.tsx              # Primary UI container (tabs, composer, modals, mobile bottom bar)
│   ├── main.tsx             # React DOM root & Service Worker registration
│   └── styles.css           # Global CSS, dark theme rules, safe-area utilities
└── index.ts                 # Hono app router & Cloudflare Worker entry point
```

---

## 4. Architectural Rules for Agents

### Rule 1: Edge Compatibility Only
Code running inside `src/routes/`, `src/lib/`, or `src/index.ts` runs inside the **Cloudflare Workers V8 runtime**.
* **NEVER** use Node.js-only modules (`fs`, `child_process`, `net`, `http`, native C++ binaries) in Worker code.
* Use Web Standard APIs (`fetch`, `crypto`, `Headers`, `Request`, `Response`, `Uint8Array`, `ReadableStream`).
* Node.js scripts in `scripts/` or `src/db/seed.ts` run offline on the developer's machine and may use `better-sqlite3`.

### Rule 2: Strict Privacy & PII Protection
* **NEVER** commit SQLite database files, `.db`, `.sqlite`, or migration `.sql` dumps containing real customer PII (names, emails, physical addresses, invoice numbers) to Git or GitHub.
* These files are excluded via `.gitignore` (`*.sqlite*`, `*.db`, `docs/legacy/`, `scripts/`, `*.sql`).
* Always verify `git status` prior to staging and committing.

### Rule 3: Mobile & Desktop UI Parity
* PocketCRM is designed to work equally well on desktop monitors and mobile devices.
* **Tables vs. Cards**:
  * Desktop screens ($\ge 640\text{px}$) use dense tabular layouts (`hidden sm:block`).
  * Mobile viewports ($< 640\text{px}$) use stacked card layouts (`sm:hidden`).
  * When adding or updating actions on desktop tables, **always update the corresponding mobile card view** so features are accessible on mobile.
* **Safe-Area Insets**:
  * Main content must include bottom padding (`pb-28 sm:pb-8`) to prevent content from being obscured by the fixed bottom navigation bar.
  * Use `.pb-safe` on fixed bottom elements to honor the iOS home indicator notch.

### Rule 4: Financial Calculations & Rounding
* Never perform floating-point math without rounding. Use `roundCurrency(val)` from `src/lib/calculations.ts`.
* In Cloudflare D1, all currency amounts are stored as standard dollar floats (`real`). Note that legacy InvoiceShelf data used integer cents; ensure proper conversions if writing migration tools.
* Document totals must always satisfy:
  $$\text{Total} = \text{Subtotal} - \text{Discount} + \text{Tax}$$
  $$\text{Amount Due} = \text{Total} - \text{Amount Paid}$$

### Rule 5: State Tax & Apportionment Logic
* PocketCRM includes specialized tax logic for the **Iowa Department of Revenue (IDR)**:
  * **Apportionment**: In-state Iowa gross receipts vs. out-of-state gross receipts are determined by client billing address state (`IA` / `Iowa`).
  * **Sales Tax**: Iowa standard rate is 6.00% state sales tax + 1.00% Local Option Sales Tax (LOST) = 7.00% total.
  * When updating `src/routes/reports.ts`, preserve cash vs. accrual basis calculations and statutory quarterly voucher deadlines (Q1: April 30, Q2: July 1, Q3: October 1, Q4: January 31).

---

## 5. Reference Architectural Documents

Before designing or implementing new major modules, review the existing architectural roadmaps:
* [`CUSTOMER_AUTO_FEED_PLAN.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/CUSTOMER_AUTO_FEED_PLAN.md) — Customer discovery, public registry APIs (SAM.gov, OpenCorporates, Google Places, Apollo), and inbound webhook ingestion.
* [`MULTITENANT_PLAN.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/MULTITENANT_PLAN.md) — Multi-tenant D1/R2 scaling, tenant isolation, and single-tenant database extraction procedures.
* [`FEATURE_ADD.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/FEATURE_ADD.md) — Prioritized product feature backlog and wishlist.
* [`docs/superpowers/plans/2026-10-21-mfa-authentication.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/docs/superpowers/plans/2026-10-21-mfa-authentication.md) — TOTP Multi-Factor Authentication implementation plan.
* [`docs/superpowers/plans/2026-10-21-pwa-mobile-transformation.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/docs/superpowers/plans/2026-10-21-pwa-mobile-transformation.md) — PWA and mobile ergonomics design document.
