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
    - **Daily Runsheet & Order Dashboard (Order Tracking)**: Re-architected consignment tracking to daily runsheet totals (completed orders) categorized by "Vendor Ship" (₹70/order weekly payout) and "Split Plan" (₹35/order weekly payout + ₹53,000 monthly base deferred 45 days). Features an interactive runsheet logging console, comprehensive stats cards, custom time-based date and range filters, responsive desktop table layout, and mobile card view. Includes a Settlement Cycles Tracker with paid/unpaid status filters and sorting (due date, amount) for auditing vendor payouts.
- **Progressive Web App (PWA) Mobile Installability**:
    - **Offline Caching & Fallback**: Configured Service Worker (`sw.js`) supporting offline asset caching and network-first fetch strategies for highly reliable use on the road by logistics drivers.
    - **Standalone Visual Presentation**: Native-feeling display mode with hidden URL bars, immersive notched layout viewport adaptations (`viewport-fit=cover`), pull-to-refresh overrides, and disabled double-tap zooms.
    - **Universal Mobile Installation**: Built a custom PWA `manifest.json` enabling immediate, native installation directly onto Android/iOS homescreens.
    - **PWA Dynamic Shortcuts**: Fully functional long-press launcher shortcuts ("Log Transaction", "Add Runsheet") that deep-link directly into pre-opened forms.

## 4. Technical Architecture
- **Framework**: React Router v7 / Remix (Vite-based next-gen compiler).
- **Database Engine**: Prisma v6 (PostgreSQL via Neon cloud hosting for high availability and robust data operations).
- **Image Storage**: Base64 datauri persistence for offline-capable, local-first zero-infrastructure slip attachment archiving.
- **Styling**: Tailwind CSS + custom glassmorphic variables themed with premium Notion styles.
- **App Wrapper / Mobile Integration**: Progressive Web App (PWA) with client-side shortcuts, cache service worker, and standard Apple Mobile Web App standards.

## 5. Mid-Beta Enhancements & UI/UX Refinements (Phase 1.1)
- **Auto-Hiding Notification Timers**: 
    - Implemented a 6-second auto-hiding delay for all workspace status alerts, validation errors, AI parsed expense helpers, and login authentication errors to prevent sticky message blocking.
- **Dynamic Driver Assignment in Runsheet Console**:
    - The Daily Runsheet Console conditionally displays the driver selection dropdown based on active driver count. 
    - If 0 or 1 drivers are registered, the selector is hidden and the lone driver is passed automatically as a hidden input.
    - If multiple drivers exist, the dropdown is displayed in a balanced, responsive column layout grid.
- **Custom Notion-Styled Popup Modals**:
    - Replaced all default browser-native `alert()` and `confirm()` popup alerts with a unified, custom responsive slide-up overlay modal matching the Notion aesthetics.
- **User Control Center Credentials Visibility**:
    - Registered driver operator profiles display their plain-text passwords (`passwordText` field in the database) to allow administrators to directly view/copy them for dashboard access.
    - Added a togglable eye-icon toggle to show/hide plaintext values on the Create Admin password input.
    - Streamlined layout by removing descriptive subheadings across the administrative forms.
- **Runsheet History Advanced Filtering**:
    - Integrated a dynamic "Filter Driver" option in the Runsheet History tracker dashboard to sort/view logs per driver operator.
    - Corrected the click details mapping inside "Recent Daily Logs" to display the specific driver profile modal details instead of defaulting to the first record.

