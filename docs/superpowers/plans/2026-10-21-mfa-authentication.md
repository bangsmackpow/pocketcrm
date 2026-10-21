# Multi-Factor Authentication (MFA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full Multi-Factor Authentication (MFA) into PocketCRM supporting both Authenticator App (TOTP) and Cloudflare Native Email OTP, with emergency backup recovery codes, a 3-login grace period, and session IP/device anomaly re-prompting.

**Architecture:** Integrate Better Auth's native `twoFactor` plugin with D1 SQLite persistence. The auth engine will handle TOTP verification, dispatch 6-digit Email OTPs via Cloudflare Native Email (`env.EMAIL`), and issue one-time backup recovery codes. Sessions will track client IP address and User-Agent, re-challenging with MFA if the network or device fingerprint changes.

**Tech Stack:** Better Auth `twoFactor` plugin, Cloudflare Workers D1 (SQLite), Cloudflare Native Email (`cloudflare:email`), React 19, TypeScript, Lucide Icons.

**Spec:** User requirements from session 2026-10-21: Support Authenticator (TOTP) and Email OTP as either/or choices, generate emergency recovery codes, provide a 3-login grace period before strict enforcement, and re-prompt if IP/device changes.

## Global Constraints
- Must use Cloudflare D1 with Drizzle ORM for schema definitions and migrations.
- Must not introduce external heavy Node.js dependencies incompatible with Cloudflare Workers edge runtime.
- Email OTP must utilize existing Cloudflare Native Email binding (`env.EMAIL` / `invoicing@billing.builtnetworks.com`).
- All MFA events (`mfa.enrolled`, `mfa.verified`, `mfa.backup_code_used`, `mfa.rechallenge_ip_change`, `mfa.disabled`) must be permanently logged in `audit_logs`.

## Review Focus
1. **Network Anomaly Edge Cases:** Mobile users on fluctuating cellular IPs (e.g. switching between Wi-Fi and LTE) shouldn't be trapped in an infinite re-login loop; re-challenge must seamlessly re-verify without clearing valid credentials.
2. **Grace Period Counting:** The 3-login grace counter must decrement only upon successful credential authentication, and cannot be reset by logging out and in.
3. **Emergency Recovery Lockout:** If a user loses their authenticator device or email access, backup codes must be single-use and immediately consumed upon verification.
4. **Email OTP Delivery Delay / Resend Rate Limiting:** Prevent spamming email dispatch by enforcing a 30-second cooldown on the "Resend Code" action.
5. **Session Fingerprint Security:** When an IP/User-Agent mismatch is detected, protect internal CRM endpoints while allowing the MFA verification route.

---

### Task 1: D1 Database Schema & Migration for Two-Factor

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0003_two_factor_auth.sql`

- [ ] **Step 1.1:** Add `twoFactorEnabled` (boolean) and `mfaGraceLoginsRemaining` (integer default 3) to `users` table in `src/db/schema.ts`.
- [ ] **Step 1.2:** Add `twoFactor` table in `src/db/schema.ts` with fields: `id`, `secret`, `backupCodes`, `userId` (references users.id), `verified`, `failedVerificationCount`, `lockedUntil`, `createdAt`.
- [ ] **Step 1.3:** Create migration `src/db/migrations/0003_two_factor_auth.sql` adding `two_factor` table, foreign keys, indexes, and user table columns.
- [ ] **Step 1.4:** Apply migration to remote Cloudflare D1 via `npx wrangler d1 execute pocketcrm-db --remote --file=src/db/migrations/0003_two_factor_auth.sql`.
- [ ] **Step 1.5:** Commit changes to git.

---

### Task 2: Better Auth Two-Factor Plugin Integration in `src/lib/auth.ts`

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/email.ts`

- [ ] **Step 2.1:** Create helper in `src/lib/email.ts` to dispatch a branded 6-digit MFA Security Code email using Cloudflare Native Email (`sendTwoFactorOtpEmail`).
- [ ] **Step 2.2:** Import `twoFactor` from `better-auth/plugins` in `src/lib/auth.ts`.
- [ ] **Step 2.3:** Add `twoFactor` plugin to `createAuth(env)` with `issuer: 'PocketCRM'`, TOTP enabled, and `otpOptions.sendOTP` calling `sendTwoFactorOtpEmail`.
- [ ] **Step 2.4:** Map `twoFactor` model into `drizzleAdapter` schema in `src/lib/auth.ts`.
- [ ] **Step 2.5:** Run `npm run typecheck` to confirm plugin configuration.
- [ ] **Step 2.6:** Commit changes to git.

---

### Task 3: MFA Backend Routes & IP/Device Change Detection

**Files:**
- Modify: `src/routes/auth.ts`
- Modify: `src/lib/auth.ts`

- [ ] **Step 3.1:** In `sessionMiddleware`, check incoming request IP (`c.req.header('cf-connecting-ip')` or remote address) and `User-Agent`.
- [ ] **Step 3.2:** If the user has `twoFactorEnabled` and the IP/device does not match the active session record, flag `c.set('mfaRechallengeRequired', true)`.
- [ ] **Step 3.3:** Add endpoint `POST /api/auth/mfa/status` returning current user's MFA status, grace logins remaining, and enrolled methods.
- [ ] **Step 3.4:** Add endpoint `POST /api/auth/mfa/skip-grace` to decrement `mfaGraceLoginsRemaining` when a user chooses to postpone setup during the grace period.
- [ ] **Step 3.5:** Add audit logging for all MFA state transitions (`mfa.enrolled`, `mfa.verified`, `mfa.rechallenge_prompted`, `mfa.disabled`).
- [ ] **Step 3.6:** Run `npm run typecheck` to verify route handlers.
- [ ] **Step 3.7:** Commit changes to git.

---

### Task 4: Client API SDK for Multi-Factor Authentication

**Files:**
- Modify: `src/client/api.ts`

- [ ] **Step 4.1:** Add interfaces: `MfaStatusResponse`, `TotpSetupResponse`, `VerifyTotpPayload`, `VerifyOtpPayload`.
- [ ] **Step 4.2:** Implement API client methods:
  - `fetchMfaStatus()`
  - `setupTotp(password: string)`
  - `verifyTotp(code: string)`
  - `sendMfaEmailOtp()`
  - `verifyMfaEmailOtp(code: string)`
  - `verifyBackupCode(code: string)`
  - `generateBackupCodes(password: string)`
  - `skipMfaGrace()`
  - `disableMfa(password: string)`
- [ ] **Step 4.3:** Run `npm run typecheck`.
- [ ] **Step 4.4:** Commit changes to git.

---

### Task 5: Frontend UI: Login MFA Challenge & Re-Challenge Modal

**Files:**
- Modify: `src/client/App.tsx`

- [ ] **Step 5.1:** Update sign-in submission in `App.tsx` to handle 2FA challenge responses (`twoFactorRedirect` or required 2FA).
- [ ] **Step 5.2:** Create dedicated MFA Challenge Dialog supporting:
  - Choice of Authenticator Code or Email OTP.
  - "Send Code to Email" trigger with 30s resend timer.
  - Emergency fallback "Use Backup Code" toggle.
- [ ] **Step 5.3:** Handle IP/Device change re-prompt: when `mfaRechallengeRequired` is returned, open challenge modal before allowing sensitive actions.
- [ ] **Step 5.4:** Verify successful code verification unlocks the workspace and refreshes state.
- [ ] **Step 5.5:** Commit changes to git.

---

### Task 6: Frontend UI: MFA Setup & Grace Period Banner

**Files:**
- Modify: `src/client/App.tsx`

- [ ] **Step 6.1:** Add Grace Period Reminder Banner for users who haven't enabled MFA yet:
  - Displays `"Multi-Factor Authentication Recommended (X logins remaining in grace period)"`.
  - Buttons: `"Set Up Now"` and `"Dismiss (X remaining)"`.
- [ ] **Step 6.2:** Add MFA Enrollment Wizard in Admin / User Profile Settings:
  - Step A: Choose method (Authenticator App or Email OTP).
  - Step B (Authenticator): Display QR Code, Secret Key, and 6-digit confirmation test.
  - Step B (Email): Send test code to user's email and verify.
  - Step C: Display and download emergency one-time backup recovery codes.
- [ ] **Step 6.3:** Enforce strict lock if grace period has expired (`mfaGraceLoginsRemaining <= 0`) forcing completion of setup before dashboard navigation.
- [ ] **Step 6.4:** Commit changes to git.

---

### Task 7: End-to-End Verification, Security Audit & Cloudflare Deployment

**Files:**
- All modified files

- [ ] **Step 7.1:** Run `npm run typecheck` and ensure 0 compilation errors.
- [ ] **Step 7.2:** Run `npm run build` and ensure Vite build passes.
- [ ] **Step 7.3:** Deploy to Cloudflare Workers via `npx wrangler deploy`.
- [ ] **Step 7.4:** Test end-to-end:
  - Login with grace countdown.
  - Setup Authenticator App with QR code + 6-digit code.
  - Test login challenge with Authenticator app.
  - Test login challenge with Email OTP code.
  - Test emergency recovery code redemption.
  - Confirm audit log entries in Admin $\rightarrow$ Audit Trail.
- [ ] **Step 7.5:** Commit and push to `main` on GitHub.
