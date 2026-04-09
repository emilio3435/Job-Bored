# Command Center + OpenClaw (or Hermes)

This folder is a **drop-in skill** for [OpenClaw](https://docs.openclaw.ai/tools/creating-skills): copy `SKILL.md` into `~/.openclaw/workspace/skills/command-center/` (or your workspace `skills/` path), restart the gateway, then `openclaw skills list`.

**Cost to you as the maintainer:** **none.** Users bring:

- Their **Google Sheet** (copy of the template)
- Their **OAuth client** (or service account) for Sheets API
- **Optional:** their own **HTTPS webhook** URL for the dashboard’s **Run discovery** button

There is **no** Command Center backend to host or pay for.

## Hermes

Hermes does not use the same file layout as OpenClaw; treat **`SKILL.md`** as the **instruction pack** — add it to Hermes’s context or repo as a skill/prompt so the agent follows `AGENT_CONTRACT.md` and the column map.

## Ship to users

1. **Ship the repo** (or this `integrations/` subtree) as MIT.
2. **Document** in your main README: “Install OpenClaw skill from `integrations/openclaw-command-center/`” + link to `AGENT_CONTRACT.md`.
3. **Optional:** publish the skill on [ClawHub](https://clawhub.ai/) so users can install by name.

## Verify

- [ ] `AGENT_CONTRACT.md` matches your fork’s column layout.
- [ ] `discoveryWebhookUrl` in `config.js` points to **the user’s** endpoint, not yours.
