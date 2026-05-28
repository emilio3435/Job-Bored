#!/usr/bin/env python3
"""
Tiny read-only HTTP server that exposes the heartbeat directory.

Run on each machine that hosts agents (laptop, always-on box). Bind to
localhost; expose to the rest of the tailnet via `tailscale serve` or
a Tailscale-only firewall rule.

Endpoints:
  GET /                                → list of agent names (JSON)
  GET /agents/<name>.json              → that agent's heartbeat
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HEARTBEAT_DIR = Path(os.environ.get("AGENT_HEARTBEAT_DIR", str(Path.home() / ".agents")))
PORT = int(os.environ.get("HEARTBEAT_PORT", "9999"))
BIND = os.environ.get("HEARTBEAT_BIND", "127.0.0.1")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/" or self.path == "/agents":
            names = sorted(p.stem for p in HEARTBEAT_DIR.glob("*.json"))
            self._send_json(200, {"agents": names})
            return
        if self.path.startswith("/agents/") and self.path.endswith(".json"):
            name = self.path[len("/agents/"):-len(".json")]
            target = HEARTBEAT_DIR / f"{name}.json"
            if not target.exists() or "/" in name or ".." in name:
                self._send_json(404, {"error": "not found"})
                return
            try:
                self._send_json(200, json.loads(target.read_text()))
            except json.JSONDecodeError as e:
                self._send_json(500, {"error": f"bad json: {e}"})
            return
        self._send_json(404, {"error": "not found"})

    def _send_json(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):  # noqa: A002
        # Quiet by default; redirect to stderr via env if you want logs.
        if os.environ.get("HEARTBEAT_VERBOSE"):
            sys.stderr.write(f"[heartbeat] {self.address_string()} {format % args}\n")


def main():
    HEARTBEAT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[heartbeat] serving {HEARTBEAT_DIR} on {BIND}:{PORT}")
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
