from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from _helpers import load_module

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "knowledge-extract" / "scripts" / "extract_docs.py"
WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main"


def write_docx(path: Path) -> None:
    body = (
        f'<w:document xmlns:w="{WORD}"><w:body>'
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Restart procedure</w:t></w:r></w:p>'
        '<w:p><w:r><w:t>Confirm the upstream file </w:t></w:r><w:r><w:t>arrived before 02:00.</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Rerun the load job.</w:t></w:r></w:p>'
        "</w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", body)


def write_pptx(path: Path) -> None:
    slide = (
        f'<p:sld xmlns:p="p" xmlns:a="{DRAWING}"><a:p><a:r><a:t>Escalation path</a:t></a:r></a:p>'
        "<a:p><a:r><a:t>Page the on-call engineer after 30 minutes.</a:t></a:r></a:p></p:sld>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("ppt/slides/slide1.xml", slide)


class ExtractDocsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module("extract_docs", SCRIPT)
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name)
        self.inbox = self.workspace / "inbox"
        self.knowledge = self.workspace / "knowledge"
        self.inbox.mkdir()
        self.knowledge.mkdir()
        (self.knowledge / "index.md").write_text(
            "---\ntype: Index\ntitle: Team knowledge\ndescription: Entry point.\nstatus: stable\n---\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_cli(self, *args: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.module.main(["--workspace", str(self.workspace), *args])
        return code, json.loads(out.getvalue())

    def scan(self) -> dict:
        code, result = self.run_cli("scan", "inbox")
        self.assertEqual(code, 0)
        return result

    def pending_id(self, result: dict, name: str) -> str:
        return next(item["id"] for item in result["pending"] if item["path"].endswith(name))

    def write_concept(self, name: str, *, status: str = "draft", cite: str = "runbook-load.md",
                      body: str = "Steps.\n") -> None:
        (self.knowledge / name).write_text(
            f"---\ntype: Playbook\ntitle: Load restart\ndescription: Restart the load.\nstatus: {status}\n"
            f"sources:\n  - id: src\n    resource: inbox/{cite}\n---\n\n{body}",
            encoding="utf-8",
        )

    def link_from_index(self, name: str) -> None:
        with (self.knowledge / "index.md").open("a", encoding="utf-8") as handle:
            handle.write(f"\n- [Load restart]({name})\n")

    def test_office_and_text_documents_are_extracted_and_chunked(self) -> None:
        write_docx(self.inbox / "SOP-load-restart.docx")
        write_pptx(self.inbox / "escalation-deck.pptx")
        (self.inbox / "owners.csv").write_text("system,owner\nsales_load,Data Ops\n", encoding="utf-8")
        (self.inbox / "page.html").write_text(
            "<html><head><style>x{}</style></head><body><h2>Runbook</h2><p>Check the queue.</p></body></html>",
            encoding="utf-8",
        )
        result = self.scan()
        self.assertEqual(len(result["new"]), 4)
        self.assertEqual(result["limits"], [])

        code, chunks = self.run_cli("chunks", self.pending_id(result, "SOP-load-restart.docx"))
        self.assertEqual(code, 0)
        text = "\n".join(item["text"] for item in chunks["chunks"])
        self.assertIn("Confirm the upstream file arrived before 02:00.", text)
        self.assertIn("- Rerun the load job.", text)
        self.assertEqual(chunks["chunks"][0]["section"], "Restart procedure")
        self.assertEqual(chunks["chunks"][0]["durable"], "yes")

        _, deck = self.run_cli("chunks", self.pending_id(result, "escalation-deck.pptx"))
        self.assertIn("Page the on-call engineer", deck["chunks"][0]["text"])
        _, page = self.run_cli("chunks", self.pending_id(result, "page.html"))
        self.assertNotIn("x{}", page["chunks"][0]["text"])
        self.assertEqual(page["chunks"][0]["section"], "Runbook")
        _, table = self.run_cli("chunks", self.pending_id(result, "owners.csv"))
        self.assertEqual(table["chunks"][0]["durable"], "yes")
        self.assertEqual(table["chunks"][1]["durable"], "no")

        derived = self.workspace / ".knowledge-extract" / "derived"
        self.assertTrue(any(path.name.endswith(".md") for path in derived.iterdir()))

    def test_secrets_are_refused_without_storing_text(self) -> None:
        (self.inbox / "runbook.md").write_text("# Login\npassword: hunter2hunter2hunter2\n", encoding="utf-8")
        result = self.scan()
        self.assertEqual(result["pending"], [])
        self.assertEqual(result["limits"][0]["status"], "refused")
        self.assertIn("assigned_secret", result["limits"][0]["reason"])
        self.assertFalse((self.workspace / ".knowledge-extract" / "derived").exists())
        manifest = (self.workspace / ".knowledge-extract" / "manifest.json").read_text(encoding="utf-8")
        self.assertNotIn("hunter2", manifest)

    def test_unsupported_and_empty_files_are_reported_as_limits(self) -> None:
        (self.inbox / "diagram.png").write_bytes(b"\x89PNG")
        (self.inbox / "blank.md").write_text("   \n", encoding="utf-8")
        result = self.scan()
        statuses = {Path(item["path"]).name: item["status"] for item in result["limits"]}
        self.assertEqual(statuses, {"diagram.png": "unsupported", "blank.md": "empty"})

    def test_rescan_skips_unchanged_and_reopens_changed_documents(self) -> None:
        source = self.inbox / "runbook-load.md"
        source.write_text("# Restart\nRerun the job.\n", encoding="utf-8")
        doc_id = self.pending_id(self.scan(), "runbook-load.md")
        self.write_concept("load-restart.md")
        self.link_from_index("load-restart.md")
        code, _ = self.run_cli("record", doc_id, "--result", "curated", "--concept", "load-restart.md")
        self.assertEqual(code, 0)

        again = self.scan()
        self.assertEqual((again["unchanged"], again["pending"]), (1, []))

        source.write_text("# Restart\nRerun the job, then check row counts.\n", encoding="utf-8")
        changed = self.scan()
        self.assertEqual(changed["changed"][0]["revisit"], ["load-restart.md"])
        self.assertEqual(changed["pending"][0]["id"], doc_id)

    def test_notes_are_unsure_and_logistics_are_not_durable(self) -> None:
        self.assertEqual(self.module.durability("meeting-notes.md", "Decisions", "document")[0], "unsure")
        self.assertEqual(self.module.durability("runbook.md", "Attendees", "document")[0], "no")
        self.assertEqual(self.module.durability("escalation-policy.md", "", "document")[0], "yes")
        self.assertEqual(self.module.durability("misc.md", "", "document")[0], "unsure")

    def test_check_blocks_until_every_document_is_resolved(self) -> None:
        (self.inbox / "runbook-load.md").write_text("# Restart\nRerun the job.\n", encoding="utf-8")
        (self.inbox / "standup-notes.md").write_text("# Attendees\nAna, Raj\n", encoding="utf-8")
        result = self.scan()
        code, report = self.run_cli("check")
        self.assertEqual(code, 1)
        self.assertEqual(len([e for e in report["errors"] if "is not resolved" in e]), 2)

        self.write_concept("load-restart.md")
        self.link_from_index("load-restart.md")
        self.run_cli("record", self.pending_id(result, "runbook-load.md"), "--result", "curated",
                     "--concept", "load-restart.md")
        self.run_cli("record", self.pending_id(result, "standup-notes.md"), "--result", "rejected",
                     "--reason", "meeting logistics only")
        code, report = self.run_cli("check")
        self.assertEqual((code, report["errors"]), (0, []))
        self.assertEqual(report["counts"], {"curated": 1, "rejected": 1})

    def test_check_rejects_badly_formed_concepts(self) -> None:
        (self.inbox / "runbook-load.md").write_text("# Restart\nRerun the job.\n", encoding="utf-8")
        doc_id = self.pending_id(self.scan(), "runbook-load.md")
        self.write_concept("load-restart.md", status="stable", cite="other.md",
                           body="See [missing](nowhere.md).[^gone]\n")
        self.run_cli("record", doc_id, "--result", "curated", "--concept", "load-restart.md")
        code, report = self.run_cli("check")
        self.assertEqual(code, 1)
        joined = "\n".join(report["errors"])
        for expected in ("must be status: draft", "does not cite its source", "broken link nowhere.md",
                         "footnote [^gone]"):
            self.assertIn(expected, joined)
        self.assertNotIn("not reachable", joined)
        self.assertTrue(any("not reachable from the root index.md yet" in w for w in report["warnings"]))

    def test_unlinked_draft_saved_by_the_host_passes_with_a_warning(self) -> None:
        # The app saves drafts through update_knowledge and links a page when a person keeps it.
        (self.inbox / "runbook-load.md").write_text("# Restart\nRerun the job.\n", encoding="utf-8")
        doc_id = self.pending_id(self.scan(), "runbook-load.md")
        self.write_concept("load-restart.md")
        self.run_cli("record", doc_id, "--result", "curated", "--concept", "load-restart.md")
        code, report = self.run_cli("check")
        self.assertEqual((code, report["errors"]), (0, []))
        self.assertEqual(len(report["warnings"]), 1)

    def test_draft_section_in_approved_concept_is_accepted(self) -> None:
        (self.inbox / "runbook-load.md").write_text("# Restart\nRerun the job.\n", encoding="utf-8")
        doc_id = self.pending_id(self.scan(), "runbook-load.md")
        self.write_concept("load-restart.md", status="stable",
                           body="<!-- draft source=inbox/runbook-load.md -->\n## Row check\n<!-- /draft -->\n")
        self.link_from_index("load-restart.md")
        self.run_cli("record", doc_id, "--result", "curated", "--concept", "load-restart.md")
        code, report = self.run_cli("check")
        self.assertEqual((code, report["errors"]), (0, []))

    def test_record_validates_arguments(self) -> None:
        (self.inbox / "runbook-load.md").write_text("# Restart\nRerun the job.\n", encoding="utf-8")
        doc_id = self.pending_id(self.scan(), "runbook-load.md")
        with self.assertRaises(SystemExit):
            self.run_cli("record", doc_id, "--result", "rejected")
        with self.assertRaises(SystemExit):
            self.run_cli("record", doc_id, "--result", "curated", "--concept", "missing.md")
        with self.assertRaises(SystemExit):
            self.run_cli("record", doc_id, "--result", "merged", "--concept", "../outside.md")
        with self.assertRaises(SystemExit):
            self.run_cli("record", "doc-000000000000", "--result", "rejected", "--reason", "x")

    def test_folder_outside_the_workspace_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as other, self.assertRaises(SystemExit):
            self.run_cli("scan", other)


if __name__ == "__main__":
    unittest.main()
