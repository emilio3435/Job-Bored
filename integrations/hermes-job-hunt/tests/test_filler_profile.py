"""The filler identity comes from the user's gitignored profile — H8."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import filler_profile as fp

HERMES_DIR = Path(fp.__file__).resolve().parents[1]
EXAMPLE_JSON = HERMES_DIR / "profile" / "filler-profile.example.json"


@pytest.fixture
def profile_dir(tmp_path, monkeypatch):
    d = tmp_path / "profile"
    d.mkdir()
    monkeypatch.setenv("JHOS_PROFILE_DIR", str(d))
    return d


def test_no_identity_ships_as_a_module_default():
    assert not hasattr(fp, "CANDIDATE"), "identity must be loaded from the local profile, never hardcoded"
    source = Path(fp.__file__).read_text()
    for needle in ["@gmail.com", "linkedin.com/in/", "github.com/"]:
        assert needle not in source


def test_missing_profile_fails_closed(profile_dir):
    with pytest.raises(fp.ProfileMissingError):
        fp.load_candidate()
    with pytest.raises(fp.ProfileMissingError):
        fp.build_profile_context()


def test_example_profile_loads_neutral_values(profile_dir):
    (profile_dir / "filler-profile.json").write_text(EXAMPLE_JSON.read_text())
    candidate = fp.load_candidate()
    assert candidate["email"].endswith("@example.com")
    assert candidate["first_name"] and candidate["last_name"]
    context = fp.build_profile_context()
    assert "Candidate Profile" in context
    assert fp.get_answer_strategies()["salary_expectation"] == "__SKIP__"


def test_unedited_profile_md_template_fails_closed(profile_dir):
    (profile_dir / "profile.md").write_text((HERMES_DIR / "profile" / "profile.example.md").read_text())
    with pytest.raises(fp.ProfileMissingError):
        fp.load_candidate()


def test_contact_section_of_profile_md_is_used(profile_dir):
    (profile_dir / "profile.md").write_text(
        "# Sam Example — profile\n\n## Contact\n\n"
        "- Name: Sam Example\n"
        "- Location: Springfield, IL\n"
        "- Phone: 555-555-0100\n"
        "- Email: sam@example.com\n"
        "- Portfolio: [example.com](https://example.com)\n"
        "- LinkedIn: [linkedin.com/in/sam-example](https://www.linkedin.com/in/sam-example)\n\n"
        "## Positioning anchor\n\nText.\n"
    )
    c = fp.load_candidate()
    assert c["first_name"] == "Sam"
    assert c["last_name"] == "Example"
    assert c["email"] == "sam@example.com"
    assert c["phone"] == "555-555-0100"
    assert c["city"] == "Springfield"
    assert c["linkedin"] == "https://www.linkedin.com/in/sam-example"
    assert c["website"] == "https://example.com"


def test_json_profile_missing_required_fields_fails_closed(profile_dir):
    (profile_dir / "filler-profile.json").write_text(json.dumps({"candidate": {"first_name": "Sam"}}))
    with pytest.raises(fp.ProfileMissingError):
        fp.load_candidate()


def test_live_filler_refuses_to_start_without_a_profile(profile_dir, tmp_path):
    import universal_filler as uf

    app = tmp_path / "app"
    app.mkdir()
    (app / "resume.pdf").write_text("x")
    (app / "cover-letter.pdf").write_text("x")
    launched = []
    filler = uf.UniversalFiller(
        "https://jobs.example.com/1", app, dry_run=False, gate2_confirmed=True,
        playwright_factory=lambda: launched.append(1),
    )
    result = filler.run()
    assert result["manual_review"] is True
    assert "profile" in result["error"].lower()
    assert launched == []


def test_local_profile_files_are_gitignored():
    ignore = (HERMES_DIR / ".gitignore").read_text()
    assert "profile/filler-profile.json" in ignore
    assert "approval-contract.local.json" in ignore
