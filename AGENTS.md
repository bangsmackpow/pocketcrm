# PocketCRM — Developer & AI Agent Guide (`AGENTS.md`)

This guide serves as the definitive reference for AI coding agents and human developers maintaining, enhancing, or debugging **PocketCRM**.

---

## 1. System Overview & Technology Stack

PocketCRM is an edge-native, offline-capable CRM, quoting, invoicing, and tax analytics platform built entirely on Cloudflare's serverless infrastructure:

| Component | Technology | Role & Details |
| :--- | :--- | :--- |
| **Compute / API Gateway** | **Cloudflare Workers** via **Hono** | Global serverless edge compute with zero-cold-start latency. Handles routing, auth, PDF rendering, email dispatch, cron triggers, and reporting. |
| **Database** | **Cloudflare D1** via **Drizzle ORM** | Distributed SQLite at the edge. Schema managed in `src/db/schema.ts` and migrations in `src/db/migrations/`. |
| **Object Storage** | **Cloudflare R2** | S3-compatible asset store for business logos, document attachments, and rendered PDF snapshots. |
| **Email Delivery** | **Cloudflare Worker Email (`env.EMAIL`)** | Direct edge email dispatch with MIME multipart generator (`mimetext`), binary PDF attachments, and 1-click portal action links. |
| **Online Payments** | **Stripe Checkout & Webhooks** | Edge-native REST API integration for Credit Cards, Apple Pay, Google Pay, and low-fee US ACH Direct Debit. |
| **Recurring Billing** | **Cloudflare Cron Triggers (`0 14 * * *`)** | Daily edge scheduled task advancing recurring retainer schedules and generating draft review invoices. |
| **Public Client Portal** | **React 19 SPA + Crypto Tokens** | Secure, unauthenticated customer view (`/portal/:token`) for quote sign-off and instant payment. |
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
│   ├── schema.ts            # Canonical Drizzle ORM schema (Users, Clients, Documents, Items, Templates, Payments, Recurring)
│   └── migrations/          # Versioned D1 SQL migration files (tracked in git)
├── lib/
│   ├── auth.ts              # Better Auth initialization, RBAC helper (requireRole), and session middleware
│   ├── calculations.ts      # Pure math engine for line items, discounts, dual taxes, and roundCurrency
│   ├── email.ts             # Cloudflare Workers MIME email builder & attachment encoder
│   ├── pdf.ts               # Pure TypeScript edge PDF 1.4 binary generator (no headless browser needed)
│   ├── portal-token.ts      # High-entropy 128-bit cryptographic portal token generator
│   ├── r2.ts                # Cloudflare R2 bucket reader & writer
│   ├── recurring-cron.ts    # Edge scheduled cron handler, retainer schedule advancement, and draft generation
│   ├── stripe.ts            # Stripe REST API checkout generator & Web Crypto HMAC-SHA256 signature verification
│   └── audit.ts             # Immutable audit trail logger
├── routes/
│   ├── auth.ts              # Login, logout, session verification, user management
│   ├── clients.ts           # Client CRUD and batch CSV import
│   ├── estimates.ts         # Estimate workflows & 1-click conversion to invoices
│   ├── invoices.ts          # Invoice workflows, payment recording, PDF streaming, email dispatch
│   ├── items.ts             # Service & product catalog
│   ├── portal.ts            # Public client portal endpoints (view doc, stream PDF, checkout, accept/decline)
│   ├── recurring.ts         # Recurring schedules CRUD, pause/resume, and Run Now manual trigger
│   ├── reports.ts           # State tax analytics, Iowa apportionment, A/R aging & CSV exports
│   ├── templates.ts         # Visual document templates & branding
│   └── webhooks.ts          # Stripe edge webhook listener (checkout.session.completed, auto-reconciliation)
├── client/
│   ├── components/
│   │   └── RecurringTab.tsx # Recurring retainers & subscription schedules management UI
│   ├── App.tsx              # Primary UI container (tabs, composer, modals, mobile bottom bar)
│   ├── PortalApp.tsx        # Standalone customer-facing portal view (Stripe checkout & quote digital sign-off)
│   ├── main.tsx             # React DOM root, portal routing & Service Worker registration
│   └── styles.css           # Global CSS, dark theme rules, safe-area utilities
└── index.ts                 # Hono app router, Cloudflare Worker entry point & scheduled() cron export
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

### Rule 6: Cloudflare Cost & Resource Guardrails ($5/mo Optimization)
PocketCRM operates on a **$5/month Cloudflare Workers Paid plan**. To maintain zero-overage cost predictability:
* **No Binary Blobs in D1**: Never store base64 images or PDFs in D1 tables. Always write binary files to Cloudflare R2 and store only the R2 object key string in D1.
* **Avoid R2 `list()` Operations**: R2 Class A operations (`PUT`, `LIST`) cost $4.50/million, whereas Class B operations (`GET`) cost $0.36/million. Always access attachments and files by direct key (`env.STORAGE.get(key)`); never call `env.STORAGE.list()` in hot API request paths.
* **Read-Amplification Defense**: Guard all reporting and data endpoints with edge rate limiting (max 120 req/min per IP) and Bot Fight Mode to prevent infinite polling loops or scrapers from inflating Worker requests beyond the 10M included monthly quota.
* **CPU & Memory Budget**: Enforce client-side image resizing on logo uploads (max 500 KB / 1024x1024) to keep edge PDF rendering fast and well inside the 128 MB Worker RAM envelope.

### Rule 7: Public Client Portal & Cryptographic Tokens
* The client portal (`/portal/:token` and `/api/portal/:token/*`) is deliberately unauthenticated to eliminate client login friction.
* **Security via Entropy**: Access is guarded exclusively by a 128-bit cryptographically secure hex token (`generatePortalToken()`).
* **Information Boundary**: The portal API only exposes information relevant to that specific document, the associated client's basic billing details, and the workspace's visual template styles. It must **never** leak user passwords, internal audit logs, other clients' records, or private workspace configurations.

### Rule 8: Recurring Engine & Cloudflare Cron Invariants
* **Draft for Review Default**: PocketCRM generates invoices from recurring retainer schedules in `draft` status (`autoSendMode === 'draft_only'`). Invoices must **never** be auto-sent to clients without an explicit administrative setting.
* **Idempotency & Date Advancement**: When the scheduled cron handler (`0 14 * * *`) processes a due schedule, it must atomically generate the draft invoice and immediately advance `nextRunDate` based on the frequency (`weekly`, `bi-weekly`, `monthly`, `quarterly`, `semi-annually`, `annually`) to prevent duplicate billing.
* **Owner Notification**: Generating recurring drafts triggers an administrative review email to Curtis (`ADMIN_NOTIFICATION_EMAIL` or fallback) and surfaces a high-visibility review banner on the dashboard.

---

## 5. Reference Architectural Documents

Before designing or implementing new major modules, review the existing architectural roadmaps:
* [`docs/superpowers/plans/2026-10-27-portal-stripe-and-recurring-cron.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/docs/superpowers/plans/2026-10-27-portal-stripe-and-recurring-cron.md) — Public client portal, Stripe checkout, digital quote acceptance, and recurring cron architecture.
* [`CUSTOMER_AUTO_FEED_PLAN.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/CUSTOMER_AUTO_FEED_PLAN.md) — Customer discovery, public registry APIs (SAM.gov, OpenCorporates, Google Places, Apollo), and inbound webhook ingestion.
* [`MULTITENANT_PLAN.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/MULTITENANT_PLAN.md) — Multi-tenant D1/R2 scaling, tenant isolation, and single-tenant database extraction procedures.
* [`FEATURE_ADD.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/FEATURE_ADD.md) — Prioritized product feature backlog and wishlist.
* [`docs/superpowers/plans/2026-10-21-mfa-authentication.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/docs/superpowers/plans/2026-10-21-mfa-authentication.md) — TOTP Multi-Factor Authentication implementation plan.
* [`docs/superpowers/plans/2026-10-21-pwa-mobile-transformation.md`](file:///C:/Users/curtis/Desktop/dev/pocketcrm/docs/superpowers/plans/2026-10-21-pwa-mobile-transformation.md) — PWA and mobile ergonomics design document.
