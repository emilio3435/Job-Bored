#!/usr/bin/env node
// Owner: Backend Worker A
// Purpose: One-shot health check for greenfield install. Detects gcloud,
// wrangler, ngrok, and node. Returns the locked install-doctor JSON shape.
//
// Locked contract — see dev-server.mjs handleInstallDoctor header.
//
// Implementation notes:
//   - Use spawnSync with --version flags; ignore non-zero exit codes
//     gracefully (treat as "not installed").
//   - "loggedIn" detection:
//       gcloud:    "gcloud auth list --format=json" -> any active account
//       wrangler:  "wrangler whoami" -> exit 0 means logged in
//       ngrok:     check ~/.config/ngrok/ngrok.yml or
//                  "ngrok config check" exit 0 means token present
//   - "missing" array contains human-readable next steps in priority order.
//   - This file is meant to be runnable standalone (CLI) AND importable as
//     a function for the dev-server handler.

throw new Error("install-doctor not implemented yet (swarm Phase 1)");
