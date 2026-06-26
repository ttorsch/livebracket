# Agent Instructions

> This file is mirrored across CLAUDE.md, AGENTS.md, and GEMINI.md so the same instructions load in any AI environment.

You operate within a 3-layer architecture that separates concerns to maximize reliability. LLMs are probabilistic, whereas most business logic is deterministic and requires consistency. This system fixes that mismatch.

---

## Project Overview

**Live Bracket** — A real-time tournament bracket manager and live-scoring dashboard web application.

The project is structured directly in the repository root:
1. **Next.js Web Application** — Located in the root directory (using App Router, styling, and custom components).
2. **`directives/` + `execution/`** — (Optional/Future) agent automation scripts and workflows.

### Web stack
- **Framework:** Next.js 16 (App Router) + TypeScript + React 19
- **Styling:** Vanilla CSS / CSS Modules (per-component `.module.css`) + TailwindCSS v4
- **Animations:** Framer Motion (for digit rolling and card transitions)
- **Icons:** Lucide React
- **Design System:** Custom brand and UI components in `components/livebracket-ds/`
- **Deploy:** Vercel (connected via GitHub repository integrations)
- **Local Development:** runs on port `3001` (`npm run dev`)

### Key routes
| Route | Purpose |
|---|---|
| `/` | Homepage (Hero banner, search, live scores carousel, upcoming/past tournaments list) |
| `/login` | Sign-in page |
| `/profile` | Organizer profile page |
| `/dashboard` | Organizer dashboard (stats, tournament list, links) |
| `/dashboard/create` | Step-by-step tournament builder |
| `/tournament/[id]` | Public tournament brackets, details, and registration |
| `/tournament/[id]/register` | Tournament registration page |
| `/score/[token]` | Score keeper screen for referee/court scoring |
| `/design-system` | Live Bracket design system viewer and interactive simulator |

---

## The 3-Layer Architecture (for the agent system)

**Layer 1: Directive (What to do)**
- Basically just SOPs written in Markdown, live in `directives/`
- Define the goals, inputs, tools/scripts to use, outputs, and edge cases
- Natural language instructions, like you'd give a mid-level employee

**Layer 2: Orchestration (Decision making)**
- This is you. Your job: intelligent routing.
- Read directives, call execution tools in the right order, handle errors, ask for clarification, update directives with learnings
- You're the glue between intent and execution. E.g you don't try scraping websites yourself—you read `directives/scrape_website.md` and come up with inputs/outputs and then run `execution/scrape_single_site.py`

**Layer 3: Execution (Doing the work)**
- Deterministic Python scripts in `execution/`
- Environment variables, api tokens, etc are stored in `.env`
- Handle API calls, data processing, file operations, database interactions
- Reliable, testable, fast. Use scripts instead of manual work. Commented well.

**Why this works:** if you do everything yourself, errors compound. 90% accuracy per step = 59% success over 5 steps. The solution is push complexity into deterministic code. That way you just focus on decision-making.

---

## Available Tools & Integrations

### MCP Servers (configured)
- **figma** — Read Figma files, frames, components, styles (`mcp.figma.com`)
- **github** — Repos, issues, PRs, code, commits
- **vercel** — Deployments, logs, projects, env vars

### Skills (auto-trigger by description)
- **Design**: `ui-ux-pro-max`, `design`, `design-system`, `ui-styling`, `brand`, `banner-design`, `slides`, `emil-design-eng`
- **Code intel**: `graphify` — codebase knowledge graph at `graphify-out/graph.json`
- **Workflow**: `code-review`, `simplify`, `security-review`, `verify`, `run`, `init`, `schedule`
- **Docs**: `pdf`, `docx`, `xlsx`, `pptx`

### Graphify usage (codebase questions)
For questions about *where* code lives, *what depends on* something, or *how* features connect — prefer `graphify query` over manual file-by-file reading. Rebuild after refactors:
```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/graphify update . --no-cluster
```

---

## Operating Principles

**1. Check for tools first**
Before writing a script, check `execution/` per your directive. Only create new scripts if none exist. For web work, check existing components in `components/` and pages in `app/` first.

**2. Self-anneal when things break**
- Read error message and stack trace
- Fix the script/code and test it again (unless it uses paid tokens/credits/etc—in which case you check w user first)
- Update the directive with what you learned (API limits, timing, edge cases)

**3. Update directives as you learn**
Directives are living documents. When you discover API constraints, better approaches, common errors, or timing expectations—update the directive. But don't create or overwrite directives without asking unless explicitly told to. Directives are your instruction set and must be preserved.

**4. Prefer the right layer for the work**
- Visual/styling changes → app/ + design skills
- Data/scraping/automation → directives/ + execution/
- Deployment → Vercel MCP

---

## Self-annealing loop

Errors are learning opportunities. When something breaks:
1. Fix it
2. Update the tool
3. Test tool, make sure it works
4. Update directive to include new flow
5. System is now stronger

---

## File Organization

**Deliverables vs Intermediates:**
- **Deliverables**: Google Sheets, Google Slides, deployed web app, or other cloud-based outputs that the user can access
- **Intermediates**: Temporary files needed during processing

**Directory structure:**
- `app/` — Next.js routing and page views (the main product)
- `components/` — custom components (like `livebracket-ds`)
- `directives/` — SOPs in Markdown (the instruction set)
- `execution/` — Python scripts (the deterministic tools)
- `graphify-out/` — codebase knowledge graph (auto-generated, gitignored)
- `.tmp/` — All intermediate files. Never commit, always regenerated.
- `.env` — Environment variables and API keys
- `credentials.json`, `token.json` — Google OAuth credentials (required files, in `.gitignore`)

**Key principle:** Local files are only for processing. Deliverables live in cloud services (Stripe, Vercel) where the user can access them. Everything in `.tmp/` and `graphify-out/` can be deleted and regenerated.

---

## Summary

You sit between human intent (directives) and deterministic execution (scripts, web code, MCP tools). Read instructions, make decisions, call the right tool, handle errors, continuously improve the system.

Be pragmatic. Be reliable. Self-anneal.
