# PocketCRM Feature Additions & Strategic Roadmap

This document outlines the strategic research conducted across the top 3 CRM and billing platforms used by independent consultants and engineering professionals (**Harvest**, **FreshBooks**, and **Hello Bonsai**), identifying the **Top 5 Core Features** to incorporate into PocketCRM.

---

## Executive Summary & Target Profile

* **Profile**: Freelance Network, Software, and Systems Engineer.
* **Core Need**: Frictionless capture of billable work, accurate invoicing, and reliable payment collection without chasing clients.
* **Design Principle**: Keep PocketCRM **industry-agnostic and lean**. Avoid complex sales-lead funnels; focus on the engine that turns completed technical work into cash in the bank.

---

## Benchmark Platform Analysis

| Platform | Primary Strength | Key Architectural Takeaway for PocketCRM |
| :--- | :--- | :--- |
| **Harvest** | Billable time tracking, project hour caps, timesheet-to-invoice conversion. | High-value technical consultants bill by hours and project milestones. The transition from logged work to invoice line items must take 1 click. |
| **FreshBooks** | Invoicing automation, recurring retainers, online payment collections, AR aging. | Sending an invoice without a direct "Pay Now" link slows down cash collection. Automated reminders and aging reports prevent bad debt. |
| **Hello Bonsai** | Freelance CRM, project milestone billing, client deliverables portal. | Keeping client records connected to documents, expenses, and project scopes ensures all billable items are captured. |

---

## Top 5 Features to Incorporate

### 1. Integrated Time & Work Logs (1-Click "Invoice Unbilled Hours")
* **The Need**: Engineering involves ad-hoc troubleshooting, out-of-hours maintenance, infrastructure migrations, and code spikes. Manually aggregating hours and retyping them into invoice rows leads to unbilled work and billing errors.
* **Feature Scope**:
  - Quick "Log Work" entry (date, client, duration in hours, service type, hourly rate, and description of work completed).
  - "Unbilled Work" ledger per client.
  - In the invoice composer: a **"Pull Unbilled Time"** button that automatically converts selected work entries into itemized line items and marks the log entries as `billed`.
* **Stack Implementation**: Cloudflare D1 `time_entries` table (`id`, `clientId`, `hours`, `rate`, `description`, `invoiceId`, `date`, `status`).

### 2. Project Budgets, Milestones & Retainers
* **The Need**: Technical contracts generally follow 3 formats:
  1. *Time & Materials with a cap* (e.g., "Architecture review — Not to exceed 40 hrs").
  2. *Milestone billing* (e.g., "50% upfront, 50% on cutover").
  3. *Monthly retainers* (e.g., "15 hrs/month network support @ $2,500/mo").
* **Feature Scope**:
  - Lightweight "Projects" / "Engagements" layer under each client with budget parameters.
  - Visual budget burn progress bar (`28 / 40 hrs used — 70%`).
  - Recurring invoice generation for ongoing retainer clients.
* **Stack Implementation**: Cloudflare D1 `projects` table linking clients and documents; automated monthly drafts via Cloudflare Cron Triggers.

### 3. Online Payment Gateway Integration (Stripe Checkout & ACH)
* **The Need**: Invoices with only bank wire instructions or checks take weeks to clear. Invoices with a direct "Pay Now" button get settled in days.
* **Feature Scope**:
  - Direct "Pay Invoice" link on invoice emails and PDF documents.
  - Supports Credit Cards and low-fee direct ACH bank transfers (via Stripe Checkout).
  - Automated webhook (`/api/webhooks/stripe`) that updates invoice status from `sent` to `paid`, logs the transaction, and delivers a payment receipt.
* **Stack Implementation**: Stripe Checkout Session API + Cloudflare Worker webhook handler.

### 4. Automated Payment Reminders & Accounts Receivable (AR) Aging
* **The Need**: Following up manually on unpaid invoices is uncomfortable and often procrastinated.
* **Feature Scope**:
  - Automated reminder schedule (e.g., *3 days before due date*, *on due date*, *7 days overdue*, *14 days overdue*).
  - Polite, professional automated email with attached PDF and payment link.
  - Visual AR Aging report on the Dashboard: `Current`, `1–30 Days Past Due`, `31–60 Days`, `60+ Days`.
* **Stack Implementation**: Cloudflare Worker Scheduled Cron Trigger (`scheduled()` handler running daily) querying D1 for overdue invoices.

### 5. Billable Reimbursable Expenses & Passthrough Cost Tracking
* **The Need**: Network and systems engineers frequently incur direct out-of-pocket expenses for clients (cloud infrastructure costs, domain registrations, SSL certificates, network hardware, transceivers, cables).
* **Feature Scope**:
  - Quick "Log Expense" form: vendor, amount, client, receipt upload, and optional markup %.
  - One-click inclusion of unbilled expenses into client invoices as separate line items with receipt attachments.
* **Stack Implementation**: Cloudflare R2 bucket for receipt storage (`expenses/` path) + Cloudflare D1 `expenses` table.

---

## Prioritized Implementation Roadmap

1. **Phase 1: Payment Acceleration**
   - Stripe Checkout & ACH payments on invoices.
   - Cloudflare Cron-based automated payment reminders & AR aging.
2. **Phase 2: Billing Automation**
   - Time tracking & 1-click invoice generation from unbilled hours.
   - Billable out-of-pocket expense tracking with R2 receipts.
3. **Phase 3: Retainers & Engagements**
   - Project budget caps and recurring retainer billing.
