#!/usr/bin/env python3
"""
One-time helper: turn a Strava authorisation code into a refresh token.

    python scripts/authorize_strava.py

Needs STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in the environment or in a
.env file at the repo root. Your Strava API application must have its
"Authorization Callback Domain" set to `localhost`.

The refresh token it writes to .env never expires; from then on the ledger can
refresh itself without another consent screen.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8721
REDIRECT = f"http://localhost:{PORT}/exchange"
SCOPE = "read,activity:read_all"
TOKEN_URL = "https://www.strava.com/oauth/token"


def load_dotenv(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"Missing {name}. Add it to .env first.")
    return value


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/exchange":
            self.send_response(404)
            self.end_headers()
            return

        params = urllib.parse.parse_qs(parsed.query)
        code = (params.get("code") or [""])[0]
        error = (params.get("error") or [""])[0]

        if error or not code:
            self._page("<h1>Authorisation failed</h1>"
                       f"<p>{error or 'No code returned.'}</p>", 400)
            self.server.result = {"error": error or "no code"}
            return

        try:
            token = exchange(code)
        except Exception as exc:  # noqa: BLE001 - surfaced to the user
            self._page(f"<h1>Token exchange failed</h1><p>{exc}</p>", 500)
            self.server.result = {"error": str(exc)}
            return

        self._page("<h1>Done</h1><p>You can close this tab and return to "
                   "the terminal.</p>", 200)
        self.server.result = token

    def _page(self, body: str, status: int) -> None:
        html = (f"<!doctype html><meta charset=utf-8>"
                f"<body style='font:16px/1.5 system-ui;max-width:34rem;"
                f"margin:4rem auto;padding:0 1rem;color:#222'>{body}</body>")
        payload = html.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # quiet
        pass


def exchange(code: str) -> dict:
    payload = urllib.parse.urlencode({
        "client_id": env("STRAVA_CLIENT_ID"),
        "client_secret": env("STRAVA_CLIENT_SECRET"),
        "code": code,
        "grant_type": "authorization_code",
    }).encode()

    req = urllib.request.Request(
        TOKEN_URL, data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main() -> None:
    load_dotenv()

    state = secrets.token_urlsafe(16)
    url = "https://www.strava.com/oauth/authorize?" + urllib.parse.urlencode({
        "client_id": env("STRAVA_CLIENT_ID"),
        "response_type": "code",
        "redirect_uri": REDIRECT,
        "approval_prompt": "force",
        "scope": SCOPE,
        "state": state,
    })

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    server.result = None  # type: ignore[attr-defined]

    print("\nOpening Strava so you can authorise this application.")
    print("If nothing happens, paste this into your browser:\n")
    print(url, "\n")
    webbrowser.open(url)

    print(f"Waiting for the redirect on {REDIRECT} ...")
    server.handle_request()

    result = server.result or {}
    if "refresh_token" not in result:
        sys.exit(f"\nNo refresh token. {result.get('error', 'Unknown error')}")

    token = result["refresh_token"]
    env_path = ROOT / ".env"
    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    if "STRAVA_REFRESH_TOKEN" not in text:
        with env_path.open("a", encoding="utf-8") as fh:
            if text and not text.endswith("\n"):
                fh.write("\n")
            fh.write(f"STRAVA_REFRESH_TOKEN={token}\n")

    print(f"\nAuthorised. Refresh token written to {env_path}")
    print("Next: python scripts/update_strava.py")


if __name__ == "__main__":
    main()
