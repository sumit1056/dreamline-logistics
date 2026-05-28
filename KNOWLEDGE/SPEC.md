# Project Specification: Brain

> [!NOTE]
> This file is our Statement of Work (SOW) and the single source of truth for scope requirements.
> As features are refined and agreed upon, we will document them here.

## 1. Project Overview & Business Model
We are building **"Brain"**, a minimalist, **Notion-styled** web application for a **Logistics Business**. The application is designed to be highly responsive and mobile-optimized, laying the groundwork for a future mobile/hybrid app transition.

## 2. Target User Roles
The application supports two distinct roles:
1. **Founder Dashboard (Administrative & Dispatch)**
   - Used by the Founder (who currently also acts as a delivery boy).
   - Needs full control over assignment creation, overall business finances, and comprehensive expense auditing.
2. **Delivery Boy View (Field Agent / Driver)**
   - Used by field delivery drivers (including the Founder during delivery tasks).
   - Needs a streamlined mobile view to log delivery statuses and record real-time trip expenses (fuel, tolls, food, maintenance).

## 3. High-Level Feature Scope (Phase 1)
- **WhatsApp Proof-of-Concept (Current Focus)**:
   - A free, zero-cost Node.js engine running locally.
   - Generates a QR Code in the terminal to bind standard personal/business WhatsApp numbers.
   - Listens to incoming group or direct messages.
   - Leverages free Google Gemini API tier to parse unstructured messages into structured expense logs.
   - Persists data to a local `expenses.json` ledger file.
   - Auto-replies with confirmation of what it recorded.
- **Notion-Style Web UI (Phase 2)**:
   - Dashboard displaying expense reports parsed by the WhatsApp bot.
   - Founder audit controls to correct or categorize expenses.

## 4. Technical Architecture (Zero-Cost Focus)
- **Runtime**: Node.js
- **WhatsApp Bridge**: `whatsapp-web.js` (uses Puppeteer to run a local session without Meta Business fees).
- **AI Core**: Google Gemini 1.5 Flash (via free API tier).
- **Data Store**: Local `expenses.json` (upgradeable to SQLite/Prisma once the dashboard is added).
