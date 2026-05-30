# Features

Product capabilities that span more than one app. Each feature page explains the surface, the modules, and the data path end-to-end. Pages are kept short because most depth lives in the [Apps](../apps/index.md) lens.

| Feature | Pages |
| --- | --- |
| [Pipeline & Dossier](pipeline.md) | Cards, kanban, sticker board, Dossier expand, write-back |
| [Daily Brief](daily-brief.md) | Dawn renderer, view-models, follow-up logic |
| [Discovery](discovery.md) | Run discovery button, async polling, drawer wizard |
| [Materials](materials.md) | Hermes resume/cover-letter, materials queue, Dossier materials tab |
| [ATS scorecard](ats-scorecard.md) | Scorecard request, schema, retry, modal |
| [Settings](settings.md) | Tabs, BYO keys, IDs, profile, v2 toggle |
| [Onboarding](onboarding.md) | Welcome state machine, setup doctor |
| [Runs log](runs.md) | DiscoveryRuns tab, History renderer |
| [Companies](companies.md) | Companies tab, per-company stats |
| [Schedule / automation](schedule.md) | launchd / systemd / Task Scheduler, GitHub Actions schedule |
| [Expired-job cleanup](cleanup.md) | Cleanup endpoint, opt-in columns |

## Where features live

Most of `apps/dashboard` (`app.js`) plus matching modules implements these features. Discovery + materials + cleanup also touch the discovery worker, the scraper server, or Hermes. See per-feature pages for the exact files.
