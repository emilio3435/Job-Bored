# Browser Use Discovery Worker QA

This worker is user-owned. The QA path below checks the local prerequisites, the
localhost `/health` surface, and the browser-facing async-success contract
without assuming a maintainer-hosted backend.

## What this QA pack covers

- Local worker startup and `/health`
- `npm run discovery:bootstrap-local`
- ngrok tunnel detection and browser-facing relay handoff
- discovery request shape v1
- `202 Accepted` as a valid async success path

## What you need

- Node.js 24 or newer
- `npm`
- A local receiver such as Hermes or OpenClaw if you are testing the localhost
  worker path
- `ngrok` if you want the browser-facing relay workflow
- A Google Sheet and worker credentials when you move beyond the seam tests

## Local QA flow

1. Bootstrap the local receiver:

```bash
npm run discovery:bootstrap-local
```

Expected:
- a local webhook URL on `127.0.0.1`
- a `/health` URL on the same port
- an ngrok public URL when ngrok is already running or configured
- a generated `discovery-local-bootstrap.json` file for localhost autofill

2. Start the worker process and confirm `/health`:

```bash
cd integrations/browser-use-discovery
npm start
```

Expected:
- `GET /health` returns `200`
- the body reports `status: ok`
- CORS headers are present for the configured dashboard origin

3. Verify the browser-facing relay path:

- Keep the local webhook URL as the real engine target.
- Keep the ngrok URL as the public tunnel only.
- If you use Cloudflare, save the open `workers.dev` URL in JobBored, not the
  `/forward` helper or any localhost URL.
- Save the Cloudflare Worker URL, not the raw localhost or ngrok URL, into
  JobBored `Discovery webhook URL`.

4. Validate the async contract:

- `POST` requests with `event = command-center.discovery` and
  `schemaVersion = 1` should be accepted with `200` or `202`.
- `202 Accepted` is a success path, not a failure.
- `variationKey` must flow through every run so repeated requests can vary.

## Seam tests you can run now

Run the local e2e tests from the worker package:

```bash
cd integrations/browser-use-discovery
node --experimental-strip-types --test tests/e2e/*.test.ts
```

These tests validate:
- the mock local health endpoint
- the local bootstrap fixture shape
- the async acknowledgement fixture
- the worker prerequisites documented in `.env.example`

## Operator checklist

- Never save a localhost URL as the final browser-facing endpoint.
- Never save the raw ngrok tunnel URL as the final browser-facing endpoint.
- Keep the local webhook and public relay roles separate.
- Treat the bootstrap file as a localhost convenience layer, not as the final
  browser URL.
- If the worker returns `202 Accepted`, treat that as a valid async success.

## Failure states to check

- Missing bootstrap file
- Local receiver not running
- ngrok not authenticated
- ngrok not running
- Cloudflare relay points at the wrong downstream URL
- Discovery webhook URL is still a localhost or ngrok URL
- Response returns a stub-only signal when the operator expected a real engine
