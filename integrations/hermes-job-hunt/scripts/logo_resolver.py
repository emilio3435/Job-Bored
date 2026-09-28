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
  2. site      — the company's own logo, read from its home page: the
                 schema.org Organization logo, an SVG icon, the
                 apple-touch-icon, the largest declared icon, an og:image
                 whose URL says "logo", then /apple-touch-icon.png. A
                 candidate must be a real image, big enough to print
                 (>= 96px on its short side, or a >= 200px-wide wordmark),
                 and not white-on-transparent (it would vanish on paper).
                 When the page declares nothing printable, the company's
                 Wikidata logo (P154) is used, but only from an entity whose
                 official website (P856) is the same domain.
  3. favicon  — Google s2 for the domain, the low-resolution last resort.
  The domain is the entry's `domain`, or the company name alone resolved
  through Clearbit autocomplete (name -> domain), so no domain or upload is
  required.
  4. (omitted) — if nothing resolves, no file is written; the materials
                 renderer draws a monogram in its place, so a missing logo
                 never shows a broken-image icon and a render never needs
                 the network.

Default behaviour is non-destructive: a slug whose target already exists is
left untouched (so curated marks are never clobbered). With --force the resolver
re-resolves every entry and deletes the stale file for any that no longer resolve.

Usage:
    python3 logo_resolver.py --template-dir resume-template
    python3 logo_resolver.py --template-dir resume-template --offline   # CI-safe
    python3 logo_resolver.py --template-dir resume-template --force      # re-resolve all
    python3 logo_resolver.py --template-dir ~/.jobbored/logos/targets \
        --slug northwindmedia --label "NorthwindMedia, Inc."                      # one mark, no manifest

Manifest (resume-template/logos.json):
    {
      "logos": [
        {"slug": "audacy",  "label": "Audacy",          "domain": "audacy.com"},
        {"slug": "elio",    "label": "Elio",            "upload": "uploads/logo-elio.png"},
        {"slug": "jobbored","label": "JobBored",        "upload": "uploads/logo-jobbored.png"}
      ]
    }

No third-party dependencies: fetching and parsing use the standard library.
Pillow, when importable, adds the white-on-transparent check.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Literal

Source = Literal["upload", "site", "favicon", "missing", "skipped"]

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
HTTP_TIMEOUT = 8
USER_AGENT = "JobBored-logo-resolver/1.0 (+https://github.com/emilio3435/Job-Bored)"
# Company home pages often refuse unknown agents, so the page fetch presents
# as a browser. Only public home pages and the images they declare are read.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 JobBored-logo-resolver/1.1"
)
MAX_PAGE_BYTES = 1_500_000
MAX_LOGO_BYTES = 1_000_000
MIN_MARK_PX = 96
MIN_WORDMARK_WIDTH_PX = 200

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


def is_svg(data: bytes) -> bool:
    head = data[:4096].lstrip()
    if head.startswith(b"\xef\xbb\xbf"):
        head = head[3:].lstrip()
    lower = head.lower()
    if lower.startswith((b"<?xml", b"<!--", b"<!doctype svg")):
        return b"<svg" in lower
    return lower.startswith(b"<svg")


def looks_like_image(data: bytes) -> bool:
    if len(data) < 16:
        return False
    if data[8:12] == b"WEBP":  # RIFF....WEBP
        return True
    if is_svg(data):
        return True
    return any(data.startswith(magic) for magic in _IMAGE_MAGIC)


def image_size(data: bytes) -> tuple[int, int] | None:
    """Pixel size of a PNG, GIF, WebP, ICO (largest entry) or JPEG; None if unknown."""
    try:
        if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
            w, h = struct.unpack(">II", data[16:24])
            return (w, h)
        if data[:6] in (b"GIF87a", b"GIF89a"):
            w, h = struct.unpack("<HH", data[6:10])
            return (w, h)
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            chunk = data[12:16]
            if chunk == b"VP8X":
                return (1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little"))
            if chunk == b"VP8 ":
                w, h = struct.unpack("<HH", data[26:30])
                return (w & 0x3FFF, h & 0x3FFF)
            if chunk == b"VP8L":
                bits = int.from_bytes(data[21:25], "little")
                return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
        if data.startswith(b"\x00\x00\x01\x00"):
            count = struct.unpack("<H", data[4:6])[0]
            best = (0, 0)
            for i in range(count):
                size = (data[6 + 16 * i] or 256, data[7 + 16 * i] or 256)
                if size[0] * size[1] > best[0] * best[1]:
                    best = size
            return best if best[0] else None
        if data.startswith(b"\xff\xd8"):
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                    return (w, h)
                i += 2 + struct.unpack(">H", data[i + 2 : i + 4])[0]
    except (struct.error, IndexError):
        return None
    return None


def mostly_white(data: bytes) -> bool:
    """True when the visible pixels are nearly all white: a logo made for a
    dark header, which would vanish on a white page. False without Pillow."""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return False
    try:
        img = Image.open(BytesIO(data)).convert("RGBA")
        img.thumbnail((64, 64))
        pixels = [p for p in img.getdata() if p[3] > 32]
    except Exception:  # noqa: BLE001 - an unreadable image is not "white"
        return False
    if not pixels:
        return True
    light = sum(1 for r, g, b, _ in pixels if 0.299 * r + 0.587 * g + 0.114 * b > 235)
    return light / len(pixels) > 0.9


def printable_logo(data: bytes) -> bool:
    """A logo worth printing: a real image, big enough, and not all white."""
    if not looks_like_image(data) or len(data) > MAX_LOGO_BYTES:
        return False
    if is_svg(data):
        return b"<script" not in data.lower()
    size = image_size(data)
    if not size:
        return False
    w, h = size
    big_mark = min(w, h) >= MIN_MARK_PX
    wordmark = w / max(h, 1) >= 1.8 and w >= MIN_WORDMARK_WIDTH_PX
    return (big_mark or wordmark) and not mostly_white(data)


class _HeadParser(HTMLParser):
    """Collects <link>, <meta> and JSON-LD <script> contents from a page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict[str, str]] = []
        self.metas: list[dict[str, str]] = []
        self.jsonld: list[str] = []
        self._in_jsonld = False
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "link":
            self.links.append(a)
        elif tag == "meta":
            self.metas.append(a)
        elif tag == "script" and "ld+json" in a.get("type", "").lower():
            self._in_jsonld = True
            self._buf = []

    def handle_endtag(self, tag):  # noqa: ANN001
        if tag == "script" and self._in_jsonld:
            self.jsonld.append("".join(self._buf))
            self._in_jsonld = False

    def handle_data(self, data):  # noqa: ANN001
        if self._in_jsonld:
            self._buf.append(data)


_LOGO_OWNER_TYPES = ("Organization", "Corporation", "Brand", "WebSite")


def _jsonld_logos(blob: str) -> list[str]:
    try:
        data = json.loads(blob)
    except (json.JSONDecodeError, ValueError):
        return []
    found: list[str] = []

    def walk(node) -> None:  # noqa: ANN001
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            kind = node.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            logo = node.get("logo")
            owner = any(isinstance(k, str) and any(t in k for t in _LOGO_OWNER_TYPES) for k in kinds)
            if logo and owner:
                if isinstance(logo, str):
                    found.append(logo)
                elif isinstance(logo, dict):
                    url = logo.get("url") or logo.get("contentUrl")
                    if isinstance(url, str):
                        found.append(url)
            for value in node.values():
                if isinstance(value, (dict, list)):
                    walk(value)

    walk(data)
    return found


def _largest(sizes: str) -> int:
    best = 0
    for token in sizes.lower().split():
        if token == "any":
            return 10_000
        m = re.match(r"(\d+)x(\d+)", token)
        if m:
            best = max(best, min(int(m.group(1)), int(m.group(2))))
    return best


def logo_candidates(html: str, base_url: str) -> list[str]:
    """Logo URLs a home page declares, best first, absolute and de-duplicated:
    schema.org logo, SVG icon, apple-touch-icon, the largest raster icon, an
    og:image that says "logo", then the conventional /apple-touch-icon.png."""
    parser = _HeadParser()
    try:
        parser.feed(html)
    except Exception:  # noqa: BLE001 - malformed markup still yields what parsed
        pass
    ordered: list[str] = []
    for blob in parser.jsonld:
        ordered += _jsonld_logos(blob)
    vector: list[str] = []
    touch: list[tuple[int, str]] = []
    raster: list[tuple[int, str]] = []
    for link in parser.links:
        rel = link.get("rel", "").lower().split()
        href = link.get("href", "").strip()
        if not href or "mask-icon" in rel:
            continue  # Safari's pinned-tab mask is one flat colour
        if "apple-touch-icon" in rel or "apple-touch-icon-precomposed" in rel:
            touch.append((_largest(link.get("sizes", "")) or 180, href))
        elif "icon" in rel:
            if link.get("type", "").lower() == "image/svg+xml" or href.lower().split("?")[0].endswith(".svg"):
                vector.append(href)
            else:
                raster.append((_largest(link.get("sizes", "")), href))
    ordered += vector
    ordered += [h for _, h in sorted(touch, key=lambda x: -x[0])]
    ordered += [h for size, h in sorted(raster, key=lambda x: -x[0]) if size >= MIN_MARK_PX]
    for meta in parser.metas:
        prop = (meta.get("property") or meta.get("name") or "").lower()
        content = meta.get("content", "").strip()
        if content and (prop == "og:logo" or (prop in ("og:image", "twitter:image") and "logo" in content.lower())):
            ordered.append(content)
    ordered.append("/apple-touch-icon.png")
    seen: set[str] = set()
    out: list[str] = []
    for href in ordered:
        if href.startswith("data:"):
            continue
        url = urllib.parse.urljoin(base_url, href)
        if url.startswith(("http://", "https://")) and url not in seen:
            seen.add(url)
            out.append(url)
    return out


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


def _fetch_raw(url: str, limit: int) -> tuple[bytes, str] | None:
    req = urllib.request.Request(
        url, headers={"User-Agent": BROWSER_UA, "Accept": "text/html,image/*;q=0.9,*/*;q=0.5"}
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
            if resp.status != 200:
                return None
            return resp.read(limit + 1), resp.geturl()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return None


def fetch_site_logo(domain: str) -> tuple[bytes, str] | None:
    """The best printable logo a company's home page declares, with its URL."""
    domain = domain.strip().lower().lstrip("@")
    for home in (f"https://{domain}/", f"https://www.{domain}/"):
        page = _fetch_raw(home, MAX_PAGE_BYTES)
        if not page:
            continue
        body, final = page
        html = body[:MAX_PAGE_BYTES].decode("utf-8", errors="replace")
        for url in logo_candidates(html, final)[:8]:
            got = _fetch_raw(url, MAX_LOGO_BYTES)
            if got and len(got[0]) <= MAX_LOGO_BYTES and printable_logo(got[0]):
                return got[0], url
        return None
    return None


def _site_key(host: str) -> str:
    """The registrable part of a host, naively: the last two labels."""
    host = host.strip().lower().split("/")[0].split(":")[0]
    return ".".join(host.split(".")[-2:])


def wikidata_logo_file(entities: dict, ids: list[str], domain: str) -> str | None:
    """The Commons file name of the first entity (in search order) whose
    official website (P856) is on `domain` and that has a logo image (P154).
    The website check is what keeps a same-named company's logo out."""
    want = _site_key(domain)
    for qid in ids:
        claims = (entities.get(qid) or {}).get("claims") or {}

        def values(prop: str) -> list[str]:
            out = []
            for claim in claims.get(prop) or []:
                value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
                if isinstance(value, str):
                    out.append(value)
            return out

        sites = [urllib.parse.urlparse(u).hostname or "" for u in values("P856")]
        if not any(_site_key(h) == want for h in sites if h):
            continue
        current = _current_logo(claims.get("P154") or [])
        if current:
            return current
    return None


def _current_logo(claims: list) -> str | None:
    """A company's current logo among its P154 claims: a preferred-rank
    claim, else one with no end time (P582), else the last listed. The
    first-listed claim is often a retired logo (NorthwindMedia's is Clear
    Channel's)."""
    live = []
    for claim in claims:
        value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if not isinstance(value, str) or claim.get("rank") == "deprecated":
            continue
        ended = bool((claim.get("qualifiers") or {}).get("P582"))
        live.append((claim.get("rank") == "preferred", not ended, value))
    if not live:
        return None
    for preferred, _, value in live:
        if preferred:
            return value
    for _, open_ended, value in reversed(live):
        if open_ended:
            return value
    return live[-1][2]


def fetch_wikidata_logo(label: str, domain: str) -> tuple[bytes, str] | None:
    """The company's logo from Wikidata (P154, rendered by Commons as a
    512px PNG), when an entity named like `label` has `domain` as its
    official website."""
    query = re.sub(r",?\s+(inc|llc|ltd|corp|co|plc)\.?$", "", label.strip(), flags=re.I)
    if not query or not domain:
        return None
    api = "https://www.wikidata.org/w/api.php?"
    search = _fetch_json(api + urllib.parse.urlencode(
        {"action": "wbsearchentities", "search": query, "language": "en", "type": "item", "limit": 5, "format": "json"}
    ))
    ids = [hit.get("id") for hit in (search or {}).get("search", []) if isinstance(hit, dict) and hit.get("id")]
    if not ids:
        return None
    got = _fetch_json(api + urllib.parse.urlencode(
        {"action": "wbgetentities", "ids": "|".join(ids), "props": "claims", "format": "json"}
    ))
    file_name = wikidata_logo_file((got or {}).get("entities") or {}, ids, domain)
    if not file_name:
        return None
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(file_name.replace(" ", "_")) + "?width=512"
    data = _fetch(url)
    return (data, url) if data and printable_logo(data) else None


def _fetch_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
            if resp.status != 200:
                return None
            data = json.loads(resp.read(MAX_PAGE_BYTES))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def domain_for_name(name: str) -> str | None:
    """Company name -> its domain, via Clearbit autocomplete."""
    query = re.sub(r",?\s+(inc|llc|ltd|corp|co|plc)\.?$", "", name.strip(), flags=re.I)
    if not query:
        return None
    req = urllib.request.Request(suggest_url(query), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
            if resp.status != 200:
                return None
            return parse_suggest_for(query, resp.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None


def _name_key(value: str) -> str:
    value = re.sub(r",?\s+(inc|llc|ltd|corp|co|plc|gmbh)\.?$", "", value.strip(), flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def parse_suggest_for(query: str, data: bytes) -> str | None:
    """The domain of the first autocomplete hit whose company name matches
    the query (equal, or one a leading part of the other, ignoring case,
    punctuation and legal suffix). A top hit for a different company (a
    small venture's name shared by a stranger) is never used: its logo
    would print beside the wrong employer."""
    try:
        hits = json.loads(data)
    except (json.JSONDecodeError, ValueError):
        return None
    want = _name_key(query)
    if not want or not isinstance(hits, list):
        return None
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        name, domain = _name_key(str(hit.get("name") or "")), hit.get("domain")
        if name and isinstance(domain, str) and domain and (name == want or name.startswith(want) or want.startswith(name)):
            return domain
    return None


def fetch_favicon(domain: str) -> bytes | None:
    """Fetch the site favicon via Google s2."""
    return _fetch(favicon_url(domain))


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

    # 2. the company's own site logo, then 3. its favicon. The domain is the
    #    manifest's, or comes from the name alone (Clearbit autocomplete), so
    #    a bare name in the profile resolves without any user upload.
    if not offline:
        domain = entry.domain
        via = ""
        if not domain:
            domain = domain_for_name(entry.label)
            via = f"name:{entry.label} -> "
        if domain:
            site = fetch_site_logo(domain)
            if site:
                target.write_bytes(site[0])
                return ResolveResult(entry.slug, "site", target, f"{via}{site[1]}")
            wiki = fetch_wikidata_logo(entry.label, domain)
            if wiki:
                target.write_bytes(wiki[0])
                return ResolveResult(entry.slug, "site", target, f"{via}wikidata {wiki[1]}")
            data = fetch_favicon(domain)
            if data:
                target.write_bytes(data)
                return ResolveResult(entry.slug, "favicon", target, f"{via}{domain}")

    # 3. unavailable -> drop the mark. Remove any stale file so the template's
    #    <img onerror="this.remove()"> renders nothing (no broken-image icon).
    if target.exists():
        target.unlink()
    return ResolveResult(entry.slug, "missing", target, "no upload, site logo or favicon")


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
    parser.add_argument("--slug", help="Resolve one mark with no manifest (needs --label; --domain optional).")
    parser.add_argument("--label", help="Company name for --slug.")
    parser.add_argument("--domain", help="Company domain for --slug.")
    args = parser.parse_args(argv)

    if args.slug:
        if not SLUG_RE.match(args.slug) or not (args.label or "").strip():
            print("ERROR: --slug needs a kebab-case slug and a --label", file=sys.stderr)
            return 1
        entry = LogoEntry(slug=args.slug, label=args.label.strip(), domain=(args.domain or "").strip() or None)
        results = [resolve_entry(entry, args.template_dir, offline=args.offline, force=args.force)]
    else:
        try:
            results = resolve_all(
                args.template_dir, args.manifest, offline=args.offline, force=args.force
            )
        except ManifestError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1

    for r in results:
        marker = {"upload": "↑", "site": "◆", "favicon": "🌐", "missing": "—", "skipped": "·"}[r.source]
        print(f"  {marker} {r.slug:<14} {r.source:<9} {r.detail}")
    counts = {s: sum(1 for r in results if r.source == s) for s in ("upload", "site", "favicon", "missing", "skipped")}
    print(f"\n{len(results)} marks: " + ", ".join(f"{v} {k}" for k, v in counts.items() if v))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
