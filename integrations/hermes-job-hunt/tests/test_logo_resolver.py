#!/usr/bin/env python3
"""Tests for scripts/logo_resolver.py — offline-safe (no network)."""

import json
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import logo_resolver as lr  # noqa: E402

# Smallest valid 1x1 transparent PNG.
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)


# --------------------------- pure helpers --------------------------- #
def test_looks_like_image_accepts_png_rejects_html():
    assert lr.looks_like_image(TINY_PNG)
    assert not lr.looks_like_image(b"<!DOCTYPE html><html>not an image</html>")


def test_favicon_url_uses_google_s2():
    assert "domain=audacy.com" in lr.favicon_url("Audacy.com")  # normalizes case
    assert "sz=128" in lr.favicon_url("audacy.com")


def test_suggest_url_encodes_company_name():
    assert "query=Hormiga%20Dormida" in lr.suggest_url("Hormiga Dormida")


def test_parse_suggest_returns_top_domain_else_none():
    assert lr.parse_suggest(b'[{"name":"Audacy","domain":"audacy.com","logo":null}]') == "audacy.com"
    assert lr.parse_suggest(b'[{"name":"NoDomain"}]') is None
    assert lr.parse_suggest(b"[]") is None
    assert lr.parse_suggest(b"not json") is None


# --------------------------- manifest --------------------------- #
def _write_manifest(path: Path, logos: list[dict]) -> None:
    path.write_text(json.dumps({"logos": logos}), encoding="utf-8")


def test_load_manifest_parses_entries(tmp_path):
    m = tmp_path / "logos.json"
    _write_manifest(m, [{"slug": "audacy", "label": "Audacy", "domain": "audacy.com"}])
    entries = lr.load_manifest(m)
    assert entries[0].slug == "audacy"
    assert entries[0].domain == "audacy.com"
    assert entries[0].upload is None


def test_load_manifest_rejects_missing_file(tmp_path):
    with pytest.raises(lr.ManifestError, match="not found"):
        lr.load_manifest(tmp_path / "nope.json")


def test_load_manifest_rejects_bad_slug_and_duplicates(tmp_path):
    bad = tmp_path / "bad.json"
    _write_manifest(bad, [{"slug": "Has Spaces", "label": "x"}])
    with pytest.raises(lr.ManifestError, match="invalid slug"):
        lr.load_manifest(bad)

    dup = tmp_path / "dup.json"
    _write_manifest(dup, [{"slug": "a", "label": "A"}, {"slug": "a", "label": "A2"}])
    with pytest.raises(lr.ManifestError, match="Duplicate"):
        lr.load_manifest(dup)


# --------------------------- resolution priority --------------------------- #
def test_upload_wins(tmp_path):
    (tmp_path / "uploads").mkdir()
    (tmp_path / "uploads" / "logo-x.png").write_bytes(TINY_PNG)
    entry = lr.LogoEntry(slug="x", label="X", domain="example.com", upload="uploads/logo-x.png")
    result = lr.resolve_entry(entry, tmp_path, offline=True)
    assert result.source == "upload"
    assert (tmp_path / "assets" / "logo-x.png").read_bytes() == TINY_PNG


def test_offline_without_upload_is_missing_and_writes_nothing(tmp_path):
    entry = lr.LogoEntry(slug="acme", label="Acme Corp", domain="acme.com")
    result = lr.resolve_entry(entry, tmp_path, offline=True)
    assert result.source == "missing"
    assert not (tmp_path / "assets" / "logo-acme.png").exists()


def test_missing_upload_file_is_missing(tmp_path):
    entry = lr.LogoEntry(slug="x", label="X", upload="uploads/does-not-exist.png")
    result = lr.resolve_entry(entry, tmp_path, offline=True)
    assert result.source == "missing"
    assert not (tmp_path / "assets" / "logo-x.png").exists()


def test_existing_target_skipped_by_default_removed_on_force_when_unresolved(tmp_path):
    (tmp_path / "assets").mkdir()
    target = tmp_path / "assets" / "logo-x.png"
    target.write_bytes(TINY_PNG)
    entry = lr.LogoEntry(slug="x", label="X")  # no upload, no domain

    skipped = lr.resolve_entry(entry, tmp_path, offline=True)
    assert skipped.source == "skipped"
    assert target.exists()  # untouched by default

    forced = lr.resolve_entry(entry, tmp_path, offline=True, force=True)
    assert forced.source == "missing"
    assert not target.exists()  # stale mark dropped on --force


def test_resolve_all_runs_every_entry(tmp_path):
    _write_manifest(
        tmp_path / "logos.json",
        [{"slug": "a", "label": "A"}, {"slug": "b", "label": "B"}],
    )
    results = lr.resolve_all(tmp_path, offline=True)
    assert {r.slug for r in results} == {"a", "b"}
    assert all(r.source == "missing" for r in results)


# --------------------------- site logo discovery --------------------------- #
def _png(w: int, h: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + w.to_bytes(4, "big") + h.to_bytes(4, "big") + b"\x08\x06\x00\x00\x00"


def test_logo_candidates_rank_schema_logo_then_svg_then_touch_icon_and_skip_mask_icons():
    html = """<html><head>
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="mask-icon" href="/pinned.svg">
      <link rel="apple-touch-icon" href="/touch-180.png" sizes="180x180">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <meta property="og:image" content="/share-photo.jpg">
      <script type="application/ld+json">{"@type":"Organization","logo":{"url":"https://cdn.example.com/logo.png"}}</script>
    </head></html>"""
    urls = lr.logo_candidates(html, "https://www.example.com/")
    assert urls[:3] == [
        "https://cdn.example.com/logo.png",
        "https://www.example.com/icon.svg",
        "https://www.example.com/touch-180.png",
    ]
    assert "https://www.example.com/pinned.svg" not in urls  # one flat colour
    assert "https://www.example.com/favicon-16.png" not in urls  # too small to print
    assert "https://www.example.com/share-photo.jpg" not in urls  # a photo, not a logo
    assert urls[-1] == "https://www.example.com/apple-touch-icon.png"


def test_printable_logo_rejects_tiny_icons_and_html_accepts_marks_and_wordmarks():
    assert lr.printable_logo(_png(180, 180))
    assert lr.printable_logo(_png(400, 120))  # wordmark
    assert not lr.printable_logo(_png(32, 32))
    assert not lr.printable_logo(b"<!DOCTYPE html><html>soft 404</html>")
    assert lr.printable_logo(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
    assert not lr.printable_logo(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')


def test_wikidata_logo_needs_a_matching_official_website_and_prefers_the_current_logo():
    def claim(value, rank="normal", ended=False):
        c = {"mainsnak": {"datavalue": {"value": value}}, "rank": rank}
        if ended:
            c["qualifiers"] = {"P582": [{}]}
        return c

    entities = {
        "Q1": {"claims": {"P856": [claim("https://www.other-radio.com")], "P154": [claim("Other.svg")]}},
        "Q2": {"claims": {
            "P856": [claim("https://www.northwindmedia.com/")],
            "P154": [claim("Clear_Channel_2012_logo.jpg", ended=True), claim("NorthwindMedia_Logo.svg")],
        }},
    }
    assert lr.wikidata_logo_file(entities, ["Q1", "Q2"], "northwindmedia.com") == "NorthwindMedia_Logo.svg"
    assert lr.wikidata_logo_file(entities, ["Q1"], "northwindmedia.com") is None


# --------------------------- round 5: order and name matching --------------------------- #
def test_name_lookup_only_takes_a_hit_for_the_same_company():
    hits = b'[{"name":"Pipeworks Plumbing Supply","domain":"pipeworks-plumbing.example"},{"name":"Pipeworks","domain":"pipeworks.example"}]'
    assert lr.parse_suggest_for("Pipeworks", hits) == "pipeworks-plumbing.example"  # a leading-part match counts
    assert lr.parse_suggest_for("Pipeworks", b'[{"name":"Pipeworks","domain":"pipeworks.example"}]') == "pipeworks.example"
    assert lr.parse_suggest_for("Primary Residential Mortgage", b'[{"name":"Primary Residential Mortgage, Inc.","domain":"primeres.example"}]') == "primeres.example"
    assert lr.parse_suggest_for("Cedar Lantern", b'[{"name":"Hormel Foods","domain":"hormel.example"}]') is None


def _stub_network(monkeypatch, calls, site=None, wiki=None, favicon=None, domain="acme.example"):
    monkeypatch.setattr(lr, "domain_for_name", lambda name: calls.append(("name", name)) or domain)
    monkeypatch.setattr(lr, "fetch_site_logo", lambda d: calls.append(("site", d)) or site)
    monkeypatch.setattr(lr, "fetch_wikidata_logo", lambda label, d: calls.append(("wikidata", d)) or wiki)
    monkeypatch.setattr(lr, "fetch_favicon", lambda d: calls.append(("favicon", d)) or favicon)

    def no_network(*_args, **_kwargs):
        raise AssertionError("a test reached the network")

    monkeypatch.setattr(lr.urllib.request, "urlopen", no_network)


def test_resolution_order_upload_then_site_then_wikidata_then_favicon(tmp_path, monkeypatch):
    entry = lr.LogoEntry(slug="acme", label="Acme")
    calls = []
    _stub_network(monkeypatch, calls, site=(TINY_PNG, "https://acme.example/logo.png"))
    assert lr.resolve_entry(entry, tmp_path, force=True).source == "site"
    assert calls == [("name", "Acme"), ("site", "acme.example")], "the site logo wins; nothing after it runs"

    calls.clear()
    _stub_network(monkeypatch, calls, wiki=(TINY_PNG, "https://commons.example/Acme.svg"))
    assert lr.resolve_entry(entry, tmp_path, force=True).source == "site"
    assert [c[0] for c in calls] == ["name", "site", "wikidata"]

    calls.clear()
    _stub_network(monkeypatch, calls, favicon=TINY_PNG)
    assert lr.resolve_entry(entry, tmp_path, force=True).source == "favicon"
    assert [c[0] for c in calls] == ["name", "site", "wikidata", "favicon"]

    calls.clear()
    _stub_network(monkeypatch, calls)
    result = lr.resolve_entry(entry, tmp_path, force=True)
    assert result.source == "missing", "every source failed: no file, so the renderer draws the monogram"
    assert not (tmp_path / "assets" / "logo-acme.png").exists()


def test_a_domain_from_the_resume_skips_the_name_lookup(tmp_path, monkeypatch):
    calls = []
    _stub_network(monkeypatch, calls, site=(TINY_PNG, "https://meridian.example.org/icon.png"))
    entry = lr.LogoEntry(slug="meridian-insights-group", label="Meridian Insights Group", domain="meridian.example.org")
    assert lr.resolve_entry(entry, tmp_path, force=True).source == "site"
    assert calls == [("site", "meridian.example.org")]


def test_an_upload_wins_without_any_lookup(tmp_path, monkeypatch):
    calls = []
    _stub_network(monkeypatch, calls, site=(TINY_PNG, "x"))
    (tmp_path / "uploads").mkdir()
    (tmp_path / "uploads" / "logo-acme.png").write_bytes(TINY_PNG)
    entry = lr.LogoEntry(slug="acme", label="Acme", upload="uploads/logo-acme.png")
    assert lr.resolve_entry(entry, tmp_path, force=True).source == "upload"
    assert calls == []
