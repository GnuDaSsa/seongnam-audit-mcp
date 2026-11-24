"""Build audited report snapshots from fixed public attachments. Python 3 + PyMuPDF."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

import pymupdf


ROOT = Path(__file__).resolve().parent.parent
FOUNDATION_URL = "https://www.snyouth.or.kr/File/Download/7ea5b586ab3208f3e5108da612984f31"
FOUNDATION_BOARD = "https://www.snyouth.or.kr/fmcs/286?action=read&action-value=71983f59f30497a3969ba7ad535394b5&page=2"
FOUNDATION_HASH = "30b9c8b3857d5137c3dc5e1463534e5dc1a4b2dda71d712ffa6138675cd79b6a"
GG_BOARD = "https://www.gg.go.kr/audit/bbs/boardView.do?bIdx=110888636&bcIdx=533&bsIdx=886&menuId=4272&page=1"
GG_ATTACHMENTS = [
    ("report-2024.pdf", "2024년 성남시 종합감사 결과보고서(공개용)", "1037454"),
    ("dispositions-2024.pdf", "2024년 성남시 종합감사 처분요구서(공개용)", "1039474"),
]
# Classifications are local search facets. Titles and all page text come directly from the PDF.
FOUNDATION_CATEGORIES = ["복무", "복무", "여비", "복무", "회계", "계약", "계약", "정보보안"]
TITLE = re.compile(r"【제\s*목】\s*:\s*([^\n]+)")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".tmp", dir=path.parent, delete=False) as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")
    Path(f.name).replace(path)


def fetch_pdf(url, path, expected_hash=None):
    """An HTTP 200 block notice must never replace the last valid PDF."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=path.parent) as tmp:
        dest = Path(tmp) / "attachment"
        run = subprocess.run(["curl", "--fail", "--silent", "--show-error", "--proto", "=https",
                              "--max-time", "90", "--output", str(dest), url], capture_output=True)
        if run.returncode:
            return "download_failed"
        data = dest.read_bytes()
        if not data.startswith(b"%PDF-"):
            return "access_policy_notice" if "보안 정책에 의해 차단" in data.decode("cp949", errors="replace") else "not_pdf"
        if expected_hash and sha256(data) != expected_hash:
            raise ValueError(f"{path.name}: original changed; review before replacing source.")
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.needs_pass or len(doc) == 0:
                return "unreadable_pdf"
        dest.replace(path)
        return "pdf_saved"


def foundation(refresh):
    src_id = "foundation-2018"
    path = ROOT / "originals/foundation/2018.pdf"
    if refresh or not path.exists():
        result = fetch_pdf(FOUNDATION_URL, path, FOUNDATION_HASH)
        if result != "pdf_saved":
            raise RuntimeError(f"재단 원본을 내려받지 못함 ({result}). 기존 스냅샷을 유지함.")
    raw = path.read_bytes()
    if sha256(raw) != FOUNDATION_HASH:
        raise ValueError("2018년 정기감사 원본 해시 불일치. 쪽수와 지적사항을 다시 확인하세요.")
    pages = {}
    starts = []
    with pymupdf.open(stream=raw, filetype="pdf") as doc:
        for pageno, page in enumerate(doc, start=1):
            text = page.get_text("text")
            head = re.search(r"감사결과처분요구서\s*\n(\d+)\s*\n", text)
            heading = TITLE.search(text)
            if head and heading:
                starts.append((int(head[1]), pageno, heading[1].strip()))
            if starts:
                pages[f"p:{pageno}"] = text
        if len(doc) != 20 or [(a, b) for a, b, _ in starts] != list(enumerate([8, 10, 12, 13, 14, 15, 17, 19], 1)):
            raise ValueError("2018년 처분요구서 8건의 시작 쪽과 원문 구조 불일치")
        page_count = len(doc)
    cases = []
    for i, (number, start, title) in enumerate(starts):
        stop = starts[i + 1][1] if i + 1 < len(starts) else page_count + 1
        cases.append({"id": f"{src_id}-{number:02}", "source_id": src_id, "title": title, "year": 2018,
                      "agency": "성남시청소년재단", "category": FOUNDATION_CATEGORIES[i],
                      "locations": [f"p:{p}" for p in range(start, stop)]})
    source = {"id": src_id, "title": "2018년도 정기감사 결과보고", "url": FOUNDATION_URL,
              "publication_url": FOUNDATION_BOARD, "year": 2018, "authority": "성남시청소년재단",
              "sha256": FOUNDATION_HASH, "asset": path.relative_to(ROOT).as_posix(), "format": "pdf",
              "published_on": "2018-12-20", "page_count": page_count,
              "acquired_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")}
    coverage = {"scope": "성남시청소년재단 자체감사, 2018년도 정기감사 결과보고 1건",
                "indexed_reports": 1, "indexed_cases": len(cases), "expected_cases_in_report": 8,
                "indexed_pages": len(pages), "total_pages": page_count,
                "limits": ["표지·처분 집계·문책자 조서 등 처분요구서 이전 1~7쪽은 검색 대상에서 제외합니다.",
                           "분야는 이 서비스가 붙인 검색용 분류입니다. 당시 사례와 현행 규정은 별도로 대조합니다."]}
    write_json(ROOT / "snapshot/foundation-pages.json", {src_id: pages})
    write_json(ROOT / "snapshot/foundation.json", {"sources": [source], "cases": cases, "coverage": coverage})
    print(f"foundation: {len(cases)} cases, {len(pages)} physical pages")


def province(refresh):
    manifest = ROOT / "snapshot/province.json"
    previous = json.loads(manifest.read_text(encoding="utf-8"))["coverage"] if manifest.exists() else {}
    seen = {entry["url"]: entry for entry in previous.get("attachments", [])}
    observations = []
    for name, title, idx in GG_ATTACHMENTS:
        path = ROOT / "originals/province" / name
        url = "https://www.gg.go.kr/audit/cmmn/download.do?idx=" + idx
        entry = seen.get(url, {"title": title, "url": url, "state": "not_retrieved"})
        if refresh:
            state = fetch_pdf(url, path)
            entry = {"title": title, "url": url, "state": state,
                     "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        elif path.exists() and path.read_bytes().startswith(b"%PDF-"):
            entry = {**entry, "state": "pdf_saved"}
        if entry["state"] == "pdf_saved":
            entry["index_state"] = "pending_review"
        observations.append(entry)
    coverage = {"scope": "경기도감사위원회 2024년 성남시 종합감사", "publication_url": GG_BOARD,
                "indexed_reports": 0, "indexed_cases": 0, "attachments": observations,
                "limits": ["공식 목록의 첨부 제목만으로 지적 사례를 만들지 않습니다.",
                           "access_policy_notice는 기관이 보안 정책 차단 안내 HTML을 반환한 상태입니다.",
                           "새 원본을 확보하면 처분요구별 쪽 경계를 검토한 뒤에 색인합니다."]}
    write_json(ROOT / "snapshot/province-pages.json", {})
    write_json(manifest, {"sources": [], "cases": [], "coverage": coverage})
    print("province: 0 indexed cases;", [entry["state"] for entry in observations])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", choices=["foundation", "province", "all"], default="all")
    parser.add_argument("--refresh", action="store_true", help="원본을 공식 출처에서 재확인")
    args = parser.parse_args()
    if args.set in ("all", "foundation"):
        foundation(args.refresh)
    if args.set in ("all", "province"):
        province(args.refresh)
