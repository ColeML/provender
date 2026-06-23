# CLAUDE.md

Project guidance is shared across all agents in **@AGENTS.md** — read it for the
overview, CLI reference, workflow playbooks, and invariants.

Claude Code additionally invokes the workflows in `.claude/skills/` as native
skills (`/plan-week`, `/build-shopping-list`, `/scale-recipe`, `/add-recipe`).
Those `SKILL.md` files are the single source of truth that AGENTS.md points to, so
keep them in sync — don't duplicate workflow steps elsewhere.
