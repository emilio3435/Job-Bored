# Discovery Local Hermes QA Checklist

Use this checklist for the localhost-first path where the real discovery
engine runs on the user's machine and ngrok is only the public tunnel.

## Goal

Verify that a new localhost user can finish discovery setup without manually
pasting the local webhook URL once the bootstrap helper has run.

Expected final roles:

- local webhook = real engine
- ngrok URL = public tunnel
- Cloudflare Worker URL = browser-facing URL saved in JobBored

## Setup

- Start from a clean browser profile on `http://localhost`.
- Use a repo checkout that has `npm` dependencies installed.
- Make sure Hermes/OpenClaw or another local receiver is available on the machine.

## Happy path

### 1. Bootstrap the local receiver

Run:

```bash
npm run discovery:bootstrap-local
```

Expected:

- The helper prints or writes the local webhook URL.
- The helper reports the `/health` URL.
- The helper reports the ngrok public URL when ngrok is available.
- The helper writes `discovery-local-bootstrap.json` for localhost autofill.

### 2. Open the wizard

Open Command Center on `http://localhost` and enter the discovery wizard.

Expected:

- The wizard autofills the local webhook URL from the bootstrap file.
- The wizard shows the `/health` URL without asking the user to reconstruct it.
- The wizard autofills the ngrok URL if the local API already has a tunnel.
- The wizard suggests the Worker deploy command instead of making the user infer it.

### 3. Confirm local health

Expected:

- A healthy `/health` response marks the local engine as ready.
- If the gateway is down, the wizard shows a specific fix, not a generic failure.
- If the local receiver URL is malformed, the wizard rejects it as invalid.

### 4. Confirm ngrok

Expected:

- If ngrok is already running, the wizard picks up the public URL from the local API.
- If ngrok auth is missing, the wizard explains that it is a one-time setup.
- If ngrok is not running, the wizard tells the user exactly what command to run next.

### 5. Deploy the browser-facing Worker

Expected:

- The generated Cloudflare command uses the ngrok public target, not the localhost URL.
- The final saved `Discovery webhook URL` is the open Worker URL, not `/forward`.
- Cloudflare Access stays off for that open Worker URL.

### 6. Verify and run

Expected:

- `Test webhook` accepts direct `ok: true` responses.
- `Test webhook` accepts async `202 Accepted` responses.
- `Run discovery` uses the same verifier semantics as `Test webhook`.
- The wizard can summarize the setup as:
  - real engine
  - public tunnel
  - browser URL

## Failure cases to check

- Missing bootstrap file
- Local gateway down
- ngrok auth missing
- ngrok not running
- Cloudflare Access accidentally enabled on the Worker URL
- Worker `/forward` pasted into Settings
- localhost URL pasted as the final browser endpoint
- Apps Script stub labeled as ready

## Pass criteria

This path passes when:

- the local webhook is autofilled on localhost,
- the wizard does not require the user to paste localhost or ngrok URLs by hand once bootstrap has run,
- `Test webhook` and `Run discovery` share the same async-aware success model,
- the user ends with a browser-facing Worker URL and a real local engine behind it.
