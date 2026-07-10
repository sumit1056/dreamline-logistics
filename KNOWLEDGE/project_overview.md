# "Brain" - Dreamline Logistics Control Center Project Overview

This document provides a comprehensive report on the **"Brain"** project (also referred to as Dreamline Logistics Control Center) based on a detailed audit of the `/KNOWLEDGE` base, database schema, configurations, and core application files.

---

## 1. Core Purpose & Business Context

**"Brain"** is a high-fidelity, high-density administrative cockpit designed for **Dreamline Logistics**. Its primary target users are the Founder and partners (Administrative Workspace). 

The application has been simplified to track exactly one main operational model:
*   **Income & Expenses Tracking**: Logging and managing all operational costs (such as fuel, maintenance, operator payouts) and business income entries (such as payouts received from vendors like Shadowfax) in a unified ledger.

Order-tracking, runsheet logs, and settlement calculators have been completely removed from the workspace database and codebase to focus solely on cashflow ledger tracking.

The application uses a **Notion-style minimalist UI** merged with the **AdminMart Modernize VueJS** design language. It is optimized for Progressive Web App (PWA) standalone deployment on mobile devices.

---

## 2. Technical Stack

*   **Framework**: [React Router v7 / Remix](file:///e:/logictic_app/package.json) (Vite-based next-gen compiler).
*   **Database**: [Prisma v6](file:///e:/logictic_app/prisma/schema.prisma) connecting to a high-availability **Neon Serverless PostgreSQL** cloud instance.
*   **AI Integration**: **Google Gemini API** (`gemini-2.5-flash` -> `gemini-2.0-flash` -> `gemini-2.0-flash-lite` model failover chain) for the Smart AI Expense Parser.
*   **Styling**: **Tailwind CSS v4** coupled with custom CSS variables (defined in [app/app.css](file:///e:/logictic_app/app/app.css)) implementing the Notion color palette and glassmorphic elements.
*   **PWA Wrapper**: Custom Service Worker ([sw.js](file:///e:/logictic_app/public/sw.js)) configured with a *Network-First, Cache-Fallback* strategy and custom app manifest ([manifest.json](file:///e:/logictic_app/public/manifest.json)).

---

## 3. Database Architecture & Schema

The database is defined in [schema.prisma](file:///e:/logictic_app/prisma/schema.prisma) with the following key models:

| Model Name | Purpose | Key Attributes |
| :--- | :--- | :--- |
| **User** | Represents administrators and delivery drivers. | `id`, `name`, `phone` (unique), `role` (`DRIVER`, `FOUNDER`), `passwordHash`, `passwordText`, `vehicleNumber`, `loginEnabled` (boolean) |
| **Expense** | Unified ledger transactions (both payments/expenses and income receipts). | `id`, `amount`, `category` (`fuel`, `bittu`, `service`, `other`, `shadowfax`, etc.), `notes`, `vehicle`, `senderName`, `imageUrl` (base64 fuel receipts), `type` (`EXPENSE` or `INCOME`) |
| **AdminCredential** | Administrator dashboard access authentication records. | `id`, `username` (unique), `passwordHash` |

*Note: Delivery, Payout, and SystemSetting tables have been dropped.*

---

## 4. Key Application Features

### A. Unified Entry Console (AI Assistant & Manual Forms)
Located on the main workspace at [home.tsx](file:///e:/logictic_app/app/routes/home.tsx):
*   **Smart AI Expense Parser**: Natural language input parses entries in one go. Users can say: *"cng 550 for MH12-1234 yesterday"* which the backend resolves via Google Gemini to an `Expense` with category `fuel`, amount `550`, vehicle `MH12-1234`, and yesterday's UTC ISO date.
*   **PWA Image Gallery & Camera Upload**: Fuel or CNG expenses require slip uploads. Images are compressed client-side via canvas down to ~100KB JPEG values to avoid heavy base64 strings lagging Neon network payloads.
*   **Pending Fuel Slip Modal**: If the AI parses a fuel expense without a photo attachment, it registers it as "Pending" and prompts a visual backdrop modal asking the driver to snap a photo or select from their gallery.

### B. Financial Ledger
*   Unified database-backed tracking of incomes and expenses.
*   Dynamic filters (All, Year, Month, Today, Custom date range) automatically recalculating totals, fuel metrics, net income, and pending approval items.

---

## 5. Strict Development & Operations Rules

1.  **Layout Lock**: Do NOT modify the premium visual layout pixels. Only bind backend variables.
2.  **UI Banner Behavior**: All workspace status/action/validation error banners must automatically hide after **6 seconds** (6000ms) using React `useEffect` hooks.
3.  **No Native Dialogs**: Standard browser `alert()` and `confirm()` prompts are deprecated. Use the custom Notion-styled slide-up overlays in `home.tsx` for confirmations.
4.  **Service Worker Restriction**: The PWA Service Worker `sw.js` is only registered in production (`import.meta.env.PROD`) to avoid blocking Hot Module Replacement (HMR) local updates.
5.  **Plain-Text Operator Passwords**: User profiles display their plain-text credentials (`passwordText`) in the Admin directory to ease copying/distribution.
6.  **Scope Guard**: New feature requests must be vetted against `SPEC.md` and immediately logged in `AUDIT_LOG.md` before execution.

---
