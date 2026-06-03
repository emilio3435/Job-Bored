#!/usr/bin/env python3
"""
logo_resolver.py — populate resume logo marks, for any user.

The resume template references brand marks by filename:
    <img class="project-mark" src="assets/logo-<slug>.png" onerror="this.remove()">
and the drafter copies ``resume-template/assets/`` into each application folder.
That works for one hardcoded resume but breaks for open-source users, whose
employers and projects differ. This resolver makes the marks profile-driven
without changing the drafter: for each entry in a manifest it resolves
``assets/logo-<slug>.png`` in priority order:

  1. upload    — a user-supplied file (highest fidelity, always wins)
  2. favicon   — auto-fetched (Google s2) from the company's `domain`, or from
                 the company name alone (Clearbit autocomplete: name -> domain
                 -> favicon), so no domain or upload is required
  3. (omitted) — if nothing resolves, no file is written; the template's
                 <img onerror="this.remove()"> drops the mark cleanly, so a
                 missing logo never shows a broken-image icon.

Default behaviour is non-destructive: a slug whose target already exists is
left untouched (so curated marks are never clobbered). With --force the resolver
re-resolves every entry and deletes the stale file for any that no longer resolve.

Usage:
    python3 logo_resolver.py --template-dir resume-template
    python3 logo_resolver.py --template-dir resume-template --offline   # CI-safe
    python3 logo_resolver.py --template-dir resume-template --force      # re-resolve all

Manifest (resume-template/logos.json):
    {
      "logos": [
        {"slug": "audacy",  "label": "Audacy",          "domain": "audacy.com"},
        {"slug": "elio",    "label": "Elio",            "upload": "uploads/logo-elio.png"},
        {"slug": "jobbored","label": "JobBored",        "upload": "uploads/logo-jobbored.png"}
      ]
    }

No third-party dependencies — favicon fetching uses the standard library.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Source = Literal["upload", "favicon", "missing", "skipped"]

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
HTTP_TIMEOUT = 8
USER_AGENT = "JobBored-logo-resolver/1.0 (+https://github.com/emilio3435/Job-Bored)"

# Image magic numbers we accept as a real logo (favicon endpoints sometimes
# return HTML error pages with a 200, which we must reject).
_IMAGE_MAGIC = (
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"\xff\xd8\xff",        # JPEG
    b"GIF87a",
    b"GIF89a",
    b"\x00\x00\x01\x00",    # ICO
    b"RIFF",                # WEBP (RIFF....WEBP)
)


class ManifestError(Exception):
    """Raised when logos.json is missing, unparseable, or invalid."""


@dataclass(frozen=True)
class LogoEntry:
    slug: str
    label: str
    domain: str | None = None
    upload: str | None = None


@dataclass(frozen=True)
class ResolveResult:
    slug: str
    source: Source
    path: Path
    detail: str = ""


# --------------------------------------------------------------------------- #
# Pure helpers (unit-tested)
# --------------------------------------------------------------------------- #
def favicon_url(domain: str) -> str:
    """Google s2 favicon for a domain (Clearbit's logo API is sunset/DNS-dead)."""
    domain = domain.strip().lower().lstrip("@")
    return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"


def suggest_url(name: str) -> str:
    """Clearbit name autocomplete — turns a company name into a domain, no domain needed."""
    return "https://autocomplete.clearbit.com/v1/companies/suggest?query=" + urllib.parse.quote(
        name.strip()
    )


def parse_suggest(data: bytes) -> str | None:
    """Top hit's domain from a Clearbit autocomplete response, or None.

    Clearbit's `logo` field is dead (null), so we take the `domain` and resolve
    the favicon from it via Google s2.
    """
    try:
        hits = json.loads(data)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(hits, list) or not hits or not isinstance(hits[0], dict):
        return None
    domain = hits[0].get("domain")
    return domain if isinstance(domain, str) and domain else None


def looks_like_image(data: bytes) -> bool:
    if len(data) < 16:
        return False
    if data[8:12] == b"WEBP":  # RIFF....WEBP
        return True
    return any(data.startswith(magic) for magic in _IMAGE_MAGIC)


# --------------------------------------------------------------------------- #
# Manifest
# --------------------------------------------------------------------------- #
def load_manifest(path: Path) -> list[LogoEntry]:
    if not path.is_file():
        raise ManifestError(f"Manifest not found: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ManifestError(f"Invalid JSON in {path}: {exc}") from exc

    logos = raw.get("logos") if isinstance(raw, dict) else None
    if not isinstance(logos, list) or not logos:
        raise ManifestError("Manifest must contain a non-empty 'logos' array")

    entries: list[LogoEntry] = []
    seen: set[str] = set()
    for i, item in enumerate(logos):
        if not isinstance(item, dict):
            raise ManifestError(f"logos[{i}] must be an object")
        slug = str(item.get("slug", "")).strip()
        if not SLUG_RE.match(slug):
            raise ManifestError(f"logos[{i}] has invalid slug: {slug!r} (use kebab-case a-z0-9)")
        if slug in seen:
            raise ManifestError(f"Duplicate slug: {slug!r}")
        seen.add(slug)
        label = str(item.get("label", "")).strip() or slug
        domain = item.get("domain")
        upload = item.get("upload")
        entries.append(
            LogoEntry(
                slug=slug,
                label=label,
                domain=str(domain).strip() if domain else None,
                upload=str(upload).strip() if upload else None,
            )
        )
    return entries


# --------------------------------------------------------------------------- #
# Resolution
# --------------------------------------------------------------------------- #
def _fetch(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
            if resp.status != 200:
                return None
            data = resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None
    return data if looks_like_image(data) else None


def fetch_favicon(domain: str) -> bytes | None:
    """Fetch the site favicon via Google s2."""
    return _fetch(favicon_url(domain))


def fetch_logo_by_name(name: str) -> bytes | None:
    """Resolve a logo from just the company name: name -> domain -> favicon."""
    if not name.strip():
        return None
    req = urllib.request.Request(suggest_url(name), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
            if resp.status != 200:
                return None
            domain = parse_suggest(resp.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None
    return fetch_favicon(domain) if domain else None


def resolve_entry(
    entry: LogoEntry,
    template_dir: Path,
    *,
    offline: bool = False,
    force: bool = False,
) -> ResolveResult:
    assets_dir = template_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    target = assets_dir / f"logo-{entry.slug}.png"

    if target.exists() and target.stat().st_size > 0 and not force:
        return ResolveResult(entry.slug, "skipped", target, "already present")

    # 1. upload wins
    if entry.upload:
        upload_path = (template_dir / entry.upload).resolve()
        if upload_path.is_file() and upload_path.stat().st_size > 0:
            target.write_bytes(upload_path.read_bytes())
            return ResolveResult(entry.slug, "upload", target, str(entry.upload))

    # 2a. favicon by domain (when one is given)
    if entry.domain and not offline:
        data = fetch_favicon(entry.domain)
        if data:
            target.write_bytes(data)
            return ResolveResult(entry.slug, "favicon", target, entry.domain)

    # 2b. favicon by company name (Clearbit autocomplete) — no domain needed,
    #     so a bare name in the profile auto-resolves without any user upload.
    if not offline:
        data = fetch_logo_by_name(entry.label)
        if data:
            target.write_bytes(data)
            return ResolveResult(entry.slug, "favicon", target, f"name:{entry.label}")

    # 3. unavailable -> drop the mark. Remove any stale file so the template's
    #    <img onerror="this.remove()"> renders nothing (no broken-image icon).
    if target.exists():
        target.unlink()
    return ResolveResult(entry.slug, "missing", target, "no upload or favicon")


def resolve_all(
    template_dir: Path,
    manifest_path: Path | None = None,
    *,
    offline: bool = False,
    force: bool = False,
) -> list[ResolveResult]:
    manifest_path = manifest_path or (template_dir / "logos.json")
    entries = load_manifest(manifest_path)
    return [
        resolve_entry(e, template_dir, offline=offline, force=force) for e in entries
    ]


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resolve resume logo marks.")
    parser.add_argument(
        "--template-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "resume-template",
        help="Directory containing logos.json, assets/, and uploads/.",
    )
    parser.add_argument("--manifest", type=Path, default=None, help="Override manifest path.")
    parser.add_argument("--offline", action="store_true", help="Skip network; unresolved -> omitted.")
    parser.add_argument("--force", action="store_true", help="Re-resolve every mark; drop stale ones.")
    args = parser.parse_args(argv)

    try:
        results = resolve_all(
            args.template_dir, args.manifest, offline=args.offline, force=args.force
        )
    except ManifestError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    for r in results:
        marker = {"upload": "↑", "favicon": "🌐", "missing": "—", "skipped": "·"}[r.source]
        print(f"  {marker} {r.slug:<14} {r.source:<9} {r.detail}")
    counts = {s: sum(1 for r in results if r.source == s) for s in ("upload", "favicon", "missing", "skipped")}
    print(f"\n{len(results)} marks: " + ", ".join(f"{v} {k}" for k, v in counts.items() if v))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
