# MASTER DEVELOPMENT LIFECYCLE MAP (`S:\optimization`)

A linear, 6-phase engineering workflow showing when and how to execute every tool, skill, MCP server, and checklist in your master library—from project start to production launch.

---

## 6-PHASE LINEAR DEVELOPMENT PIPELINE

1. **PHASE 1: Project Initialization & Planning** (PRD, TRD, Spec-Kit)
2. **PHASE 2: Frontend Design & Visual Foundation** (Refero, Taste, Motion, UI-UX Pro Max, find-skills)
3. **PHASE 3: Core Code Construction & Reasoning** (Codebase Memory, Context7)
4. **PHASE 4: Autonomous Task Execution** (Ralph, GSD, ADK)
5. **PHASE 5: Visual QA, Debugging & Flow Testing** (Agentation, Reticle)
6. **PHASE 6: Production Pre-Flight Audit & Launch** (Security, Speed Audit)

---

### PHASE 1: Project Initialization & Planning (BEFORE Writing Code)

**Objective**: Lock requirements, user appflows, and database schemas so AI agents never guess or hallucinate logic.

- **The 6 Pre-Vibecoding Documents (`KNOWLEDGE/`)**:
  - `KNOWLEDGE/PRD.md` — Product Requirements Document (problem statement, personas, scope).
  - `KNOWLEDGE/TRD.md` — Technical Requirements Document (tech stack, SLA, constraints).
  - `KNOWLEDGE/UI_UX_DESIGN.md` — Design system rules & color tokens.
  - `KNOWLEDGE/APPFLOW.md` — User journey routes, state transitions, empty/loading fallbacks.
  - `KNOWLEDGE/BACKEND_SCHEMA.md` — Database ERD models, Zod validation schemas.
  - `KNOWLEDGE/IMPLEMENTATION_PLAN.md` — Phased step-by-step task roadmap.

- **Tools & Protocols Active**:
  - **GitHub Spec Kit**: Commands `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.clarify`.
  - **Sequential Thinking MCP (`sequentialthinking`)**: Multi-step reasoning for architectural design.
  - **Scope-Guard Protocol**: Compares incoming requests against `PRD.md` and flags `🚨 SCOPE CHANGE DETECTED`.

---

### PHASE 2: Frontend Design & Visual Foundation (Visual Styling)

**Objective**: Establish world-class visual hierarchy, color tokens, and fluid motion with zero generic AI UI slop.

- **Design System References**:
  - **`styles.refero.design` & `refero.design`**: Ingest machine-readable `DESIGN.md` tokens from top products (Linear, Stripe, Apple). Proactively presents 2 clickable design directions for user verification.
  - **`motionsites.ai`**: Motion galleries for scroll animations and spring physics.
  - **Vercel Labs Skills Registry (`skills.sh`)**: Central marketplace for AI agent skills.

- **Skills & Libraries Active**:
  - **Frontend Design Quad**:
    - **Layer 1: TasteSkill** (`npx skills add Leonxlnx/taste-skill`) — Curated typography, HSL palettes, glassmorphism.
    - **Layer 2: Impeccable** (`npx skills add pbakaus/impeccable`) — Steering via `/polish` (de-noising) & `/distill` (hierarchy).
    - **Layer 3: Emil Kowalski Skill** (`npx skills add emilkowalski/skill`) — `animate` for spring curves & physics.
    - **Layer 4: UI-UX Pro Max** (`npx skills add nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max`) — 50+ component guidelines & color systems.
  - **Dynamic Meta-Skill**: `find-skills` (`npx skills add vercel-labs/skills/find-skills`) — Allows AI agent to search and install new skills on-the-fly when needed!
  - **UI Layout Libraries**: Watermelon UI, Variant UI, GrayBlocks, Screenshot-to-Code, Checklist.design.

---

### PHASE 3: Core Code Construction (Building Features)

**Objective**: Implement clean, type-safe business logic, database queries, and third-party integrations with zero API hallucinations.

- **MCP Tools & Intelligence Active**:
  - **Codebase Memory MCP (`codebase-memory`)**: Indexes repository into Tree-sitter SQLite knowledge graph. Executes `get_architecture`, `detect_changes`, `trace_dependency` (saves **99% of context window tokens**).
  - **Upstash Context7 MCP (`context7`)**: Add `"use context7"` to prompts when building complex 3rd-party APIs (Next 15, Stripe, Supabase) for live, version-specific documentation.
  - **GitHub MCP (`github`)**: Managing PRs, commits, branches, and issue tracking directly from prompt.

---

### PHASE 4: Autonomous Task Execution (Complex Features)

**Objective**: Execute multi-step task checklists autonomously without prompt drift or model context degradation.

- **Tools Active**:
  - **Ralph Autonomous Agent Loop (`snarktank/ralph`)**: Repeatedly executes tasks from `IMPLEMENTATION_PLAN.md` until 100% complete.
  - **GSD Protocol (`gsd-build`)**: Context engineering for multi-file architectural changes.
  - **Google Agent Development Kit (ADK)**: Supervisor-worker multi-agent orchestration.

---

### PHASE 5: Visual In-Browser QA, Testing & Feedback (Verification)

**Objective**: Verify real browser user flows, annotate visual bugs, and triage live runtime errors.

- **Tools Active**:
  - **Agentation (`agentation.com`)**: Floating React in-browser annotation toolbar (`npm install agentation -D`). Click UI elements to capture CSS selectors, component trees, and status (`Pending` -> `Resolved`).
  - **Reticle QA (`reticle.sh`)**: Flow replay and real state/network assertions on web apps.
  - **Sentry MCP (`mcp.sentry.dev`)**: Inspect live production error stack traces on-demand.

---

### PHASE 6: Production Pre-Flight Audit & Launch (BEFORE Deploying)

**Objective**: Audit SEO, security vulnerability points, and performance bottlenecks before publishing to production.

- **The 31-Point Production Audit**:
  - **Web Pre-Flight (20 Points)**: SEO titles, meta descriptions, `og:image`, canonical, `sitemap.xml`, branded favicon, single `<h1>`, 0 console errors, code-split bundles, custom 404, `llms.txt`, `robots.txt`.
  - **Backend Security (6 Prompts)**: Rate limiting on auth/public routes, strict Zod input validation, zero secret leaks in frontend/Git, dependency CVE scans, error stack masking, magic-byte file upload safety.
  - **App Performance (5 Prompts)**: Gzip/brotli API compression, batch SQL inserts/updates, circuit breakers for slow dependencies, optimistic UI updates, static fragment caching.
  - **CodeRabbit (`coderabbitai`)**: Automated GitHub PR code review bot.

---

## DAILY CHEAT SHEET: HOW TO INVOKE AT EACH STEP

| Step / Task | Command / Trigger | Active Tools |
| :--- | :--- | :--- |
| **New Project Start** | Paste `MASTER_INIT_PROMPT.md` | Initialize 6 Pre-Vibecoding Docs, Spec-Kit |
| **UI Design Phase** | Prompt for UI layout | Auto-run Design Triad, UI-UX Pro Max, `find-skills` |
| **Dynamic Skill Discovery** | Ask for new capability | `find-skills` meta-skill on `skills.sh` |
| **Complex 3rd-Party API** | Add `"use context7"` to prompt | Context7 MCP live docs fetch |
| **Large Repo Exploration** | Run `get_architecture` | Codebase Memory MCP (99% token saver) |
| **In-Browser UI QA** | `npm install agentation -D` | Agentation visual feedback toolbar |
| **Pre-Launch Audit** | Ask to prepare for launch | 31-Point Performance & Security Audit |
