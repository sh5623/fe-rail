# fe-rail

<div align="right">
  <a href="README.md"><img src="https://img.shields.io/badge/lang-한국어-lightgrey?style=flat-square" alt="한국어"/></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/lang-English-blue?style=flat-square" alt="English"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License"/></a>
</div>

> Frontend-focused Claude Code plugin  
> Automated spec → build → review → PR workflow for Next.js App Router / Vite SPA (TanStack Router · React Router 7) + TypeScript, Tailwind v3/v4 / shadcn/ui.

## Installation

```bash
claude

/plugin marketplace add sh5623/fe-rail
/plugin install fe-rail@fe-rail-market
```

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| fe-spec | `/fe-rail:fe-spec` | Requirements → structured spec document. Phase 3 presents a radio UI to choose the next step (full auto · build only · revise spec) — selecting "full auto" hands off directly to the fe-start pipeline |
| fe-build | `/fe-rail:fe-build` | Frontend implementation (types → logic → components → tests) |
| fe-review | `/fe-rail:fe-review` | 4-axis code review: types · performance · a11y · quality |
| fe-start | `/fe-rail:fe-start feature.md` | All-in-one — automates through PR creation. Phase 1 · 5 use radio UI to confirm implementation and commit intent |
| fe-doc-sync | `/fe-rail:fe-doc-sync` | Scans the **consumer project** (routes · deps · structure · ENV) → proposes updates to that project's CLAUDE.md · README.md |

## Hooks

Policy: **Block dangers (exit 2), warn on quality issues (stderr)**.

| Hook | Event | Role | Blocks |
|------|-------|------|--------|
| `session-init.sh` | SessionStart | Remote version check + new version notification (GitHub, once/day) | — |
| `guard.sh` | PreToolUse:Bash | Blocks `git add .`, force push, `--no-verify`, `rm -rf /`, `DROP TABLE`, `git reset --hard`, etc. | ✅ |
| `write-guard.sh` | PreToolUse:Write\|Edit\|MultiEdit | Blocks sensitive file creation/modification: `.env*`, `*.pem`, `*.key`, `*secret*` (`.env.example` allowed) | ✅ |
| `read-guard.sh` | PreToolUse:Read | Warns on sensitive file reads (`.env`, `*.pem`, `*.key`, `*credential*`, etc.) | — |
| `task-guard.sh` | PreToolUse:Task\|Agent | Blocks injection patterns and dangerous command delegation in sub-agent prompts | ✅ |
| `lint-fix.sh` | PostToolUse:Edit\|Write\|MultiEdit | Auto-detects consumer env → runs Biome `check --write` **or** ESLint `--fix` (+ Prettier) | — |
| `nextjs-guard.sh` | PostToolUse:Edit\|Write\|MultiEdit | Detects React hooks/browser API/DOM events in Server Components; warns on `'use client'` in app router `page`/`layout` | — |
| `quality-gate.sh` | Stop | Runs linter (Biome **or** ESLint) + `tsc --noEmit` on changed files, outputs warnings | — |
| `doc-sync-check.sh` | Stop | Detects changes to consumer project code / package.json / config files → suggests `/fe-rail:fe-doc-sync` (includes last 5 commits) | — |
| `notify.sh` | (Optional) Notification | macOS terminal-notifier banner — activate with `bash hooks/scripts/setup-notifier.sh` | — |

## Agents

Each agent runs in an isolated context, protecting the main session from noise.  
Structure: frontmatter (`tools`/`disallowedTools`/`model`/`maxTurns`) + XML tags (`<purpose>`/`<forbidden>`/`<required>`/`<workflow>`/`<output>`).

> **Model tiers are aliases.** Each agent's `model` is set to `opus`/`sonnet`/`haiku` — automatically using the latest tier on model family updates (e.g. Opus 4.7 → 4.8). Behavior may vary even with the same plugin version; run regression checks on each release if reproducibility matters.  
> Tier allocation: **opus** (high-judgment — `fe-analyst` · `fe-architect` · `fe-reviewer` · `fe-refactor-advisor`) / **haiku** (low-cost exploration — `fe-explorer`) / **sonnet** (all other execution/tool agents).

### Spec stage
| Agent | When to delegate | Model | Isolation |
|-------|-----------------|-------|-----------|
| `fe-analyst` | Requirements gap analysis (6 gaps / 7 sections); parallel scan of CLAUDE.md · DESIGN.md · PRODUCT.md · AGENTS.md | opus | Scoped (read-only) |
| `fe-vision` | Figma · UI screenshots · PDFs (Figma URL → `get_metadata` · `get_design_context` · `get_variable_defs` · `get_screenshot`; DESIGN.md Bans anti-slop check) | sonnet | Scoped (read-only) |
| `fe-researcher` | External docs · library research (Context7 MCP preferred, WebSearch/WebFetch fallback) | sonnet | Tool (Context7/WebSearch/WebFetch) |
| `fe-architect` | React/TS architecture — Next.js (RSC boundaries) / Vite SPA (TanStack Router · React Router 7 · Zustand) + Tailwind v3/v4 · shadcn (orthogonal detection) | opus | Scoped (read-only) |

### Build stage
| Agent | When to delegate | Model | Isolation |
|-------|-----------------|-------|-----------|
| `fe-explorer` | Codebase exploration (3+ queries) | haiku | Context |
| `fe-test-author` | BDD scenario derivation + TDD Red-Green-Refactor | sonnet | Scoped (implementation) |
| `fe-build-fixer` | tsc · linter (ESLint/Biome) error fixes with minimal diff | sonnet | Tool (Edit+Grep, Write/MultiEdit blocked) |

### Review stage
| Agent | When to delegate | Model | Isolation |
|-------|-----------------|-------|-----------|
| `fe-reviewer` | 4-axis review (type · performance · a11y · quality, Tailwind anti-patterns included) | opus | Scoped (read-only) |
| `fe-a11y-auditor` | 8-axis a11y audit (Color Contrast — Tailwind palette-based included) | sonnet | Scoped (read-only) |
| `fe-perf-auditor` | Performance audit — Next.js (RSC · next/image · next/font) / Vite SPA (TanStack loader · RR7 TQ prefetch · fetchpriority · bundle) / Tailwind v3/v4 (purge · @source · @apply) | sonnet | Scoped (read-only) |
| `fe-test-runner` | Test execution + failure classification | sonnet | Context |
| `fe-refactor-advisor` | 6-dimension refactoring analysis + Before/After | opus | Scoped (read-only) |

### PR stage
| Agent | When to delegate | Model | Isolation |
|-------|-----------------|-------|-----------|
| `fe-git-operator` | Commit splitting · safe staging + body authoring (fix = symptom·cause·fix / feat = added·core·impact) | sonnet | Tool (Write/Edit blocked) |
| `fe-pr-author` | PR body authoring (🐛/✨ blocks by change type) + `gh pr create` | sonnet | Context + Tool |

## Workflow

**All-in-one automation (fe-start)**
```
Write feature.md → /fe-rail:fe-start feature.md → [radio] "Implement?" → [radio] "Commit?" → PR created
```

**fe-spec → full-auto handoff**
```
/fe-rail:fe-spec → [radio] select "Full auto" → fe-start Phase 2 directly → [radio] "Commit?" → PR created
```
> Selecting "Full auto" in fe-spec Phase 3 counts as the implementation approval, so fe-start Phase 1 is skipped. Two human touch-points are still maintained.

**Step-by-step manual control**
```
/fe-rail:fe-spec → /fe-rail:fe-build → /fe-rail:fe-review → git commit && gh pr create
```

## Prerequisites

- Claude Code
- Package manager (pnpm / npm / yarn / bun — auto-detected via lockfile)
- gh CLI (for automated PR creation)
- TypeScript strict mode (Next.js / Vite SPA)

## Post-install Recommended Setup (Consumer Project)

Plugin agents read and reason from the **consumer project's context**. Setting these up right after installation significantly improves output quality.

| Item | Why | How |
|------|-----|-----|
| **Project CLAUDE.md** | `fe-analyst` · `fe-architect` etc. read the stack · rules · constraints — without it, agents work blind (this plugin's CLAUDE.md is not loaded in consumer sessions) | `/init` or `/fe-rail:fe-doc-sync` |
| **Bash permissions** | Prevents permission prompts on every `fe-git-operator` · `fe-pr-author` action | Add `Bash(git *)` · `Bash(gh pr *)` to `permissions.allow` in `.claude/settings.json` |
| **MCP (optional)** | Enables `fe-vision` Figma direct queries and `fe-researcher` Context7 doc lookups (falls back to local images · WebSearch if not installed) | Install Figma MCP (server name `Figma`) / Context7 plugin |
| **Validation scripts** | Phase 3 auto-validation uses `package.json` `typecheck`/`lint`/`test` scripts | Define those scripts |

## License

[MIT](LICENSE) © 2026 이승호

## References

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [garrytan/gstack](https://github.com/garrytan/gstack)
