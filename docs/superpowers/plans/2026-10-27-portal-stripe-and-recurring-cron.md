# Public Client Portal (Stripe / ACH) & Recurring Retainer Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-friction, public client portal with Stripe Checkout / ACH payments & 1-click quote approvals, alongside a Cloudflare Cron-driven recurring billing engine that creates drafts for admin review and dispatches notification reminders.

**Architecture:**
- **Portal & Payments**: Edge-tokenized public URLs (`/portal/:token`) accessing a standalone, branded client presentation. Stripe Checkout API integration for Credit Cards, Apple Pay, and low-fee ACH. Webhook listener (`/api/webhooks/stripe`) for atomic payment reconciliation.
- **Quote Acceptance**: Interactive 1-click sign-off on estimates that transitions documents to `accepted`, auto-generates a linked invoice, and notifies the business owner.
- **Recurring Engine**: Cloudflare Worker `scheduled()` Cron Trigger evaluating active retainer profiles in Cloudflare D1, generating drafted invoices, and delivering email reminders to the admin.

**Tech Stack:** Cloudflare Workers, Hono, Cloudflare D1, Drizzle ORM, Stripe API (`fetch`-compatible via standard REST/webhooks), React 19, Tailwind CSS, Lucide Icons.

---

## Global Constraints

- Cloudflare Workers Edge runtime only: Web Standard APIs (`fetch`, `crypto`, `Headers`, `Response`, `Uint8Array`). No Node.js native binary modules.
- Zero-overage Cloudflare cost envelope ($5/mo plan): Native `scheduled()` Cron triggers (free quota), direct key R2 access, no polling loops.
- Strict PII & credential protection: Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) injected via Cloudflare Worker secrets only; never committed to git.
- Mobile and Desktop parity: Full responsive layout (`hidden sm:block` / `sm:hidden`), safe-area insets (`pb-safe`).
- Financial precision: All calculations use `roundCurrency()` from `src/lib/calculations.ts`.

---

## User Manual Setup Requirements

To properly activate live payments and cron scheduling, the following manual steps are required:

1. **Stripe API Keys**:
   - Obtain your **Stripe Secret Key** (`sk_live_...` or `sk_test_...`) and **Publishable Key** from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys).
   - Set the secret in Cloudflare:
     ```bash
     npx wrangler secret put STRIPE_SECRET_KEY
     ```
2. **Stripe Webhook Configuration**:
   - In Stripe Dashboard $\rightarrow$ Developers $\rightarrow$ Webhooks $\rightarrow$ **Add destination**:
     - **Endpoint URL**: `https://pocketcrm.builtnetworks.com/api/webhooks/stripe`
     - **Events to listen to**: `checkout.session.completed`, `payment_intent.succeeded`
   - Copy the **Signing secret** (`whsec_...`) and configure in Cloudflare:
     ```bash
     npx wrangler secret put STRIPE_WEBHOOK_SECRET
     ```
3. **Admin Notification Email**:
   - Verify `EMAIL_FROM` or configure `ADMIN_NOTIFICATION_EMAIL` (defaults to account admin email) to receive recurring draft alerts.
4. **Deploy & Apply Migration**:
   ```bash
   npm run db:migrate:remote
   npx wrangler deploy
   ```

---

## Task Decomposition

### Task 1: D1 Database Schema Updates & Token Generator
**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0002_portal_and_recurring.sql`
- Modify: `src/lib/auth.ts` (export type bindings for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)

- [ ] Add `portalToken`, `portalTokenCreatedAt`, `acceptedAt`, `acceptedBySignature`, and Stripe transaction fields to `documents` table in `src/db/schema.ts`.
- [ ] Define `recurringSchedules` table in `src/db/schema.ts` (`id`, `clientId`, `profileName`, `frequency`, `nextRunDate`, `lastRunDate`, `subtotal`, `taxTotal`, `total`, `notes`, `status`, `autoSendMode`, `sendAdminReminder`).
- [ ] Define `recurringScheduleItems` table in `src/db/schema.ts` (`id`, `scheduleId`, `name`, `description`, `quantity`, `unit`, `unitPrice`, `taxRate`, `lineTotal`).
- [ ] Define `payments` table in `src/db/schema.ts` (`id`, `documentId`, `amount`, `paymentMethod`, `transactionReference`, `notes`, `createdAt`).
- [ ] Generate migration file `0002_portal_and_recurring.sql` using Drizzle or direct D1 SQL.
- [ ] Write token helper `generatePortalToken()` using `crypto.randomUUID()` in `src/lib/portal-token.ts`.

---

### Task 2: Stripe Integration Library & Webhook Reconciler
**Files:**
- Create: `src/lib/stripe.ts`
- Create: `src/routes/webhooks.ts`
- Modify: `src/index.ts`

- [ ] Implement `createStripeCheckoutSession()` in `src/lib/stripe.ts` using edge-native `fetch('https://api.stripe.com/v1/checkout/sessions')` supporting `card` and `us_bank_account` (ACH).
- [ ] Implement `verifyStripeWebhookSignature()` in `src/lib/stripe.ts` using Web Crypto API HMAC-SHA256 against `stripe-signature` header.
- [ ] Create `/api/webhooks/stripe` route in `src/routes/webhooks.ts` to handle `checkout.session.completed`.
- [ ] Atomically update invoice status to `paid`, update `amountPaid` and `amountDue`, insert a row into `payments`, record an audit entry, and dispatch an email receipt to the client.
- [ ] Mount `/api/webhooks` in `src/index.ts`.

---

### Task 3: Public Client Portal API Endpoints
**Files:**
- Create: `src/routes/portal.ts`
- Modify: `src/index.ts`
- Modify: `src/routes/invoices.ts` & `src/routes/estimates.ts` (ensure `portalToken` is auto-generated upon document creation or retrieval)

- [ ] Implement `GET /api/portal/:token`: Public unauthenticated endpoint fetching sanitized document, client info, itemized lines, and branding without exposing internal system IDs or admin metadata.
- [ ] Implement `GET /api/portal/:token/pdf`: Streams the official rendered PDF for client download.
- [ ] Implement `POST /api/portal/:token/checkout`: Generates a Stripe Checkout session URL and returns `{ checkoutUrl }` to redirect the client to Apple Pay / Card / ACH.
- [ ] Implement `POST /api/portal/:token/accept`: For estimates, records client signatory name, marks estimate as `accepted`, automatically generates the linked `invoice`, and dispatches an alert email to the business owner.
- [ ] Implement `POST /api/portal/:token/decline`: Records rejection with client comments and transitions estimate status.

---

### Task 4: Client Portal Standalone UI Page
**Files:**
- Create: `src/client/PortalApp.tsx`
- Modify: `src/client/main.tsx` (route `/portal/:token` directly to `PortalApp`)
- Modify: `src/lib/email.ts` (include the prominent "Review & Pay" / "View Estimate" portal link button in email templates)

- [ ] Build responsive, clean client portal view in `src/client/PortalApp.tsx` with document header, status badge, line items, and totals.
- [ ] Add prominent "Pay Invoice" button triggering Stripe Checkout redirect.
- [ ] Add "Accept Estimate" modal with typed signature input and confirmation banner.
- [ ] Add "Download Official PDF" button.
- [ ] Update `src/lib/email.ts` to display an attractive CTA button linking directly to `https://pocketcrm.builtnetworks.com/portal/${doc.portalToken}`.

---

### Task 5: Recurring Billing & Retainer API Routes
**Files:**
- Create: `src/routes/recurring.ts`
- Modify: `src/index.ts`
- Modify: `src/client/api.ts`

- [ ] Implement `GET /api/recurring`: List all recurring profiles with client metadata and next run dates.
- [ ] Implement `POST /api/recurring`: Create a recurring retainer schedule with line items and frequency (`weekly`, `monthly`, `quarterly`, `annually`).
- [ ] Implement `PUT /api/recurring/:id`: Update schedule, toggle `active` / `paused`, or modify line items.
- [ ] Implement `DELETE /api/recurring/:id`: Archive / delete recurring profile.
- [ ] Implement `POST /api/recurring/:id/run-now`: Admin manual trigger to generate the draft immediately.

---

### Task 6: Cloudflare Cron Trigger & Daily Notification Engine
**Files:**
- Create: `src/lib/recurring-cron.ts`
- Modify: `src/index.ts` (`scheduled` handler)
- Modify: `wrangler.jsonc` (add cron triggers)

- [ ] Add `"triggers": { "crons": ["0 14 * * *"] }` to `wrangler.jsonc` (runs daily at 14:00 UTC / 9:00 AM CST).
- [ ] Implement `handleScheduledRecurringCron()` in `src/lib/recurring-cron.ts`:
  - Queries D1 for active schedules where `nextRunDate <= CURRENT_DATE`.
  - Generates a new invoice with status **`draft`** and copies line items.
  - Updates `nextRunDate` based on schedule frequency (e.g. advances 1 month).
  - Sends an **Admin Email Notification** to Curtis: *"Draft invoice #INV-YYYY-XXXX has been generated for [Client Name] and is ready for review in PocketCRM."*
  - Records an audit log entry (`recurring.invoice_drafted`).
- [ ] Wire `scheduled()` export in `src/index.ts`.

---

### Task 7: Recurring Retainers UI in PocketCRM App
**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/api.ts`

- [ ] Add **"Recurring"** tab in main navigation alongside Clients, Invoices, and Estimates.
- [ ] Build Recurring Schedules management table (Client, Schedule Name, Frequency, Next Run Date, Amount, Status).
- [ ] Add "New Recurring Retainer" modal composer with client selector, line items, and schedule settings.
- [ ] Add Dashboard notification banner: *"You have X recurring invoice drafts ready for review"*, filtering invoices list by draft status.

---

### Task 8: Verification, Test Suite & Deployment
- [ ] Run `npm run typecheck` across client and server.
- [ ] Run `npm run build` to verify Vite bundle.
- [ ] Apply migration to remote D1: `npm run db:migrate:remote`.
- [ ] Deploy live to Cloudflare edge: `npx wrangler deploy`.
- [ ] Test end-to-end:
  - Generate a portal link and verify public viewing without login.
  - Test estimate 1-click acceptance.
  - Test simulated Stripe Checkout session creation.
  - Trigger manual recurring schedule run and verify draft creation + admin email alert.
