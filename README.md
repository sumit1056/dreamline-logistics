# 🧠 Brain - Dreamline Logistics Control Center

A high-fidelity, high-density administrative cockpit designed for **Dreamline Logistics** to audit, track, and manage all core business operations. Built with a premium, minimalist **Notion & AdminMart Modernize** aesthetic, it features fully responsive layouts, localized SQLite storage, real-time analytics aggregation, and advanced AI-assisted data parsing.

---

## 🎨 Premium Visual & UX Architecture
* **AdminMart Modernize VueJS Styling**: Beautiful administrative layouts using curated harmonies, modern typography (**Plus Jakarta Sans**), glassmorphic elements, and signature soft drop-shadow containers.
* **Dual-Mode Theme Synchronization**: Seamless header-level dark/light mode toggle with persistent local storage.
* **Segmented Brand Accent Colors**: Standardized active toggle selections and input focus indicators using the primary brand blue accent (`#5D87FF`).
* **Optimized Mobile Drawer & Sticky Bottom Nav**: Fluid slide-in drawer on mobile screens with a blurred backdrop, accompanied by a sticky bottom navigation bar for absolute mobile responsiveness.

---

## 🚀 Key Functional Features

### 1. Unified Entry Console
* **🤖 Smart AI Expense Log Parser**: Natural language interface that processes raw text inputs using **Google Gemini AI** (`gemini-flash-latest`). Automatically extracts amounts, categories, and vehicle numbers (e.g. *"Example: diesel bill ₹4500 for truck MH-12-AB-1234 by sam today"*).
* **✍️ Clean Manual Input Forms**: Streamlined manual records inputs matching the premium UI theme.
* **⛽ Camera & Photo Slip Attachment**: Prompts physical fuel slip capture (`capture="environment"`) for verification of fuel logs, embedding them as lightweight, offline-first base64 strings directly in the SQLite database.

### 2. Expenses Log & Interactive Ledger
* **Real-time Financial Aggregate Cards**: Dynamically computes **Total Income**, **Total Expenses**, **Net Margin**, and **Fuel Cost Share** based on selected filters.
* **Multi-Tier Connected Filtering**:
  * **Timeframe Filters**: Quick toggles for **All**, **Year**, **Month**, **Today**, or **Custom Date Ranges** (single day or interval) with inline badges.
  * **Category Filters**: Filter transactions instantly between **All Transactions**, **Expenses Only**, and **Income Only**.
* **Visual Audit Overlay Modal**: Inspect uploaded physical vouchers instantly inside a blurred visual overlay by clicking the sleek SVG eye/slip verification badges in the ledger.

### 3. Daily Runsheet Order Tracking
* **Daily Fleet Aggregates**: Track dispatch allocations by **Vendor Ship** (Shadowfax) and **Per Order Rate**.
* **Auto-Fading Action Statuses**: Fluid feedback messages that fade out automatically after 6 seconds.
* **Driver Runsheet Sidebar & Profile Modal**: Minimalist collapsibles that click through to reveal detailed runsheet information without cluttering the administrative canvas.

---

## 🛠️ Technical Stack
* **Framework**: React Router v7 / Remix (Vite-based next-gen compiler).
* **Database**: Prisma v6 with a local SQLite engine (`file:./dev.db`) for lightweight, offline-first execution with zero infrastructure costs.
* **AI Core**: Google Gemini AI model `gemini-flash-latest` via developer API integrations.
* **Styling**: Tailwind CSS v4 + customized Notion CSS variables.

---

## 📦 Getting Started

### 1. Installation
Install the dependencies:
```bash
npm install
```

### 2. Environment Setup
Create a `.env` file in the root directory and add your Google Gemini API key:
```env
GEMINI_API_KEY="your_gemini_api_key_here"
```

### 3. Database Initialization & Migration
Generate the local SQLite database client and apply migrations:
```bash
npx prisma migrate dev --name init
```

### 4. Running the App Local
Start the Vite development server with Hot Module Replacement (HMR):
```bash
npm run dev
```
Open **`http://localhost:5173`** in your browser to access the control center.

---

## 🗂️ Knowledge Base (`/KNOWLEDGE`)
This project maintains an structured `/KNOWLEDGE` directory containing its system specifications and history:
* **`SPEC.md`**: Statement of Work (SOW) and feature requirements.
* **`CORE_MEMORIES.md`**: Persistent guidelines, rules, and stack constraints.
* **`AUDIT_LOG.md`**: Full historic log of structural, visual, and operational adjustments.

---
*Built with ❤️ for Dreamline Logistics*
