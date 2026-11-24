"""Re-open collected official bytes for verification, independently of the search index."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys


def read_pages(request):
    raw = Path(request["asset"]).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != request["sha256"]:
        raise ValueError("original_hash_mismatch")
    data = gzip.decompress(raw) if request["asset"].endswith(".gz") else raw
    original_digest = hashlib.sha256(data).hexdigest()
    if request.get("original_sha256") and request["original_sha256"] != original_digest:
        raise ValueError("original_hash_mismatch")
    locations = request["locations"]
    kind = request["format"].lower()
    title = None
    if kind == "pdf":
        import pymupdf
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            pages = {}
            for loc in locations:
                match = re.fullmatch(r"p:([1-9][0-9]*)", loc)
                if not match or int(match[1]) > len(doc):
                    raise ValueError("invalid_original_location")
                pages[loc] = doc[int(match[1]) - 1].get_text("text")
    elif kind == "html":
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(data, "html.parser", from_encoding="utf-8")
        nodes = soup.select(".board-view-content")
        if len(nodes) != 1 or set(locations) != {"html:body"}:
            raise ValueError("invalid_original_location")
        pages = {"html:body": nodes[0].get_text("\n", strip=True)}
        label = next((node for node in soup.select(".table-line dt") if node.get_text(strip=True) == "제목"), None)
        if not label or not label.find_next_sibling("dd"):
            raise ValueError("invalid_original_location")
        title = label.find_next_sibling("dd").get_text(strip=True)
    else:
        raise ValueError("unsupported_original_format")
    return {"pages": pages, "sha256": digest, "original_sha256": original_digest, "title": title}


if __name__ == "__main__":
    try:
        result = read_pages(json.loads(sys.stdin.buffer.read().decode("utf-8")))
    except ValueError as error:
        known = {"original_hash_mismatch", "invalid_original_location", "unsupported_original_format"}
        result = {"error": str(error) if str(error) in known else "original_extraction_failed"}
    except OSError:
        result = {"error": "original_read_failed"}
    except Exception:
        result = {"error": "original_extraction_failed"}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
