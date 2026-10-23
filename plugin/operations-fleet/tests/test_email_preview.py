from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from _helpers import load_module

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "communication" / "scripts" / "build_preview.py"


class EmailPreviewTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module("build_preview", SCRIPT)
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name)
        self.file = self.workspace / "report.txt"
        self.file.write_text("approved report\n", encoding="utf-8")
        digest = hashlib.sha256(self.file.read_bytes()).hexdigest()
        self.request = {
            "case_id": "case-1",
            "preview_id": "preview-1",
            "from": "ops@example.com",
            "to": ["team@example.com"],
            "subject": "Weekly report",
            "text": "The reviewed report is attached.",
            "attachments": [
                {
                    "id": "weekly-report",
                    "state": "ready",
                    "location": "report.txt",
                    "media_type": "text/plain",
                    "sha256": digest,
                }
            ],
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_preview_is_deterministic_and_never_sent(self) -> None:
        first = self.module.build_preview(self.workspace, self.request)
        first_bytes = (self.workspace / first["eml"]).read_bytes()
        second = self.module.build_preview(self.workspace, self.request)
        second_bytes = (self.workspace / second["eml"]).read_bytes()
        self.assertEqual(first_bytes, second_bytes)
        self.assertFalse(first["sent"])
        self.assertEqual(first["attachments"][0]["sha256"], self.request["attachments"][0]["sha256"])

    def test_changed_attachment_is_rejected(self) -> None:
        self.file.write_text("changed after review\n", encoding="utf-8")
        with self.assertRaises(self.module.PreviewError):
            self.module.build_preview(self.workspace, self.request)

    def test_attachment_cannot_escape_workspace(self) -> None:
        outside = self.workspace.parent / "outside.txt"
        outside.write_text("outside\n", encoding="utf-8")
        request = json.loads(json.dumps(self.request))
        request["attachments"][0]["location"] = str(outside)
        request["attachments"][0].pop("sha256", None)
        try:
            with self.assertRaises(self.module.PreviewError):
                self.module.build_preview(self.workspace, request)
        finally:
            outside.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
