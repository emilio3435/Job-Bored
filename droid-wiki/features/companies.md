# Companies tab

Aggregated per-company view of the Pipeline: row counts by stage, last activity, average fit score, optional cap (max-applications-per-company gate).

## Modules

| File | Role |
| --- | --- |
| `companies-tab.js` | Tab renderer + filters |
| `company-cap.js` | Cap rule UI + helpers |
| `tests/companies-tab.test.mjs` | Tab rendering |
| `tests/company-cap.test.mjs` | Cap rules |

The tab is built from the same `flowing-store` rows that feed the Pipeline. No extra fetch.

## Related

- [Pipeline](pipeline.md)
- [Daily Brief](daily-brief.md)
