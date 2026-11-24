"""Synthetic response bodies. Never access the actual audit publishers in CI."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import reports


def fake_curl(payload):
    def run(command, **kwargs):
        target = Path(command[command.index("--output") + 1])
        target.write_bytes(payload)
        return subprocess.CompletedProcess(command, 0, b"", b"")
    return run


class AuditReportSourceTest(unittest.TestCase):
    def test_200_html_never_replaces_valid_pdf_or_creates_searchable_cases(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "originals/province/report-2024.pdf"
            path.parent.mkdir(parents=True)
            with reports.pymupdf.open() as pdf:
                pdf.new_page()
                previous = pdf.tobytes()
            path.write_bytes(previous)
            notice = "<html><p>보안 정책에 의해 차단</p></html>".encode("cp949")
            with patch.object(reports, "ROOT", root), patch.object(
                    reports.subprocess, "run", side_effect=fake_curl(notice)) as network:
                reports.province(refresh=True)
            self.assertEqual(network.call_count, 2)
            self.assertEqual(path.read_bytes(), previous)
            self.assertFalse((path.parent / "dispositions-2024.pdf").exists())
            manifest = json.loads((root / "snapshot/province.json").read_text("utf-8"))
            self.assertEqual(manifest["sources"], [])
            self.assertEqual(manifest["cases"], [])
            self.assertEqual(manifest["coverage"]["indexed_cases"], 0)
            self.assertEqual([a["state"] for a in manifest["coverage"]["attachments"]],
                             ["access_policy_notice", "access_policy_notice"])
            self.assertEqual(json.loads((root / "snapshot/province-pages.json").read_text("utf-8")), {})

    def test_200_unrecognised_html_is_not_a_report(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.pdf"
            with patch.object(reports.subprocess, "run", side_effect=fake_curl(b"<html>ok</html>")):
                status = reports.fetch_pdf("https://publisher.example.invalid/report", path)
            self.assertEqual(status, "not_pdf")
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
