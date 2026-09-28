"""Regenerate the PDF and DOCX resume fixtures from bulleted-source.txt.

Run with a Python that has reportlab (macOS: /usr/bin/python3):
    python3 tests/fixtures/resumes/generate-binary-fixtures.py

The PDF is laid out with real list bullets and a narrow column, so long
bullets wrap across lines the way a Word export does. The DOCX uses real
Word list numbering (w:numPr), not typed "- " characters, so the ingest
path has to recover the bullets from the document structure.
"""

import os
import zipfile
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "bulleted-source.txt")


def read_blocks():
    with open(SOURCE, encoding="utf-8") as fh:
        lines = [line.rstrip("\n") for line in fh if line.strip()]
    return [("bullet", line[2:]) if line.startswith("- ") else ("para", line) for line in lines]


def build_pdf(blocks, path):
    body = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=13)
    doc = SimpleDocTemplate(path, pagesize=letter, leftMargin=90, rightMargin=90,
                            topMargin=60, bottomMargin=60,
                            title="Resume fixture", author="Example", creator="fixture")
    story = []
    pending = []

    def flush():
        if pending:
            story.append(ListFlowable([ListItem(Paragraph(escape(t), body)) for t in pending],
                                      bulletType="bullet", start="•", leftIndent=14))
            pending.clear()

    for kind, text in blocks:
        if kind == "bullet":
            pending.append(text)
            continue
        flush()
        story.append(Paragraph(escape(text), body))
    flush()
    doc.build(story)


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def docx_paragraph(text, bullet):
    ppr = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' if bullet else ""
    return f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def build_docx(blocks, path):
    body = "".join(docx_paragraph(text, kind == "bullet") for kind, text in blocks)
    document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>')
    numbering = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 f'<w:numbering xmlns:w="{W}">'
                 '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>'
                 '<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
                 '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
                '</Relationships>')
    fixed = (2026, 9, 27, 0, 0, 0)  # stable zip timestamps: regenerating is a no-op diff
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in [("[Content_Types].xml", content_types), ("_rels/.rels", rels),
                           ("word/document.xml", document), ("word/_rels/document.xml.rels", doc_rels),
                           ("word/numbering.xml", numbering)]:
            zf.writestr(zipfile.ZipInfo(name, fixed), data)


if __name__ == "__main__":
    blocks = read_blocks()
    build_pdf(blocks, os.path.join(HERE, "bulleted.pdf"))
    build_docx(blocks, os.path.join(HERE, "bulleted.docx"))
    print("wrote bulleted.pdf and bulleted.docx")
