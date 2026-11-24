"""Collect official Seongnam audit cases. Requires Python 3.10+, beautifulsoup4 and curl."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup, SoupStrainer


ROOT = Path(__file__).resolve().parents[1]
BASE = "https://www.seongnam.go.kr"
BOARD = BASE + "/pm030305"
USER_AGENT = "SeongnamAuditResearch/1.0"
CASE_PATTERN = re.compile(r"f_view\(\s*['\x22](\d+)['\x22]\s*\)")
FILE_PATTERN = re.compile(r"fileDownload\(\s*['\x22](\d+)['\x22]\s*\)")
DETAIL_PARTS = SoupStrainer(class_=["table-line", "board-view-content"])
# This HWP's cover marks it 비공개. Keep the public listing, without linking
# or republishing the attachment. Reviewed against the official original.
WITHHELD_FILES = {"3970"}


def fetch(url):
    # Windows curl uses the OS TLS stack supported by this official site.
    proc = subprocess.run(
        ["curl.exe" if os.name == "nt" else "curl", "--fail", "--silent", "--show-error",
         "--connect-timeout", "10", "--max-time", "35", "--retry", "2",
         "--retry-delay", "1", "--proto", "=https", "--compressed",
         "--user-agent", USER_AGENT, url], capture_output=True, check=False,
    )
    if proc.returncode:
        raise OSError(proc.stderr.decode("utf-8", "replace")[:250])
    return proc.stdout


def robots_rules():
    url = BASE + "/robots.txt"
    rules = RobotFileParser(url)
    rules.parse(fetch(url).decode("utf-8-sig").splitlines())
    return rules


def public_get(url, rules):
    if not url.startswith(BOARD) or not rules.can_fetch(USER_AGENT, url):
        raise ValueError("Collection is restricted to permitted public audit case URLs.")
    return fetch(url)


def listing(data):
    soup = BeautifulSoup(data, "html.parser", from_encoding="utf-8")
    rows = {}
    for link in soup.select("tr a[onclick*=f_view]"):
        match = CASE_PATTERN.search(link["onclick"])
        if not match:
            raise ValueError("Unexpected case link in the city listing")
        rows[match.group(1)] = link.get_text(strip=True)
    count = re.search(r"총\s*([\d,]+)\s*건", soup.get_text(" ", strip=True))
    if not count or not rows:
        raise ValueError("Could not read city listing or reported total")
    return int(count.group(1).replace(",", "")), rows


def parse_case(data):
    soup = BeautifulSoup(data, "html.parser", from_encoding="utf-8", parse_only=DETAIL_PARTS)
    fields = {label.get_text(strip=True): label.find_next_sibling("dd").get_text(strip=True)
              for label in soup.select(".table-line dt") if label.find_next_sibling("dd")}
    body = soup.select_one(".board-view-content")
    if not body or not fields.get("제목") or not fields.get("년도"):
        raise ValueError("Missing audit detail fields")
    attachments = {}
    for link in soup.select("a[onclick*=fileDownload]"):
        match = FILE_PATTERN.search(link["onclick"])
        if match and match.group(1) not in attachments:
            attachments[match.group(1)] = link.get_text(strip=True)
    return fields, body.get_text("\n", strip=True), attachments


def attachment_refs(case_key, files):
    # The board's GET download link gives HTTP 400. The actual desktop download
    # is a POST; the official viewer provides an ordinary, shareable GET URL.
    return [{"name": name, "url": f"{BOARD}/filePreview?idx={case_key}&fileIdx={key}",
             "download": {"method": "POST", "url": BOARD + "/fileDownload", "fileIdx": key}}
            for key, name in files.items() if key not in WITHHELD_FILES]


def save_bytes(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(raw)
    tmp.replace(path)


def save_json(path, payload):
    save_bytes(path, (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def get_case(item, rules, root, refresh):
    key, listed_title = item
    source_id = "city-" + key
    url = BOARD + "/" + key
    asset = f"originals/city/{key}.html.gz"
    path = root / asset
    try:
        if path.is_file() and not refresh:
            packed = path.read_bytes()
            raw = gzip.decompress(packed)
            fields, body, attachments = parse_case(raw)
        else:
            raw = public_get(url, rules)
            fields, body, attachments = parse_case(raw)
            packed = gzip.compress(raw, compresslevel=6, mtime=0)
            save_bytes(path, packed)
        attachments = attachment_refs(key, attachments)
        title = fields["제목"]
        year = int(fields["년도"])
        if not re.search("[가-힣]", body) or len(re.sub(r"\s", "", body)) < 22 or re.fullmatch(
            r"(?:세부|자세한|상세|감사|처분|내용|사항|결과|첨부|붙임|파일|자료|별첨|별지|을|를|은|는|의|과|와|확인|참고|참조|같음|바랍니다|바람|하시기|하세요|하여|해|요망|\W)+", body):
            issue = {"id": source_id, "title": title, "url": url,
                     "reason": "insufficient_html_body", "attachments": attachments}
            if key == "4587":
                issue["detail"] = "공개 HTML은 권고안 명칭 한 줄만 제공. 첨부 원본 표지 비공개 표시."
            return None, issue
        source = {"id": source_id, "title": title, "url": url, "year": year, "authority": "성남시",
                  "format": "html", "asset": asset, "sha256": hashlib.sha256(packed).hexdigest(),
                  "original_sha256": hashlib.sha256(raw).hexdigest(), "attachments": attachments}
        case = {"id": source_id, "source_id": source_id, "title": title, "year": year,
                "agency": fields.get("수감기관", ""), "category": fields.get("분야", ""),
                "agency_type": fields.get("기관구분", ""), "audit_name": fields.get("감사사항", ""),
                "locations": ["html:body"]}
        return (source, case, {"html:body": body}), None
    except (OSError, ValueError) as exc:
        return None, {"id": source_id, "title": listed_title, "url": url, "reason": str(exc)}


def collect(root, workers, refresh):
    rules = robots_rules()
    per_page = 100  # One of the city's selectable page sizes.
    def read_page(page):
        return listing(public_get(BOARD + "?" + urlencode({"cntPerPage": per_page, "curPage": page}), rules))
    total, items = read_page(1)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for reported, rows in pool.map(read_page, range(2, (total + per_page - 1) // per_page + 1)):
            if reported != total:
                raise ValueError("City listing changed during collection; rerun.")
            items.update(rows)
        if len(items) != total:
            raise ValueError(f"Expected {total} official IDs; found {len(items)}. Rerun.")
        print(f"Discovered {total} official cases", flush=True)
        sources, cases, pages, skipped = [], [], {}, []
        def read_case(item):
            return get_case(item, rules, root, refresh)
        for i, (record, issue) in enumerate(pool.map(read_case, items.items()), 1):
            if issue:
                skipped.append(issue)
            else:
                source, case, locations = record
                sources.append(source)
                cases.append(case)
                pages[source["id"]] = locations
            if i % 100 == 0:
                print(f"{i}/{total} checked, {len(skipped)} without usable body", flush=True)
    coverage = {"authority": "성남시", "listing_url": BOARD, "retrieved_at": datetime.now().astimezone().isoformat(),
                "listed": total, "indexed": len(cases), "skipped": skipped,
                "by_year": dict(sorted(Counter(str(case["year"]) for case in cases).items())),
                "rights_policy": BASE + "/cn050401",
                "source_scope": "성남시 분야별 감사사례 상세 게시물의 공개 본문. 첨부파일은 시의 공식 미리보기로 연결."}
    save_json(root / "snapshot/city-pages.json", pages)
    save_json(root / "snapshot/city.json", {"sources": sources, "cases": cases, "coverage": coverage})
    print(f"Indexed {len(cases)}/{total}; {len(skipped)} skipped.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, choices=range(1, 7), default=4)
    parser.add_argument("--refresh", action="store_true", help="Refetch existing official case pages.")
    parser.add_argument("--root", type=Path, default=ROOT)
    options = parser.parse_args()
    collect(options.root, options.workers, options.refresh)
