# Maintainers

Code ownership by area. Based on git history of this repo.

## Active contributors

| Name | Commits | Areas |
| --- | --- | --- |
| `emilio3435` | 414 | Everything — sole human contributor |
| `Command Center` (bot) | 5 | Automated maintenance |
| `emiliobuilds` | 5 | Alt identity for the same human |
| `Cursor Agent` | 1 | Single-shot Cursor session |

Most commits are agent-assisted: `Co-authored-by:` lines attribute Factory Droid, Claude Code, Cursor, Warp, Codex, and (recently) the `factory-droid[bot]` account.

## How to reach a maintainer

- Issues: GitHub Issues on the repo
- Security: `SECURITY.md` channel
- Direct: see `package.json` `author`

## Working in this repo as a non-maintainer

The repo is structured to be forkable. Almost everything is BYO: the dashboard works against your sheet, the discovery worker against your tokens, the relay under your Cloudflare account. There is no shared multi-tenant state, so a fork is fully self-contained.

When opening a PR, run the [contract change checklist](how-to-contribute/workflow.md#contract-change-checklist) before pushing.

## Related

- [How to contribute](how-to-contribute/index.md)
- [By the numbers](by-the-numbers.md) — contributor stats
