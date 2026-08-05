## Summary

What does this PR change and why? (1-3 bullets)

-

## Layer(s) touched

- [ ] Agent (`agents/*.md`)
- [ ] Hook (`hooks/*.sh`, `hooks/hooks.json`)
- [ ] Skill (`skills/*/SKILL.md`)
- [ ] Docs (`CLAUDE.md`, `docs/*.md`, `README*.md`)
- [ ] Eval (`eval/run.sh`)

## Checklist

- [ ] `bash eval/run.sh` passes (hook behavior, profile toggles, self-lint)
- [ ] Agent `model` fields use aliases (`opus`/`sonnet`/`haiku`), not pinned versions
- [ ] New/changed hooks are wired into `hooks/hooks.json` and, if blocking, justified
      (low false-positive trigger — see `CLAUDE.md` hook profile policy)
- [ ] Skill `allowed-tools` stays scoped to what the skill needs (includes `Task`/`Agent`
      only if it delegates)
- [ ] `README.md` and `README.ko.md` updated together if user-facing behavior changed
- [ ] `CLAUDE.md` updated if agent/hook/skill structure changed
- [ ] `.claude-plugin/plugin.json` version bumped if this PR changes **any file that ships
      in the plugin tree** — agents, hooks, skills, `eval/`, `CLAUDE.md`, `README*`, `docs/`
      — not just runtime behavior. A consumer install is cached at
      `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` as a plain copy keyed by
      version, so the same version string must always mean the same tree. Skip only for
      repo-governance files (`.github/**`, `LICENSE`) that never reach an install.

## Test plan

How did you verify this? (e.g. installed in a local test project, ran a specific
workflow end to end, `eval/run.sh` output)

## Related issue

Closes #
