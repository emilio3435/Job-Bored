#!/usr/bin/env python3
"""
JHOS Phase 6 — Greenhouse ATS Form Filler

Automates filling Greenhouse job application forms using Playwright.
Handles the standard Greenhouse application form fields:
  - First/Last name, Email, Phone, Location
  - Resume upload (PDF)
  - Cover letter upload (PDF)
  - LinkedIn URL
  - Portfolio/Website URL
  - Custom questions (text, select, radio, checkbox)

Usage:
    python3 greenhouse_filler.py --url <greenhouse_url> --app-dir <path> [--dry-run] [--headless]

The app-dir must contain resume.pdf and cover-letter.pdf.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

# ─── Candidate Profile ────────────────────────────────────────────────

CANDIDATE = {
    "first_name": "Emilio",
    "last_name": "Nunez-Garcia",
    "email": "emilio3435@gmail.com",
    "phone": "501.366.2080",
    "location": "Denver, CO",
    "linkedin": "https://www.linkedin.com/in/emiliobuilds",
    "website": "https://emiliobuilds.com",
}

# Keywords for mapping custom questions
AUTHORIZED_WORK_KEYWORDS = ["authorized", "legally", "eligibility", "work in the u"]
SPONSORSHIP_KEYWORDS = ["sponsor", "visa", "immigration"]
GENDER_KEYWORDS = ["gender"]
RACE_KEYWORDS = ["race", "ethnicity", "ethnic"]
VETERAN_KEYWORDS = ["veteran", "military"]
DISABILITY_KEYWORDS = ["disability", "disabled", "accommodation"]
SALARY_KEYWORDS = ["salary", "compensation", "pay", "desired salary"]
START_DATE_KEYWORDS = ["start date", "earliest", "available to start"]
REFERRAL_KEYWORDS = ["referr", "how did you hear", "how did you find", "source"]


def log(msg: str, level: str = "INFO"):
    ts = datetime.now(timezone(timedelta(hours=-5))).strftime("%H:%M:%S CT")
    print(f"[{ts}] [{level}] {msg}")


class GreenhouseFiller:
    """Fill a Greenhouse application form."""

    def __init__(self, url: str, app_dir: Path, headless: bool = True, dry_run: bool = False):
        self.url = url
        self.app_dir = app_dir
        self.headless = headless
        self.dry_run = dry_run
        self.screenshots = []
        self.evidence_dir = app_dir / "evidence"
        self.evidence_dir.mkdir(exist_ok=True)

    def _screenshot(self, page, name: str) -> str:
        """Take a screenshot for evidence."""
        ts = datetime.now(timezone(timedelta(hours=-5))).strftime("%Y%m%d-%H%M%S")
        path = str(self.evidence_dir / f"{name}-{ts}.png")
        page.screenshot(path=path, full_page=True)
        self.screenshots.append(path)
        log(f"Screenshot: {path}")
        return path

    def _fill_text_field(self, page, selector: str, value: str, label: str = ""):
        """Fill a text field, clearing it first."""
        try:
            field = page.locator(selector).first
            if field.is_visible(timeout=2000):
                field.click()
                field.fill(value)
                log(f"Filled {label or selector}: {value[:30]}...")
                return True
        except Exception:
            pass
        return False

    def _upload_file(self, page, input_selector: str, file_path: str, label: str = ""):
        """Upload a file to a file input."""
        try:
            file_input = page.locator(input_selector).first
            if file_input.count() > 0:
                file_input.set_input_files(file_path)
                log(f"Uploaded {label or 'file'}: {file_path}")
                return True
        except Exception as e:
            log(f"Upload failed for {label}: {e}", "WARN")
        return False

    def _answer_custom_question(self, page, question_el, label_text: str) -> bool:
        """Attempt to answer a custom question based on its label."""
        label_lower = label_text.lower()

        # Authorized to work?
        if any(kw in label_lower for kw in AUTHORIZED_WORK_KEYWORDS):
            return self._select_or_type(page, question_el, "Yes", label_text)

        # Sponsorship needed?
        if any(kw in label_lower for kw in SPONSORSHIP_KEYWORDS):
            return self._select_or_type(page, question_el, "No", label_text)

        # Salary expectations — skip or provide a range
        if any(kw in label_lower for kw in SALARY_KEYWORDS):
            # Per profile: no compensation in materials, but form fields may require it
            log(f"Skipping salary field: {label_text}", "WARN")
            return False

        # Start date
        if any(kw in label_lower for kw in START_DATE_KEYWORDS):
            return self._select_or_type(page, question_el, "Immediately", label_text)

        # Referral source
        if any(kw in label_lower for kw in REFERRAL_KEYWORDS):
            return self._select_or_type(page, question_el, "Job Board", label_text)

        # EEO questions — "Decline to self-identify" or skip
        if any(kw in label_lower for kw in GENDER_KEYWORDS + RACE_KEYWORDS + VETERAN_KEYWORDS + DISABILITY_KEYWORDS):
            return self._select_or_type(page, question_el, "Decline", label_text)

        log(f"Unknown custom question: {label_text}", "WARN")
        return False

    def _select_or_type(self, page, container, value: str, label: str) -> bool:
        """Try to select from dropdown, radio, or type into text field."""
        try:
            # Try select dropdown
            select = container.locator("select").first
            if select.count() > 0 and select.is_visible(timeout=1000):
                options = select.locator("option").all_text_contents()
                # Find best match
                match = None
                for opt in options:
                    if value.lower() in opt.lower():
                        match = opt
                        break
                if match:
                    select.select_option(label=match)
                    log(f"Selected '{match}' for: {label}")
                    return True

            # Try radio buttons
            radios = container.locator("input[type='radio']")
            if radios.count() > 0:
                for i in range(radios.count()):
                    radio = radios.nth(i)
                    radio_label = container.locator(f"label[for='{radio.get_attribute('id')}']")
                    if radio_label.count() > 0 and value.lower() in radio_label.text_content().lower():
                        radio.click()
                        log(f"Selected radio '{value}' for: {label}")
                        return True

            # Try text input
            text_input = container.locator("input[type='text'], textarea").first
            if text_input.count() > 0 and text_input.is_visible(timeout=1000):
                text_input.fill(value)
                log(f"Typed '{value}' for: {label}")
                return True

        except Exception as e:
            log(f"Could not answer '{label}': {e}", "WARN")
        return False

    def run(self) -> dict:
        """Execute the form fill."""
        from playwright.sync_api import sync_playwright

        results = {
            "url": self.url,
            "app_dir": str(self.app_dir),
            "dry_run": self.dry_run,
            "fields_filled": [],
            "fields_skipped": [],
            "files_uploaded": [],
            "screenshots": [],
            "submitted": False,
            "error": None,
        }

        resume_pdf = self.app_dir / "resume.pdf"
        cover_pdf = self.app_dir / "cover-letter.pdf"

        if not resume_pdf.exists():
            results["error"] = f"resume.pdf not found in {self.app_dir}"
            return results
        if not cover_pdf.exists():
            results["error"] = f"cover-letter.pdf not found in {self.app_dir}"
            return results

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            context = browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            page = context.new_page()

            try:
                # Navigate to application page
                log(f"Navigating to {self.url}")
                page.goto(self.url, wait_until="networkidle", timeout=30000)
                time.sleep(2)
                self._screenshot(page, "01-initial-load")

                # ── Standard fields ──

                # First name
                for sel in ['input#first_name', 'input[name="job_application[first_name]"]', 'input[autocomplete="given-name"]']:
                    if self._fill_text_field(page, sel, CANDIDATE["first_name"], "First Name"):
                        results["fields_filled"].append("first_name")
                        break

                # Last name
                for sel in ['input#last_name', 'input[name="job_application[last_name]"]', 'input[autocomplete="family-name"]']:
                    if self._fill_text_field(page, sel, CANDIDATE["last_name"], "Last Name"):
                        results["fields_filled"].append("last_name")
                        break

                # Email
                for sel in ['input#email', 'input[name="job_application[email]"]', 'input[type="email"]']:
                    if self._fill_text_field(page, sel, CANDIDATE["email"], "Email"):
                        results["fields_filled"].append("email")
                        break

                # Phone
                for sel in ['input#phone', 'input[name="job_application[phone]"]', 'input[type="tel"]']:
                    if self._fill_text_field(page, sel, CANDIDATE["phone"], "Phone"):
                        results["fields_filled"].append("phone")
                        break

                # Location
                for sel in ['input#job_application_location', 'input[name="job_application[location]"]']:
                    if self._fill_text_field(page, sel, CANDIDATE["location"], "Location"):
                        results["fields_filled"].append("location")
                        break

                # LinkedIn
                for sel in ['input[name*="linkedin"]', 'input[id*="linkedin"]', 'input[placeholder*="LinkedIn"]']:
                    if self._fill_text_field(page, sel, CANDIDATE["linkedin"], "LinkedIn"):
                        results["fields_filled"].append("linkedin")
                        break

                # Website/Portfolio
                for sel in ['input[name*="website"]', 'input[id*="website"]', 'input[placeholder*="Website"]', 'input[placeholder*="Portfolio"]']:
                    if self._fill_text_field(page, sel, CANDIDATE["website"], "Website"):
                        results["fields_filled"].append("website")
                        break

                self._screenshot(page, "02-fields-filled")

                # ── File uploads ──

                # Resume
                for sel in ['input[type="file"]#resume', 'input[type="file"][name*="resume"]', 'input[type="file"]:first-of-type']:
                    if self._upload_file(page, sel, str(resume_pdf), "Resume"):
                        results["files_uploaded"].append("resume.pdf")
                        break

                time.sleep(1)

                # Cover letter — often the second file input
                file_inputs = page.locator('input[type="file"]')
                if file_inputs.count() >= 2:
                    if self._upload_file(page, 'input[type="file"]:nth-of-type(2)', str(cover_pdf), "Cover Letter"):
                        results["files_uploaded"].append("cover-letter.pdf")
                else:
                    # Look for cover letter specific input
                    for sel in ['input[type="file"][name*="cover"]', 'input[type="file"][id*="cover"]']:
                        if self._upload_file(page, sel, str(cover_pdf), "Cover Letter"):
                            results["files_uploaded"].append("cover-letter.pdf")
                            break

                time.sleep(1)
                self._screenshot(page, "03-files-uploaded")

                # ── Custom questions ──
                custom_sections = page.locator('.field, .application-field, [class*="question"]')
                for i in range(min(custom_sections.count(), 20)):
                    section = custom_sections.nth(i)
                    try:
                        label = section.locator("label").first.text_content().strip()
                        if label and len(label) > 3:
                            answered = self._answer_custom_question(page, section, label)
                            if answered:
                                results["fields_filled"].append(f"custom:{label[:50]}")
                            else:
                                results["fields_skipped"].append(label[:80])
                    except Exception:
                        pass

                self._screenshot(page, "04-pre-submit")

                # ── Submit ──
                if self.dry_run:
                    log("DRY RUN — not clicking submit")
                    results["submitted"] = False
                else:
                    submit_btn = None
                    for sel in ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Submit")', 'button:has-text("Apply")']:
                        try:
                            btn = page.locator(sel).first
                            if btn.is_visible(timeout=2000):
                                submit_btn = btn
                                break
                        except Exception:
                            pass

                    if submit_btn:
                        log("Clicking submit button...")
                        submit_btn.click()
                        time.sleep(5)
                        self._screenshot(page, "05-post-submit")
                        results["submitted"] = True
                        log("Form submitted!")
                    else:
                        log("Submit button not found", "ERROR")
                        results["error"] = "Submit button not found"

            except Exception as e:
                log(f"Error during form fill: {e}", "ERROR")
                results["error"] = str(e)
                try:
                    self._screenshot(page, "error-state")
                except Exception:
                    pass

            finally:
                results["screenshots"] = self.screenshots
                browser.close()

        # Write results to evidence
        results_path = self.evidence_dir / "form-fill-results.json"
        with open(results_path, "w") as f:
            json.dump(results, f, indent=2)
        log(f"Results written to {results_path}")

        return results


# ─── CLI ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Greenhouse ATS Form Filler")
    parser.add_argument("--url", required=True, help="Greenhouse application URL")
    parser.add_argument("--app-dir", required=True, help="Application directory with resume.pdf and cover-letter.pdf")
    parser.add_argument("--dry-run", action="store_true", help="Fill form but don't submit")
    parser.add_argument("--headless", action="store_true", default=True, help="Run headless (default: true)")
    parser.add_argument("--visible", action="store_true", help="Show browser window")

    args = parser.parse_args()

    headless = not args.visible
    app_dir = Path(args.app_dir)

    if not app_dir.is_dir():
        print(f"Error: {app_dir} is not a directory")
        sys.exit(1)

    filler = GreenhouseFiller(
        url=args.url,
        app_dir=app_dir,
        headless=headless,
        dry_run=args.dry_run,
    )

    results = filler.run()
    print("\n" + json.dumps(results, indent=2))

    if results.get("error"):
        sys.exit(1)


if __name__ == "__main__":
    main()
