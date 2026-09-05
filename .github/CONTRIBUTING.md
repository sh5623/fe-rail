# Contributing to fe-rail

Thanks for considering a contribution. `fe-rail` is a Claude Code plugin (harness) for
frontend projects — not an application itself. Changes here affect every consumer project
that installs the plugin, so please read this before opening a PR.

## Before you start

- Skim `CLAUDE.md` for the harness architecture (agents / hooks / skills layers) and the
  model-tier policy.
- Check open issues and PRs first to avoid duplicate work.
- For anything non-trivial (new agent, new hook, changed workflow), open an issue to
  discuss the approach before writing code.

## Development setup

```bash
git clone https://github.com/sh5623/fe-rail
cd fe-rail
```

There's no build step — agents/skills/hooks are plain Markdown + shell. To exercise your
working tree end to end, point Claude Code straight at it from a **test project**:

```bash
cd /path/to/some/test-project
claude --plugin-dir /path/to/your/local/fe-rail
```

Do **not** rely on `/plugin marketplace add /path/to/your/local/fe-rail` for this —
`.claude-plugin/marketplace.json` declares the plugin's `source` as the GitHub repo
`sh5623/fe-rail`, so a marketplace registered from your clone still installs the
published tree, not the one you are editing. If you must go through a marketplace, make
a throwaway one whose plugin `source` is a local path.

Hooks only load at session start — restart your Claude Code session after editing a hook
for the change to take effect. If the published plugin is also installed, check that only
one copy is active (`/plugin` lists both) so you do not test against a cached install.

## Testing your change

Run the deterministic regression suite before opening a PR — it checks hook behavior,
profile toggles, and self-lint (agent model aliases, skill frontmatter, `hooks.json`
integrity):

```bash
bash eval/run.sh
```

A failing run blocks the PR — the `eval` workflow (`.github/workflows/eval.yml`) runs the
same command on every pull request and on pushes to `main`, alongside `bash -n` on the
shell scripts and a JSON/manifest check. Run it locally first anyway; CI is the backstop,
not the first signal. If you added a new hook or agent, extend `eval/run.sh` with coverage
for it.

## Making changes

- **Agents** (`agents/*.md`): keep `model` as an alias (`opus`/`sonnet`/`haiku`), never
  a pinned version. Respect the tier policy in `CLAUDE.md` — don't upgrade an agent to
  `opus` without a judgment/gate justification.
- **Hooks** (`hooks/`): blocking hooks (exit 2) must have a clear, low-false-positive
  trigger. Prefer warning (stderr) over blocking when uncertain. Wire new hooks into
  `hooks/hooks.json` and the profile logic in `hooks/scripts/profile-lib.sh`.
- **Skills** (`skills/*/SKILL.md`): keep `allowed-tools` scoped to what the skill
  actually needs. If a skill delegates to sub-agents, its `allowed-tools` must include
  `Task`/`Agent`.
- **Docs**: `README.md` is the canonical (English) doc; keep `README.ko.md` in sync.
  `CLAUDE.md` targets the agent, not humans — update both when behavior changes.

## Commit / PR style

- Conventional-ish prefixes are used in this repo's history (`fix:`, `feat:`, `chore:`,
  `docs:`) — follow the existing log (`git log --oneline`) for tone.
- Keep PRs scoped to one concern. Don't bundle unrelated agent/hook/doc changes.
- Fill out the PR template checklist, including the `eval/run.sh` result.

## Reporting bugs / requesting features

Use the issue templates (Bug report / Feature request). Include which consumer project
type you're testing against (Next.js App Router, Vite + TanStack Router, Vite + React
Router 7·8, monorepo) — behavior is framework-detected and can diverge.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating
you agree to abide by it.
