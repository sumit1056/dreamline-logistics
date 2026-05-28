# Audit Log

This log registers every major technical decision, design pattern adoption, scope modification, and rationale for long-term troubleshooting and reporting.

## Decisions and Rationale

| Date | Type | Description | Rationale | Status |
| :--- | :--- | :--- | :--- | :--- |
| 2026-05-28 | Tech Stack / Architecture | **Project Initialization** | Initialized the "Brain" project long-term memory structure with `SPEC.md`, `CORE_MEMORIES.md`, and `AUDIT_LOG.md`. | Completed |
| 2026-05-28 | Rules Integration | **Synchronized Global Antigravity Rules** | Read `GEMINI.md` and updated `CORE_MEMORIES.md` with explicit guidelines on Design, Prisma Logic, Verification with DevTools, Complex Task Sequential Thinking, Shopify command execution rules, and KB maintenance. | Completed |
| 2026-05-28 | Scope Definition | **Captured Logistics Core Scope** | Documented initial logistics business requirement, dual-role system (Founder / Delivery Boy), Notion-style design language, and Expense Tracker baseline in `SPEC.md`. | Completed |
| 2026-05-28 | Architecture Upgrade | **Added WhatsApp AI Logging Pipeline** | Evaluated technical viability of WhatsApp Group AI Parser. Added detailed data pipeline architecture to `SPEC.md` to feed structured logs directly into the core app's database. | Completed |
| 2026-05-28 | Strategy Pivot | **WhatsApp Free Proof-of-Concept Sprint** | Agreed to test a 100% free local WhatsApp-web session + Gemini API parser first before building the full dashboard, validating field driver UX. | Completed |
| 2026-05-28 | Environment Config | **Configured Active Gemini API Key** | Successfully written the user's "Dreamline Logistics key" into `.env` and initialized the active Gemini API core parsing engine. | Completed |
| 2026-05-28 | Session Routing | **Added Selective WhatsApp Filtering** | Integrated `TRACKED_GROUP_NAME` and `ALLOW_DMS` parameters into `.env` and `whatsapp_poc.js` to restrict AI parsing only to configured groups/direct chats, preventing accidental logs in personal conversations. | Completed |
| 2026-05-28 | Bug Fix | **Allowed Account Self-Messages** | Fixed a loop-prevention block that was ignoring messages sent from the *same* WhatsApp account. Refined the check to allow self-sent logs (essential for single-phone testing) while safely discarding the bot's own self-replies to prevent loops. | Completed |
