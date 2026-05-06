#!/usr/bin/env node
// Owner: Backend Worker A
// Purpose: Auto-create a Google OAuth Client ID for the dashboard via the
// gcloud CLI on the user's own Google project. Free for the user; $0 to the
// maintainer.
//
// Locked contract — see dev-server.mjs handleOAuthBootstrap header.
//
// Implementation notes for the worker:
//   - Detect gcloud via spawnSync("gcloud","--version").
//   - Check auth via "gcloud auth list --format=json".
//   - Required APIs: iam.googleapis.com, oauth2.googleapis.com.
//   - Use "gcloud iap oauth-clients create" or the OAuth brand+client APIs.
//   - Never run "gcloud auth login" non-interactively. Return
//     { ok:false, reason:"not_logged_in" } and let the user run it themselves.
//   - Output must be valid JSON to stdout for the dev-server handler.
//   - Localhost / dev-server gating happens at the HTTP layer, not here.

throw new Error("oauth-bootstrap not implemented yet (swarm Phase 1)");
