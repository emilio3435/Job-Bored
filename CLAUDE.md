# CLAUDE.md

This repo follows the global 12 agent coding rules defined in `~/dotfiles/agent-rules/CLAUDE.md` (also wired to `~/.claude/CLAUDE.md`, `~/.factory/AGENTS.md`, and `~/.codex/AGENTS.md`).

No Job-Bored-specific overrides. For project context, architecture, and contracts, see `AGENTS.md`, `AGENT_CONTRACT.md`, `DESIGN.md`, and `README.md`.

<!-- directional-prompting:start -->
## Directional Prompting
Goal: Keep repo-local agent instructions aligned with the shared directional-prompting system.

Success means:
- Use the repo-local `directional-prompting` skill symlink when writing prompts, sub-agent directives, orchestration prompts, slash commands, eval rubrics, tool descriptions, or agent rules.
- Open non-trivial prompt drafts with `Goal:`, `Success means:`, and `Stop when:`.
- Phrase body instructions as positive actions and keep unavoidable negation scoped to safety, disambiguation, out-of-scope boundaries, or exact banned items.
- Leave the canonical skill body in the shared source and reference it by path instead of copying it into this file.

Stop when: The updated instruction points agents at the shared skill and the prompt draft has checkable completion criteria.
<!-- directional-prompting:end -->
