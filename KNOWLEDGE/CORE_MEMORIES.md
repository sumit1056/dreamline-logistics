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
- **Git Identity Guidelines**: Global git user settings are intentionally unset to protect privacy. Local repository-level settings are hard-configured inside this folder to stamp all commits with `sumit1056` and `sumit1056@users.noreply.github.com`. Keep this standard local config active!
- **Project Portability**: `.env` configurations are pre-packaged to connect directly to the high-availability Neon cloud PostgreSQL database, allowing seamless data synchronization and zero local database setup on your home development setup.
- **Home Execution Steps**:
  1. Clone/pull the repository.
  2. Run `npm install` to download dependencies.
  3. Start the application locally via `npm run dev` (it connects directly to your live cloud database and ready-to-use Gemini failover chain).

## Next Phase Objectives & Technical Handshake
When initiating the next coding session (whether at home or on the corporate laptop), prioritize the following outstanding objectives:
1. **Authentication System Integration:** 
   - Wrap the dashboard in a secure credentials gate.
   - Enforce a robust Username/Password login page so that no unauthorized visitor can view or alter the operational ledgers.
   - Restrict access to authenticated administrators only, preserving existing mock user sessions if driver routing is needed in the future.
2. **Beta Test Feedback Iterations:**
   - Gather operational feedback from users testing the production URL.
   - Iterate on performance improvements, error boundary displays, or any minor UI visual polish requested by operators.
3. **Post-Beta Production DB Maintenance:**
   - Coordinate with the founder for a full cloud database reset/purge when ready to exit the beta window, ensuring a pristine schema slate for the official launch.

