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
