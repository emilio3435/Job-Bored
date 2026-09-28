#!/usr/bin/env python3
"""
build-materials-fonts.py: static font instances for the materials PDFs.

Why: every face the template registry sets (Archivo, Martian Mono, Source
Sans 3, JetBrains Mono, Bodoni Moda, Caveat) is vendored as a Google Fonts
*variable* font. Chromium's PDF backend (Skia) cannot embed a variable font
as a TrueType/CID font, so it writes every glyph into a Type3 font instead.
Type3 glyph advances do not line up with the text positioning, and text
extractors (pypdf, pdftotext, most ATS parsers) read the gaps as word breaks:
"Directo r, Digital S ales", "m anaging". A static instance of the same
design embeds as CIDFontType2 with a real ToUnicode map, and words extract
whole.

This script pins every axis of the vendored variable woff2 files at the
coordinates listed in vendor/fonts/materials/instances.json and writes one
static woff2 per instance and subset, plus materials-fonts.css, which
server/materials-render.mjs inlines into each rendered document.

The output is committed; the app's own vendor/fonts/fonts.css is untouched.
Regenerate after changing instances.json:

    python3 -m pip install fonttools brotli   # any Python 3.9+
    python3 scripts/build-materials-fonts.py
"""

from __future__ import annotations

import json
import shutil
import re
import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
except ImportError:  # pragma: no cover - build-time tool
    sys.exit("build-materials-fonts.py needs fontTools and brotli: python3 -m pip install fonttools brotli")

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "vendor" / "fonts"
OUT = FONTS / "materials"
SPEC = OUT / "instances.json"
FACE_RE = re.compile(r"/\*\s*([a-z-]+)\s*\*/\s*@font-face\s*\{([^}]*)\}")


def read_prop(body: str, prop: str) -> str:
    m = re.search(prop + r":\s*([^;]+);", body)
    return m.group(1).strip() if m else ""


def variable_sources() -> dict[tuple[str, str, str], tuple[str, str]]:
    """(family, style, subset) -> (woff2 path under vendor/fonts, unicode-range)."""
    # The app's faces, then materials-only sources (vendor/fonts/materials/sources.css).
    css = (FONTS / "fonts.css").read_text(encoding="utf-8") + (OUT / "sources.css").read_text(encoding="utf-8")
    out: dict[tuple[str, str, str], tuple[str, str]] = {}
    for m in FACE_RE.finditer(css):
        subset, body = m.groups()
        if subset not in ("latin", "latin-ext", "all"):
            continue
        family = read_prop(body, "font-family").strip("'\"")
        style = read_prop(body, "font-style") or "normal"
        src = re.search(r"url\(([^)]+)\)", body).group(1)
        out.setdefault((family, style, subset), (src, read_prop(body, "unicode-range")))
    return out


def write_metrics(font: TTFont, path: Path) -> None:
    """Advance widths (em) for every mapped character, plus the tittle of i
    and j: the highest contour of each glyph, as its center x from the glyph
    origin, center y above the baseline, and diameter (em). The renderer
    places the name's colored dots from these, with no layout engine."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.recordingPen import DecomposingRecordingPen

    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    glyphs = font.getGlyphSet()
    advances = {chr(cp): round(hmtx[g][0] / upm, 5) for cp, g in cmap.items() if cp >= 0x20}
    tittles = {}
    for ch in ("i", "j"):
        rec = DecomposingRecordingPen(glyphs)
        glyphs[cmap[ord(ch)]].draw(rec)
        contours, current = [], []
        for op, args in rec.value:
            current.append((op, args))
            if op in ("closePath", "endPath"):
                contours.append(current)
                current = []
        best = None
        for contour in contours:
            pen = BoundsPen(glyphs)
            for op, args in contour:
                getattr(pen, op)(*args)
            if pen.bounds and (best is None or pen.bounds[1] > best[1]):
                best = pen.bounds
        x0, y0, x1, y1 = best
        tittles[ch] = {"cx": round((x0 + x1) / 2 / upm, 5), "cy": round((y0 + y1) / 2 / upm, 5), "d": round(max(x1 - x0, y1 - y0) / upm, 5)}
    hhea = font["hhea"]
    path.write_text(json.dumps({
        "unitsPerEm": upm,
        "ascent": round(hhea.ascent / upm, 5),
        "descent": round(-hhea.descent / upm, 5),
        "tittles": tittles,
        "advances": advances,
    }, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def main() -> int:
    # --metrics-only: write the *.metrics.json files and leave every font
    # file and materials-fonts.css as they are (re-saving would rewrite
    # identical fonts with new timestamps).
    metrics_only = "--metrics-only" in sys.argv[1:]
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    sources = variable_sources()
    rules: list[str] = [
        "/* ============================================================",
        "   vendor/fonts/materials/materials-fonts.css: GENERATED by",
        "   scripts/build-materials-fonts.py from instances.json. Do not",
        "   edit by hand. Static instances of the vendored variable faces,",
        "   so the materials PDFs embed CID fonts (whole words in the text",
        "   layer) instead of Skia's Type3 fallback for variable fonts.",
        "   OFL: each family's license sits in vendor/fonts/<family>/OFL.txt.",
        "   ============================================================ */",
        "",
    ]
    written = 0
    for inst in spec["instances"]:
        family = inst["family"]
        style = inst.get("style", "normal")
        axes = {k: float(v) for k, v in inst["axes"].items()}
        weight = int(axes.get("wght", 400))
        stretch = axes.get("wdth")
        # One full-coverage file ("all") when the source is vendored that way,
        # else Google's latin-ext / latin subset pair.
        subsets = ("all",) if (family, style, "all") in sources else ("latin-ext", "latin")
        for subset in subsets:
            key = (family, style, subset)
            if key not in sources:
                sys.exit(f"no vendored variable source for {key}")
            src, urange = sources[key]
            font = TTFont(FONTS / src)
            if "fvar" not in font:
                # Already static: copy the file byte for byte, keeping its own
                # format. Nothing to pin, and an unmodified copy keeps an OFL
                # Reserved Font Name valid.
                ext = Path(src).suffix
                fmt = {".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype"}[ext]
                name = "-".join([slug(family), str(weight), style, subset]) + ext
                if not metrics_only:
                    shutil.copyfile(FONTS / src, OUT / name)
                written += 1
                if inst.get("metrics"):
                    write_metrics(font, OUT / ("-".join([slug(family), str(weight), style]) + ".metrics.json"))
                rules += [
                    f"/* {subset} */",
                    "@font-face {",
                    f"  font-family: '{family}';",
                    f"  font-style: {style};",
                    f"  font-weight: {weight};",
                    "  font-display: block;",
                    f"  src: url(materials/{name}) format('{fmt}');",
                    f"  unicode-range: {urange};",
                    "}",
                ]
                continue
            fvar_axes = {a.axisTag: (a.minValue, a.maxValue) for a in font["fvar"].axes}
            pins = {}
            for tag, (lo, hi) in fvar_axes.items():
                value = axes.get(tag)
                if value is None:
                    value = next(a.defaultValue for a in font["fvar"].axes if a.axisTag == tag)
                pins[tag] = max(lo, min(hi, value))
            try:
                # Name the instance ("Archivo SemiExpanded Bold") from STAT,
                # so the PDF's BaseFont says which face it is.
                static = instancer.instantiateVariableFont(font, pins, updateFontNames=True)
            except Exception:  # noqa: BLE001 - no usable STAT table
                font = TTFont(FONTS / src)
                static = instancer.instantiateVariableFont(font, pins)
            static.flavor = "woff2"
            parts = [slug(family), str(weight)]
            if stretch is not None:
                parts.append(f"w{int(stretch * 10)}")
            if "opsz" in axes:
                parts.append(f"o{int(axes['opsz'])}")
            parts += [style, subset]
            name = "-".join(parts) + ".woff2"
            if inst.get("metrics") and subset == "latin":
                write_metrics(static, OUT / ("-".join(parts[:-1]) + ".metrics.json"))
            if not metrics_only:
                static.save(OUT / name)
            written += 1
            rules += [
                f"/* {subset} */",
                "@font-face {",
                f"  font-family: '{family}';",
                f"  font-style: {style};",
                f"  font-weight: {weight};",
                *( [f"  font-stretch: {stretch:g}%;"] if stretch is not None else [] ),
                "  font-display: block;",
                f"  src: url(materials/{name}) format('woff2');",
                f"  unicode-range: {urange};",
                "}",
            ]
    if metrics_only:
        print("wrote metrics only")
        return 0
    (OUT / "materials-fonts.css").write_text("\n".join(rules) + "\n", encoding="utf-8")
    print(f"wrote {written} static faces and materials-fonts.css")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
