# PWA & Mobile-First Transformation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform PocketCRM into a high-performance, installable Progressive Web App (PWA) with native iOS/Android look-and-feel, mobile bottom navigation, responsive card views for tables, offline caching, and iOS safe-area handling.

**Architecture:** Introduce a Web App Manifest (`manifest.webmanifest`) and lightweight Service Worker (`sw.js`) for standalone home-screen installation and offline asset caching. On mobile viewports (`< 640px`), replace wide horizontal data tables with native-style stacked card lists and render an iOS/Android style bottom navigation bar with safe-area insets (`env(safe-area-inset-bottom)`).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Web App Manifest, Service Workers, Lucide Icons, Cloudflare Workers static assets.

**Spec:** User request 2026-10-21: Transform PocketCRM into a mobile-friendly PWA for on-the-go billing, invoicing, and client tracking by an independent technical engineer.

## Global Constraints
- Must not break desktop layout: responsive patterns must use Tailwind breakpoints (`sm:hidden` for mobile card views, `hidden sm:table` for desktop tables).
- Must handle iOS Safe Area Insets (`viewport-fit=cover`, `padding-bottom: env(safe-area-inset-bottom)`).
- Must avoid aggressive caching of authenticated mutating API requests: only static assets and idempotent read queries are cached with network-first fallback.
- Must remain 100% compatible with Cloudflare Workers static assets serving.

## Review Focus
1. **iOS Notch & Home Swipe Indicator Overlap:** Bottom navigation bar must include `padding-bottom: env(safe-area-inset-bottom)` so buttons are never obstructed by the iOS home bar.
2. **Double-Tap Zoom & Overscroll Bouncing:** Ensure `touch-action: manipulation` and `overscroll-behavior-y: contain` are set so taps feel immediate like a native app without page elasticity.
3. **Table vs. Card Consistency:** Ensure all actions (Send Invoice, Record Payment, Edit, PDF preview/download, Delete) remain accessible in the mobile card view without feature degradation.
4. **Service Worker Update Semantics:** Ensure service worker updates automatically upon new deployments without trapping users on stale asset bundles.
5. **Mobile Touch Target Sizes:** All clickable items on mobile must meet the minimum $44\text{px} \times 44\text{px}$ touch target guideline.

---

### Task 1: PWA Manifest, iOS Meta Tags & High-Resolution App Icons

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Modify: `index.html`

- [ ] **Step 1.1:** Create `public/manifest.webmanifest` with `name: "PocketCRM"`, `short_name: "PocketCRM"`, `start_url: "/"`, `display: "standalone"`, `theme_color: "#0f172a"`, `background_color: "#0f172a"`, and icon entries.
- [ ] **Step 1.2:** Generate high-resolution PNG icons (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) from `favicon.svg`.
- [ ] **Step 1.3:** Update `index.html` with:
  - `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`
  - `<meta name="theme-color" content="#0f172a" />`
  - `<meta name="apple-mobile-web-app-capable" content="yes" />`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
  - `<link rel="manifest" href="/manifest.webmanifest" />`
  - `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`
- [ ] **Step 1.4:** Commit changes to git.

---

### Task 2: Service Worker & Offline Asset Caching

**Files:**
- Create: `public/sw.js`
- Modify: `src/client/main.tsx`

- [ ] **Step 2.1:** Create `public/sw.js` service worker handling `install`, `activate`, and `fetch`.
- [ ] **Step 2.2:** Configure Cache-First strategy for static assets (CSS, JS bundles, SVGs, favicon).
- [ ] **Step 2.3:** Configure Network-First strategy with cache fallback for read navigation.
- [ ] **Step 2.4:** In `src/client/main.tsx`, register `/sw.js` when running in browser and supported by `navigator.serviceWorker`.
- [ ] **Step 2.5:** Commit changes to git.

---

### Task 3: Mobile Touch Ergonomics & Safe Area Styling

**Files:**
- Modify: `src/client/styles.css`

- [ ] **Step 3.1:** Add global mobile optimization rules:
  - `touch-action: manipulation` (removes 300ms tap delay and disables unwanted double-tap zoom).
  - `overscroll-behavior-y: contain` (prevents whole-page rubber-band bounce on pull down).
  - `-webkit-tap-highlight-color: transparent` (removes gray mobile flash on button tap).
- [ ] **Step 3.2:** Add utility classes for safe-area insets (`pb-safe`, `pt-safe`).
- [ ] **Step 3.3:** Commit changes to git.

---

### Task 4: Native Mobile Bottom Navigation Bar & FAB

**Files:**
- Modify: `src/client/App.tsx`

- [ ] **Step 4.1:** Build a fixed mobile bottom navigation bar (`fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe sm:hidden`).
- [ ] **Step 4.2:** Include thumb-accessible tabs:
  - Dashboard (`LayoutDashboard`)
  - Invoices (`Receipt` with badge count)
  - Quotes/Estimates (`FileText` with badge count)
  - Clients (`Building2`)
  - Admin/More (`Settings`)
- [ ] **Step 4.3:** Add quick "+ New" Floating Action Button (FAB) on mobile for 1-tap creation of Invoices or Quotes without scrolling to the top.
- [ ] **Step 4.4:** Ensure main content container includes bottom padding on mobile (`pb-24 sm:pb-6`) so the bottom bar never covers page content.
- [ ] **Step 4.5:** Commit changes to git.

---

### Task 5: Responsive Mobile Card Views for Invoices, Estimates & Clients

**Files:**
- Modify: `src/client/App.tsx`

- [ ] **Step 5.1:** In Invoices view:
  - Keep `hidden sm:table` for the desktop data table.
  - Add `sm:hidden space-y-3` rendering each invoice as a vertical mobile card:
    - Header: Document # + Status Badge + Issue Date.
    - Body: Client Company Name + Balance Due (bold amber/green) + Total.
    - Actions row: Wrap all action buttons (Send, Record Payment, Edit, PDF, Delete) with 44px touch targets.
- [ ] **Step 5.2:** In Estimates view:
  - Keep `hidden sm:table` for desktop.
  - Add `sm:hidden space-y-3` rendering each estimate as a vertical mobile card with quick Approve, Convert, Send, Edit, PDF, and Delete buttons.
- [ ] **Step 5.3:** In Clients view:
  - Add `sm:hidden space-y-3` mobile card list showing company name, contact, phone, email, and quick edit/delete actions.
- [ ] **Step 5.4:** Commit changes to git.

---

### Task 6: PWA In-App Install Prompt Banner & Status Bar

**Files:**
- Modify: `src/client/App.tsx`

- [ ] **Step 6.1:** Add listener for `beforeinstallprompt` event to enable native Android/Chrome 1-tap install prompt.
- [ ] **Step 6.2:** Render a dismissible "Install PocketCRM App" banner or button in the mobile header when running in standalone browser mode.
- [ ] **Step 6.3:** Add an iOS Safari helper prompt ("Tap Share $\rightarrow$ Add to Home Screen") when detected on mobile iOS Safari.
- [ ] **Step 6.4:** Commit changes to git.

---

### Task 7: End-to-End Verification, Build & Cloudflare Deployment

**Files:**
- All modified files

- [ ] **Step 7.1:** Run `npm run typecheck` and ensure 0 TypeScript errors.
- [ ] **Step 7.2:** Run `npm run build` and ensure Vite build passes.
- [ ] **Step 7.3:** Deploy to Cloudflare Workers via `npx wrangler deploy`.
- [ ] **Step 7.4:** Test live in Chrome/Safari mobile emulation:
  - Web App Manifest validity in Lighthouse / DevTools.
  - Service worker registration and active status.
  - Bottom navigation bar tab switching.
  - Mobile card views on Invoices, Estimates, and Clients.
  - Full-page composer responsiveness on mobile.
- [ ] **Step 7.5:** Commit and push to `main` on GitHub.
