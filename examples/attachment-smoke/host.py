"""Generate three synthetic fixtures and locally extract a minimal MCP query."""
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / ".work"
FONT = Path("C:/Windows/Fonts/malgun.ttf")
LINES = [
    "가상 구매 검토서",
    "업무 유형   물품구매",
    "검토 요청   분할계약 여부",
    "구매 횟수   2회",
    "관리 번호   TEST-4827",
]


def win_ocr(image):
    return subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-File", str(ROOT / "recognize.ps1"),
         "-ImagePath", str(image)],
        stdout=subprocess.PIPE, encoding="utf-8", check=True,
    ).stdout


def inputs(directory):
    png = directory / "synthetic.png"
    image = Image.new("RGB", (1200, 640), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), 50)
    for row, line in enumerate(LINES):
        draw.text((68, 45 + 110 * row), line, font=font, fill="black")
    image.save(png)
    pdf_text = directory / "text.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page(width=600, height=320)
        page.insert_font(fontname="Malgun", fontfile=str(FONT))
        for row, line in enumerate(LINES):
            page.insert_text((34, 53 + 55 * row), line, fontsize=24, fontname="Malgun")
        doc.save(pdf_text)
    pdf_scan = directory / "scan.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page(width=600, height=320)
        page.insert_image(page.rect, filename=str(png))
        doc.save(pdf_scan)
    for pdf in (pdf_text, pdf_scan):
        subprocess.run(["pdftoppm", "-scale-to", "1200", "-singlefile", "-png", str(pdf),
                        str(directory / (pdf.stem + "-render"))], check=True)
    return png, pdf_text, pdf_scan


def keywords(recognized):
    compact = re.sub(r"\s+", "", unicodedata.normalize("NFKC", recognized))
    allowed = ("물품구매", "분할계약")
    query = " ".join(term for term in allowed if term in compact)
    counts = re.findall(r"\d+회", compact)
    if len(query.split()) != 2 or "구매횟수" not in compact or counts != ["2회"]:
        raise ValueError(f"Review required for fixture OCR: {recognized!r}")
    return query


def main():
    OUTPUT.mkdir(exist_ok=True)
    local_result = OUTPUT / "local-results.json"
    local_result.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(dir=OUTPUT) as scratch:
        png, pdf_text, pdf_scan = inputs(Path(scratch))
        with pymupdf.open(pdf_text) as doc:
            text = doc[0].get_text()
        with pymupdf.open(pdf_scan) as doc:
            if doc[0].get_text().strip():
                raise ValueError("Test scan contains a text layer.")
        cases = [
            ("PNG", "Windows.Media.Ocr ko", win_ocr(png)),
            ("PDF with text", "PyMuPDF text extraction", text),
            ("PDF without text", "Poppler rasterization + Windows.Media.Ocr ko",
             win_ocr(pdf_scan.parent / "scan-render.png")),
        ]
        results = []
        for name, method, recognized in cases:
            query = keywords(recognized)
            marker = "TEST-4827"
            if marker not in re.sub(r"\s+", "", recognized) or marker in query:
                raise ValueError(f"Redaction check failed for {name}: {recognized!r}")
            results.append({"format": name, "method": method, "business_terms_verified": True,
                            "local_marker_detected": True, "query": query})
        for kind in ("text", "scan"):
            # QA previews of generated synthetic fixtures only.
            preview = OUTPUT / f"{kind}-preview.png"
            preview.write_bytes((png.parent / f"{kind}-render.png").read_bytes())
        local_result.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(results, ensure_ascii=True))


if __name__ == "__main__":
    main()
