"""Export the budget MCP's fixed, locally available Model2Vec vocabulary subset."""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[1] / "model"
HASHES = {
    "common.bin.gz": "b61978ec171a1e856bcc3f5dc480127ec200c2e8534be0b73ca65d68c03d550a",
    "vocab.bin.gz": "e02db794c8fba747f7067652c596e6972f07b19ea092c3386af0df719de95e07",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("budget_semantic_directory", type=Path)
    directory = parser.parse_args().budget_semantic_directory
    blobs = {name: (directory / name).read_bytes() for name in HASHES}
    for name, blob in blobs.items():
        if hashlib.sha256(blob).hexdigest() != HASHES[name]:
            raise ValueError(f"unexpected budget model asset: {name}")
    common = gzip.decompress(blobs["common.bin.gz"])
    size, = struct.unpack_from("<I", common)
    rows = {token: row for row, token in enumerate(struct.unpack_from(f"<{size}I", common, 4))}
    vocab = gzip.decompress(blobs["vocab.bin.gz"])
    count, = struct.unpack_from("<I", vocab)
    offsets = struct.unpack_from(f"<{count + 1}I", vocab, 8)
    token_ids = struct.unpack_from(f"<{count}I", vocab, 12 + 4 * count)
    scores = struct.unpack_from(f"<{count}f", vocab, 12 + 8 * count)
    strings = memoryview(vocab)[12 + 12 * count:]
    words = []
    for index, token_id in enumerate(token_ids):
        if token_id in rows:
            word = bytes(strings[offsets[index]:offsets[index + 1]]).decode("utf-8")
            words.append([word, scores[index], rows[token_id]])
    MODEL_DIR.mkdir(exist_ok=True)
    data = json.dumps(words, ensure_ascii=False, separators=(",", ":")).encode()
    (MODEL_DIR / "words.json.gz").write_bytes(gzip.compress(data, mtime=0))
    (MODEL_DIR / "common.bin.gz").write_bytes(blobs["common.bin.gz"])
    print(f"{len(words):,} tokenizer entries, {size:,} embedding rows")


if __name__ == "__main__":
    main()
