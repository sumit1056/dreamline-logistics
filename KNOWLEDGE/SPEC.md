# Project Specification: Brain

> [!NOTE]
> This file is our Statement of Work (SOW) and the single source of truth for scope requirements.
> As features are refined and agreed upon, we will document them here.

## 1. Project Overview & Business Model
We are building **"Brain"**, a minimalist, **Notion-styled** web application for a **Logistics Business**. The application is designed to be highly responsive and mobile-optimized, laying the groundwork for a future mobile/hybrid app transition.

## 2. Target Users (Unified Administrative Flow)
The application has been unified to enforce a highly focused, single administrative console:
1. **Administrative Workspace (Founder & Partners)**
   - Unified administrative view for full operational control.
   - Comprehensive consignment dispatches, overall business finances, and auditing.
   - Simplified workflow: removes redundant mobile field driver toggles for a cleaner, unified ledger dashboard.

## 3. High-Level Feature Scope (Phase 1 - Active)
- **Notion-Style Two-Tab Web UI Dashboard**:
    - Modern minimalist dashboard simplified to exactly two main operational modules: **Expenses Tracking** and **Order Tracking**.
    - **Timeframe Filtering Controls (All, Year, Month, Today)**: Dynamic time-based filtering in both Expenses and Order modules that recomputes financials and displays record lists in real-time.
    - **Sticky Mobile Bottom Tab Bar**: A premium, fixed bottom navigation bar optimized for mobile viewports providing one-tap navigation.
    - **Dual-Mode Entry Console**: A segmented, premium entry console supporting both Income (vendor payments) and Expense (fuel, bittu, service, etc.) entries.
    - **Fuel Slip Receipts Integration**: Highly focused driver entry console that prompts camera/file upload for petrol pump fuel slip validation and links receipt URLs directly with database logs.
    - **Physical Verification Overlay**: Clickable "Slip" badge inside recent activities and ledger tables to immediately inspect uploaded petrol slips in a visual backdrop modal.
    - **Net Cashflow & Cost Metrics**: Real-time aggregation of Total Income, Total Expenses, Net Margin, and Percentage Fuel cost share calculations on the dashboard ledger.
    - **Audit Ledger & Control System**: Allows the Founder and partner to audit, approve, or delete operational logs.
    - **Daily Runsheet & Order Dashboard (Order Tracking)**: Re-architected consignment tracking to daily runsheet totals (assigned vs. completed orders) categorized by "Vendor Ship" (Shadowfax) and "Per Order Rate". Features an interactive runsheet logging console, comprehensive stats cards, custom time-based date and range filters, responsive desktop table layout, and mobile card view.

## 4. Technical Architecture
- **Framework**: React Router v7 / Remix (Vite-based next-gen compiler).
- **Database Engine**: Prisma v6 (SQLite local storage for fast, lightweight local deployment, avoiding heavy remote database host costs).
- **Image Storage**: Base64 datauri persistence for offline-capable, local-first zero-infrastructure slip attachment archiving.
- **Styling**: Tailwind CSS + custom glassmorphic variables themed with premium Notion styles.
