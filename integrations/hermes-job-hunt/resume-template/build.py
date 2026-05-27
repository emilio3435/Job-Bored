#!/usr/bin/env python3
"""
build.py — render resume.html to a print-ready PDF.

Output:
  1. iCloud canonical path:
       ~/Library/Mobile Documents/com~apple~iCloud~CloudDocs/
         Personal Info/Personal Work/Professional Documents/Resumes/2026/
         Emilio_Nunez-Garcia_Resume_BASE.pdf
  2. Desktop convenience copy:
       ~/Desktop/Emilio_Nunez-Garcia_Resume_BASE.pdf

Requirements:
    pip install playwright
    playwright install chromium

Run:
    python3 build.py

Why headless Chromium and not ReportLab:
  - HTML/CSS is the most editable format for AI agents.
  - Web fonts (Fraunces, Inter, JetBrains Mono) render correctly
    without manual font registration.
  - Mixed roman + italic Fraunces stays a single text node so ATS
    parsers read each line as one line.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

# -------------------------------------------------------------------
# Paths
# -------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
SRC_HTML = HERE / "resume.html"

ICLOUD_DIR = (
    Path.home()
    / "Library/Mobile Documents/com~apple~CloudDocs"
    / "Personal Info/Personal Work/Professional Documents/Resumes/2026"
)
DESKTOP_DIR = Path.home() / "Desktop"
PDF_NAME = "Emilio_Nunez-Garcia_Resume_BASE.pdf"

ICLOUD_PDF = ICLOUD_DIR / PDF_NAME
DESKTOP_PDF = DESKTOP_DIR / PDF_NAME

# Resume.html is rendered at US Letter, 0.65" margins, backgrounds on.
PAGE_FORMAT = "Letter"
MARGIN = "0.65in"


def ensure_dirs() -> None:
    """Make sure the target folders exist (iCloud may need it)."""
    ICLOUD_DIR.mkdir(parents=True, exist_ok=True)
    DESKTOP_DIR.mkdir(parents=True, exist_ok=True)


def render_with_playwright(out_path: Path) -> None:
    """Launch headless Chromium, load resume.html, print to PDF."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.stderr.write(
            "ERROR: playwright is not installed.\n"
            "Run:\n"
            "  pip install playwright\n"
            "  playwright install chromium\n"
        )
        sys.exit(1)

    file_url = SRC_HTML.resolve().as_uri()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context()
        page = context.new_page()

        # Load the file and wait for everything (web fonts, etc.) to settle.
        page.goto(file_url, wait_until="networkidle")

        # Belt-and-suspenders: block until all fonts have actually loaded
        # before we ask Chromium to print.
        page.evaluate("document.fonts && document.fonts.ready")

        # Force print media so any @media print rules apply (we use them
        # to strip the screen-only "deck" backdrop).
        page.emulate_media(media="print")

        page.pdf(
            path=str(out_path),
            format=PAGE_FORMAT,
            print_background=True,
            prefer_css_page_size=True,
            margin={
                "top":    MARGIN,
                "right":  MARGIN,
                "bottom": MARGIN,
                "left":   MARGIN,
            },
        )

        context.close()
        browser.close()


def quick_pdf_sanity(pdf_path: Path) -> None:
    """Best-effort: warn if the PDF is suspiciously small or large, and
    run pdftotext (if available) to verify a few keywords are present
    and selectable."""
    size = pdf_path.stat().st_size
    print(f"  size: {size/1024:.1f} KB")
    if size < 30_000:
        print("  ⚠️  PDF is smaller than expected (< 30 KB).")
    if size > 800_000:
        print("  ⚠️  PDF is larger than expected (> 800 KB).")

    if shutil.which("pdftotext"):
        try:
            text = subprocess.check_output(
                ["pdftotext", "-layout", str(pdf_path), "-"],
                stderr=subprocess.DEVNULL,
            ).decode("utf-8", errors="replace")
        except subprocess.CalledProcessError:
            return

        # Spot-check that key terms made it into the text layer.
        must_have = [
            "Emilio Nunez-Garcia",
            "Performance marketing leader",
            "Digital Sales Manager",
            "Google Ads",
            "ROAS",
            "elioai.app",
            "Mathematical Economics",
        ]
        missing = [k for k in must_have if k not in text]
        if missing:
            print(f"  ⚠️  Missing keywords in PDF text layer: {missing}")
        else:
            print("  ✓ ATS keywords present and selectable.")


def main() -> int:
    if not SRC_HTML.exists():
        sys.stderr.write(f"ERROR: {SRC_HTML} not found.\n")
        return 1

    ensure_dirs()

    print(f"→ Rendering {SRC_HTML.name} → PDF (Letter, {MARGIN} margins, bg on)…")
    render_with_playwright(ICLOUD_PDF)
    print(f"✓ Wrote {ICLOUD_PDF}")

    # Mirror to Desktop.
    shutil.copyfile(ICLOUD_PDF, DESKTOP_PDF)
    print(f"✓ Copied to {DESKTOP_PDF}")

    quick_pdf_sanity(ICLOUD_PDF)
    return 0


if __name__ == "__main__":
    sys.exit(main())
