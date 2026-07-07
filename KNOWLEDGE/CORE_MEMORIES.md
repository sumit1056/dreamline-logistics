# Core Memories & Guidelines

This document stores coding patterns, preferences, environment details, and critical guidelines for the "Brain" project.

## Environment Details
- **OS**: Windows (Local machine)
- **Project Root**: `e:\logictic_app`
- **Primary Framework / Stack**: React Router v7 / Remix (Vite runner)
- **Database Engine**: Prisma v6 (Neon PostgreSQL Serverless Cloud Database)
- **AI Core**: Google Gemini Failover Chain (`gemini-2.5-flash` -> `gemini-2.0-flash` -> `gemini-2.0-flash-lite` REST endpoints)

## Global Antigravity Rules (from GEMINI.md)

### 1. Design and Development
- **StitchMCP:** For any design-related work, always use the StitchMCP server (`@mcp:StitchMCP`) or combine default tools with StitchMCP to ensure premium, high-fidelity results.
- **Prisma Logic:** For any Remix or backend development, use `@mcp:prisma-mcp-server` to audit the database schema (`schema.prisma`) before writing any data-fetching or mutation code.
- **Preview & Verification:**
  - Do NOT use `curl` or terminal-based tools to preview or verify website changes.
  - Always use the Chrome DevTools MCP server (`@mcp:chrome-devtools-mcp`) for verifying changes, testing features, and previewing the live site.
  - After making any change, use `@mcp:chrome-devtools-mcp` to verify the result. If any issues are found, fix them and re-preview until the implementation is perfect.

### 2. Communication and Execution
- **Complex Tasks:** For any task involving more than 3 steps or complex logic (like API integrations), ALWAYS start by calling `@mcp:sequential-thinking` to plan the architecture and verify the approach before writing code.
- **No Unsolicited Changes:** Do not assume requirements. Only perform actions that are explicitly asked for or provided in the project context. If a specific task is requested, focus only on that task. Do not jump to other tasks or make unsolicited changes.
- **Shopify Commands:** For Shopify projects, do NOT run `push` or `pull` commands yourself. Instead, provide the exact command in your response for the user to run.

### 3. Maintenance and Knowledge
- **KB Updates:** After completing a task or a point, always update this `KNOWLEDGE` folder if it exists in the current project.
- **Comments Integrity:** Preserve existing comments and documentation in code unless instructed otherwise.

---

## The "Scope-Guard" Protocol
- **Gatekeeper Duty:** Always verify client feedback, messages, and new requests against `KNOWLEDGE/SPEC.md`.
- **Out of Scope Alerting:** If a request is "Out of Scope," alert the senior developer before performing any work.
- **Feature Addition Agreement:** Once agreed, immediately update `SPEC.md` and `AUDIT_LOG.md` to synchronize the Source of Truth.

## Home Development & Privacy Setup
- **Privacy Enforcement**: This project is developed on a corporate workstation but linked exclusively to the personal GitHub account (`sumit1056`).
- **Git Identity Guidelines**: Global git user settings are intentionally unset to protect privacy. Local repository-level settings are hard-configured inside this folder to stamp all commits with `sumit1056` and `sumit1056@users.noreply.github.com`. Keep this standard local config active! **Always commit and push changes to the remote Git repository immediately after completing any change or session.**
- **Project Portability**: `.env` configurations are pre-packaged to connect directly to the high-availability Neon cloud PostgreSQL database, allowing seamless data synchronization and zero local database setup on your home development setup.
- **Home Execution Steps**:
  1. Clone/pull the repository.
  2. Run `npm install` to download dependencies.
  3. Start the application locally via `npm run dev` (it connects directly to your live cloud database and ready-to-use Gemini failover chain).

## Next Phase Objectives & Technical Handshake
When initiating the next coding session (whether at home or on the corporate laptop), prioritize the following outstanding objectives:
1. **Authentication System Integration:** (COMPLETED ✅)
   - Created secure cookie-based session manager (`session.server.ts`), registered `/login` in `routes.ts`, and implemented a beautiful, responsive, glassmorphic login gate at `/login`.
   - Enforced `requireAdmin` across all dashboard routes and action methods, securing logistics data.
   - Added an elegant, header-level secure logout button to destroy active sessions.
2. **User Control Center Dashboard View & CRUD:** (COMPLETED ✅)
   - Integrated the "User Control Center" in the sidebar navigation as a dedicated tab for administrative and driver management.
   - Coded server actions for Driver registration/removal and Administrator creation/removal.
   - Enforced protection rules (e.g. preventing lockout by disabling deletion of the last remaining admin account).
3. **AI Past/Relative Date & Mobile Photo Upload Improvements:** (COMPLETED ✅)
   - Configured Gemini parser prompt to dynamically parse historical and relative date phrases into strict ISO 8601 UTC timestamps.
   - Removed native camera capture environment limits to allow choosing images directly from device galleries.
4. **Beta Test Feedback Iterations:**
   - Gather operational feedback from users testing the production URL.
   - Iterate on performance improvements, error boundary displays, or any minor UI visual polish requested by operators.
5. **Post-Beta Production DB Maintenance:**
   - Coordinate with the founder for a full cloud database reset/purge when ready to exit the beta window, ensuring a pristine schema slate for the official launch.

## Dynamic Payout & Cycle Configuration
All payout rates and billing cycle limits are dynamic and managed through the database (`SystemSetting` table). Administrators can adjust them live via the **Config & Rates** sub-tab under Settlements:
- **70 Per Order Income** (internal setting key: `rate_vendor_ship`):
  - Formula: **₹[rate_vendor_ship] per order** completed.
  - Default: ₹70.
  - Frequency: Weekly (Monday to Sunday), expected payout on Wednesday of the following week.
- **Vendor Per Order Income** (internal setting key: `rate_per_order_weekly`):
  - Formula: **₹[rate_per_order_weekly] per order** completed.
  - Default: ₹35.
  - Frequency: Weekly (Monday to Sunday), expected payout on Wednesday of the following week.
- **Vendor Income** (internal setting key: `rate_per_order_monthly_base`):
  - Formula: **₹[rate_per_order_monthly_base] fixed monthly base rate**.
  - Default: ₹53,000.
  - Frequency: Deferred 45-day monthly payout (expected payout on the 15th of month M+2, e.g., work done in June is paid on August 15th).
- **Credit Card Fuel Cycle cutoff day** (internal setting key: `cc_fuel_cycle_end_day`):
  - Cutoff Day: **[cc_fuel_cycle_end_day] of the month**.
  - Default: 4th.
  - Frequency: Cycles run from Day+1 of previous month to Day of current month (e.g., 5th May to 4th June). Dynamically formatted using ordinal date suffixes (st, nd, rd, th).

## 8. UI/UX Patterns & Caching Guidelines
- **Auto-Hiding Banners**: All notification banner states (e.g. `actionErrorVisible`, `parsedExpenseVisible`, `userControlSuccessVisible`, `errorVisible`) must be controlled by a `useEffect` timer that resets the visibility state to `false` after 6000ms.
- **Custom Notion-Styled Modals**: Do not use browser-native `alert()` or `confirm()`. Use the custom popup modal implementation in `home.tsx` for confirming critical actions (e.g. delete, mark paid, notifications).
- **Runsheet Console Layout**: Maintain the responsive grid adjustments. Field Operator select box is persistently shown even in single-driver fleets for clear visibility. The form uses a 2-column layout (`md:grid-cols-2`) on large screens. Runsheet dates use a custom Monday-Sunday snapping week selector with Next/Prev navigation buttons to enforce financial weekly periods. Form inputs should use solid backgrounds (`bg-white` in light mode, `dark:bg-[#1e1e1e]` in dark mode) to prevent OS rendering overrides.
- **Operator Passwords**: Plain-text passwords must be stored as `passwordText` on creation and shown on the Operator details cards in the User Control Center.
- **PWA Service Worker Registration**: The service worker in `app/root.tsx` must only be registered in production (`import.meta.env.PROD`) to avoid aggressive developer-mode caching.

## 9. Bootstrap Admin Credentials (Automatic Seed)
- If the database `AdminCredential` table is empty, a seed administrator is automatically registered by the authentication loader/action.
- Default Login:
  - **Username**: `sumit@6969`
  - **Password**: `sumitdream6969`
This acts as the fallback gateway to initialize other accounts if the DB is reset or migrations wipe data.

## 10. Settlement Payout Reconciliation Reference Tags
To mark payouts as "PAID" in the Settlement Cycles Tracker, an INCOME transaction note must contain a matching reference tag:
- **70 Per Order (`vendor_ship`)**: `[Ref: Weekly-Payout-VS-YYYY-MM-DD]` (where `YYYY-MM-DD` is the Monday of the week).
- **Vendor Per Order Weekly (`per_order_rate_weekly`)**: `[Ref: Weekly-Payout-PO-orders-YYYY-MM-DD]` (where `YYYY-MM-DD` is the Monday of the week).
- **Vendor Income Monthly Base (`per_order_rate_monthly`)**: `[Ref: Monthly-Payout-PO-YYYY-MM]` (where `YYYY-MM` is the year and month of the cycle).
Status transitions to `PAID` automatically when an `Expense` of type `INCOME` matches the tag in the `notes` field.



