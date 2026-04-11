# Refactoring Guardrails

Patterns, guidance, and validation strategies established during the dirty-baseline mission.

**What belongs here:** refactoring conventions, validation wiring patterns, isolated-worktree strategies, and guardrail documentation discovered during the mission.  
**What does NOT belong here:** service start/stop commands (use `.factory/services.yaml`).

---

## Dirty-Baseline Preservation

### Mission Context

This mission deliberately started with an intentionally dirty baseline (many uncommitted changes representing work-in-progress across multiple areas). This required explicit patterns for:

1. **Producing atomic worker commits** when the baseline is dirty
2. **Running isolated validation** without relying on untracked files from the dirty baseline
3. **Handling validation gaps** when synthesis artifacts are missing

### Producing Atomic Commits on Dirty Baseline

When the mission baseline starts intentionally dirty:

1. **Checkpoint first**: Create a checkpoint branch from the current baseline before execution begins.
   ```bash
   git checkout -b checkpoint/milestone-name
   ```

2. **Stage surgically**: Use `git add -p` to stage only the specific changes needed for the current feature.
   ```bash
   git add -p  # Interactively select hunks
   git status  # Verify only intended files are staged
   ```

3. **Commit with clear scope**:
   ```bash
   git commit -m "refactor(<scope>): <what changed>"
   ```

4. **Preserve dirty baseline for other workers**: Do NOT clean up unrelated uncommitted changes — they belong to other workers or represent the intentional baseline state.

### Residual Baseline Untracked Artifacts

The mission generated untracked validation artifacts that must be reconciled:

#### Mission-Required (Keep Tracked or Documented)

These artifacts represent validation evidence and should be committed or explicitly ignored with rationale:

| Artifact Pattern | Rationale | Reconciliation |
|-----------------|-----------|---------------|
| `.factory/validation/*/user-testing/flows/*.json` | User-testing flow reports | Commit to repo — they are validation evidence |
| `.factory/validation/*/scrutiny/reviews/*.json` | Scrutiny review artifacts | Commit to repo — they are validation evidence |
| `evidence/*/` | Browser screenshots and captured evidence | Commit to repo — they are validation artifacts |
| `tests/settings-sheet-id-validation.test.mjs` | Test file | Commit — it extends test coverage |

#### Removable (Can Be Cleaned)

These artifacts can be removed if they accumulate unnecessarily:
- Intermediate build artifacts
- Temporary validation dumps that have been superseded

### Reconciliation Strategy

1. **For validation artifacts**: Commit them — they represent evidence of milestone completion
2. **For evidence directories**: Commit screenshots and captured data — they support the validation contract
3. **For temporary files**: Remove if they are not referenced by any validation synthesis

---

## Isolated Worktree Validation

When running validation in an isolated worktree (clean checkout without dirty baseline files):

### Bootstrap Path for Discovery Worker Validation

The discovery worker validation requires `integrations/browser-use-discovery/state/worker-config.json`:

```bash
# From a clean worktree, before running test:browser-use-discovery:
# The file is checked in — bootstrap is automatic for clean worktrees
```

If the worker-config.json is missing:
1. Copy from a source that has it
2. Ensure it points to the disposable validation sheet
3. Do NOT swap in production identifiers

### Key Files for Isolated Validation

| File | Required For | Notes |
|------|--------------|-------|
| `integrations/browser-use-discovery/state/worker-config.json` | test:browser-use-discovery | Checked-in seed config |
| `evidence/seed-pipeline-data.json` | Dashboard/board assertions | Checked-in fixture |
| `discovery-local-bootstrap.json` | Local discovery bootstrap | Checked-in bootstrap data |

### Running Discovery Validation in Clean Worktree

```bash
# 1. Install dependencies
sh .factory/init.sh

# 2. Start required services
npm run start:scraper  # For ATS/scraper validation
npm run start:discovery-worker  # For discovery worker validation

# 3. Run the validation
npm run test:browser-use-discovery
```

---

## Temporary Verification-Port Fallback

When canonical mission ports are occupied by other active sessions:

### Mission Port Allocations

| Service | Canonical Port | Purpose |
|---------|---------------|---------|
| Dashboard/dev server | 8080 | Dashboard browser surface |
| Local scraper/ATS | 3847 | ATS and scraper validation |
| Discovery worker | 8644 | Discovery worker surface |
| ngrok tunnel | 4040 | Local tunnel inspection |

### Detecting Port Conflicts

Before starting a service, check if the port is available:

```bash
# Check if port is in use
lsof -ti tcp:8080 >/dev/null && echo "Port 8080 in use" || echo "Port 8080 free"
```

### Starting Temporary Service on Fallback Port

When canonical ports are occupied:

1. **Dashboard fallback**:
   ```bash
   PORT=8081 npm run start:dev
   # Then use http://localhost:8081 for validation
   ```

2. **Scraper fallback**:
   ```bash
   SCRAPER_PORT=3848 npm run start:scraper
   # Then configure app to use localhost:3848 for scraper
   ```

3. **Discovery worker fallback**:
   ```bash
   DISCOVERY_PORT=8645 node --experimental-strip-types integrations/browser-use-discovery/src/server.ts
   # Then configure app to use localhost:8645
   ```

### Provenance Checks for Temporary Services

When using a temporary verification port:

1. **Verify the service is from the active worktree**:
   - Check that the process was started from the current repo checkout
   - Use `lsof -i :<port>` to identify the process
   - Confirm the working directory matches the active worktree

2. **Document the fallback**:
   - Record which port was used
   - Note why canonical port ownership was unsafe to reuse
   - Include this in the validation report

3. **Clean up after validation**:
   - Stop the temporary service when done
   - Do NOT leave services running on non-standard ports

### Example: Temporary Port for Dashboard Validation

```bash
# Start temporary dashboard on port 8081
PORT=8081 node dev-server.mjs &
TEMP_PID=$!

# Verify provenance
lsof -i :8081 | grep $TEMP_PID

# Run validation
npm run test:contract:all

# Stop when done
kill $TEMP_PID
```

---

## Missing User-Testing Synthesis Artifacts

When a prior user-testing synthesis artifact is missing:

### Rerun Selector Behavior

The rerun selector determines which assertions still need verification based on:
1. The latest available synthesis
2. Feature completion status
3. Prior validation evidence

### Handling Missing Synthesis

1. **Do not block on missing synthesis**: Continue with feature work using available evidence.
2. **Update mission-directory state outside the repo**: Synthesis artifacts belong to `.factory/validation/`, not committed to the repo.
3. **Use the latest available synthesis**: If `synthesis-round3.json` exists but `synthesis-round4.json` is missing, use round 3 as the baseline.
4. **Document the gap**: Note the missing artifact in the handoff.

### Mission-Directory State Updates

When mission-directory state must be updated outside the repo commit:

1. **Synthesis files go to**: `.factory/validation/<milestone>/user-testing/synthesis-<round>.json`
2. **Flow reports go to**: `.factory/validation/<milestone>/user-testing/flows/<flow-id>.json`
3. **Evidence goes to**: `evidence/<milestone>/`

These are validation outputs, not source code. They should be committed when stable but may remain untracked during active validation rounds.

---

## Integration-Style Apps Script Classification Check

The Apps Script stub classification wiring must be validated against runtime behavior, not only helper-logic copies.

### Validation Pattern

To catch regressions in Apps Script classification:

1. **Exercise the real classification wiring**: Test against the actual browser-side verification flow, not isolated helper copies.
2. **Cover both managed and non-managed paths**:
   - Managed Apps Script stub → should classify as `stub_only`
   - Non-managed Apps Script URL → should NOT classify as `stub_only`
   - Worker URL → should NOT classify as `stub_only`
   - Generic HTTPS → should NOT classify as `stub_only`

### Runtime Classification Check

The classification check exercises `handleAppsScriptBrowserCorsFailure` and `isManagedAppsScriptDeployState` against the actual browser verification code path:

```bash
# Test against real browser classification (requires browser validation)
# 1. Open browser with discovery settings
# 2. Enter a managed Apps Script stub URL
# 3. Click "Test webhook"
# 4. Verify: result shows "stub_only" with warning semantics
```

### Guardrail: Stub Classification Must Not Misclassify

**Critical regression to prevent**: Non-managed Apps Script URLs must NOT be classified as `stub_only` when they fail with CORS/network errors.

The fix (commit cd2f886) ensured `handleAppsScriptBrowserCorsFailure` requires `isManagedAppsScriptDeployState === true` before classifying as `stub_only`.

---

## Validation Concurrency for Guardrail Features

When running multiple validation streams:

- **Max concurrent dashboard validators**: 2
- **Max concurrent scraper/ATS validators**: 1
- **Max concurrent discovery validators**: 1

See `.factory/library/user-testing.md` for full concurrency guidance.

---

## Commit Message Conventions

Use the format established by the mission:

```
refactor(<scope>): <what changed>
```

Examples:
- `refactor(style.css): prune legacy list-card selectors`
- `refactor(frontend): remove dead legacy card-list rendering path`
- `refactor(validation): rerun security-config user testing`
- `refactor(discovery): defer cold-start setup handoffs`

**Rules:**
- One concern per commit
- Scope is the directory or module affected
- Use present tense ("prune" not "pruned")
- Be specific about what changed
