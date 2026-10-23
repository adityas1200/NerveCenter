from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from email import policy
from email.parser import BytesParser
from pathlib import Path
from unittest import mock

from _helpers import load_module

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "communication" / "scripts"


def load(name: str):
    return load_module(name, SCRIPTS / f"{name}.py")


CONTENT = {
    "brand": {"name": "Acme Ops", "accent": "#4F46E5"},
    "status": {"label": "Fix applied, not yet verified", "tone": "warning"},
    "title": "Veltrix sales load failed",
    "summary": "Run `88213` failed at 06:12 IST. **Dashboards stop at 21 Sep.**",
    "metrics": [{"label": "Rows loaded", "value": "0", "note": "expected ~48,000", "tone": "bad"}],
    "sections": [
        {"heading": "Runs", "table": {"columns": ["Run", "State", "Rows"], "rows": [["88212", "Succeeded", "48,102"], ["88213", "Failed", "0"]]}},
        {"heading": "Share", "bars": {"unit": "%", "items": [{"label": "North", "value": 42}, {"label": "South", "value": 21}]}},
    ],
    "actions": [{"text": "Approve the mapping fix", "owner": "Sofia Reyes", "due": "23 Sep"}],
    "links": [{"label": "Full RCA", "url": "https://example.com/rca"}],
}


class RenderEmailTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load("render_email")

    def test_html_and_text_carry_the_same_facts(self) -> None:
        document, body, warnings = self.module.render(CONTENT)
        for fact in ("88213", "06:12 IST", "48,102", "Approve the mapping fix", "Sofia Reyes", "https://example.com/rca", "42%"):
            self.assertIn(fact, document)
            self.assertIn(fact, body)
        self.assertEqual(warnings, [])
        self.assertIn("#4F46E5", document)
        self.assertNotIn("<style", document)
        self.assertNotIn("**", body)

    def test_markup_is_escaped(self) -> None:
        content = {**CONTENT, "title": "<script>alert(1)</script>", "summary": "a <b>b</b>"}
        document, _, _ = self.module.render(content)
        self.assertNotIn("<script>", document)
        self.assertIn("&lt;script&gt;", document)

    def test_unsafe_link_and_colour_are_rejected(self) -> None:
        with self.assertRaises(self.module.RenderError):
            self.module.render({**CONTENT, "links": [{"label": "x", "url": "javascript:alert(1)"}]})
        with self.assertRaises(self.module.RenderError):
            self.module.render({**CONTENT, "brand": {"accent": "red;background:url(x)"}})

    def test_long_table_warns(self) -> None:
        rows = [[str(i), "Succeeded", "1"] for i in range(20)]
        content = {**CONTENT, "sections": [{"table": {"columns": ["Run", "State", "Rows"], "rows": rows}}]}
        _, _, warnings = self.module.render(content)
        self.assertTrue(any("attachment" in warning for warning in warnings))


class FakeSmtp:
    sent: list[tuple[str, list[str]]] = []
    connections: list[tuple] = []
    starttls_called = False

    def __init__(self, *args, **kwargs) -> None:
        FakeSmtp.connections.append((*args, kwargs.get("timeout")))

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def ehlo(self) -> None:
        pass

    def starttls(self, **kwargs) -> None:
        FakeSmtp.starttls_called = True

    def login(self, user: str, password: str) -> None:
        pass

    def send_message(self, message, from_addr: str, to_addrs: list[str]):
        FakeSmtp.sent.append((from_addr, list(to_addrs)))
        return {}


class SendEmailTest(unittest.TestCase):
    def setUp(self) -> None:
        self.preview = load("build_preview")
        self.render = load("render_email")
        self.module = load("send_email")
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name).resolve()
        task = self.workspace / "tasks" / "T-1"
        task.mkdir(parents=True)
        document, body, _ = self.render.render(CONTENT)
        (task / "email.html").write_text(document, encoding="utf-8")
        (task / "email.txt").write_text(body, encoding="utf-8")
        self.manifest = self.preview.build_preview(self.workspace, {
            "case_id": "T-1", "preview_id": "update",
            "from": "ops@example.com", "to": ["team@example.com"], "bcc": ["audit@example.com"],
            "subject": "[INC1] Veltrix sales load failed",
            "html_path": "tasks/T-1/email.html", "text_path": "tasks/T-1/email.txt",
            "output_dir": "tasks/T-1/email-preview",
        })
        self.manifest_path = Path("tasks/T-1/email-preview/manifest.json")
        self.env = {"SMTP_HOST": "smtp.example.com"}
        FakeSmtp.sent = []
        FakeSmtp.connections = []
        FakeSmtp.starttls_called = False

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_operations(self, **communication) -> Path:
        operations = self.workspace / "operations.yaml"
        config = {
            "communication": {
                "platform": "smtp",
                "notifications_enabled": True,
                "sender": "ops@example.com",
                "recipient_groups": {"team": ["team@example.com"]},
                "smtp": {"host": "10.0.0.9", "port": 25, "use_tls": False},
                **communication,
            },
            "policy": {"email_send": "ask", "external_recipients": "deny"},
        }
        operations.write_text(json.dumps(config), encoding="utf-8")  # JSON is valid YAML
        return operations

    def test_sender_domain_counts_as_internal(self) -> None:
        config = self.module.load_config(self.write_operations(), {})
        self.assertIn("example.com", config["internal_domains"])
        self.assertTrue(self.module.allowed("colleague@example.com", config["internal_domains"]))
        self.assertFalse(self.module.allowed("someone@vendor.example", config["internal_domains"]))

    def test_environment_overrides_the_server(self) -> None:
        env = {"SMTP_HOST": "10.121.0.205", "SMTP_PORT": "25", "SMTP_USE_TLS": "false", "EMAIL_NOTIFICATIONS_ENABLED": "true", "EMAIL_PROVIDER": "smtp"}
        config = self.module.load_config(self.write_operations(notifications_enabled=False, smtp={"host": "old.example", "port": 587, "use_tls": True}), env)
        self.assertEqual((config["host"], config["port"], config["use_tls"]), ("10.121.0.205", 25, False))

    def test_unreachable_server_fails_fast_with_one_plain_sentence(self) -> None:
        def timeout(*args, **kwargs):
            raise self.module.socket.timeout("timed out")

        with mock.patch.object(self.module.socket, "create_connection", side_effect=timeout):
            with self.assertRaises(self.module.SendError) as failure:
                self.module.preflight("10.121.0.205", 25, timeout=1)
        message = str(failure.exception)
        self.assertIn("10.121.0.205:25 did not answer within 1 seconds", message)
        self.assertIn("do not try another server", message)

    def test_approved_preview_is_not_attempted_when_the_server_is_down(self) -> None:
        operations = self.write_operations()
        with mock.patch.object(self.module, "preflight", side_effect=self.module.SendError("SMTP server 10.0.0.9:25 did not answer")):
            with self.assertRaises(self.module.SendError):
                self.module.send_preview(self.workspace, operations, self.manifest_path, self.manifest["eml_sha256"], True, {}, smtp_factory=FakeSmtp)
        self.assertFalse((self.workspace / "tasks/T-1/email-preview/send-record.json").exists(), "no ambiguous send record is left behind")
        self.assertEqual(FakeSmtp.sent, [])

    def test_approved_preview_sends_once_the_server_answers(self) -> None:
        operations = self.write_operations()
        with mock.patch.object(self.module, "preflight", return_value="220 relay ready"):
            record = self.module.send_preview(self.workspace, operations, self.manifest_path, self.manifest["eml_sha256"], True, {}, smtp_factory=FakeSmtp)
        self.assertEqual(record["status"], "sent")
        self.assertEqual(FakeSmtp.sent, [("ops@example.com", ["team@example.com", "audit@example.com"])])

    def test_approved_preview_connects_with_the_configured_server_and_all_recipients(self) -> None:
        manifest = self.preview.build_preview(self.workspace, {
            "case_id": "T-1", "preview_id": "with-cc", "from": "ops@example.com",
            "to": ["team@example.com"], "cc": ["ops@example.com"],
            "subject": "Local test", "text": "This is a local test preview.",
        })
        operations = self.write_operations(smtp={"host": "10.121.0.205", "port": 25, "use_tls": False})
        with mock.patch.object(self.module, "preflight", return_value="220 ok"):
            record = self.module.send_preview(self.workspace, operations, Path("artifacts/T-1/with-cc/manifest.json"), manifest["eml_sha256"], True, {}, smtp_factory=FakeSmtp)
        self.assertEqual(record["status"], "sent")
        self.assertEqual(FakeSmtp.connections, [("10.121.0.205", 25, 30)])
        self.assertFalse(FakeSmtp.starttls_called)
        self.assertEqual(FakeSmtp.sent, [("ops@example.com", ["team@example.com", "ops@example.com"])])

    def test_internal_domain_recipients_are_allowed_without_a_named_group(self) -> None:
        operations = self.write_operations(recipient_groups={}, internal_domains=["example.com"])

        def preview(preview_id: str, to: str):
            return self.preview.build_preview(self.workspace, {
                "case_id": "T-1", "preview_id": preview_id, "from": "ops@example.com",
                "to": [to], "subject": "Domain test", "text": "Recipient domain check.",
            })

        def send(preview_id: str, manifest: dict):
            with mock.patch.object(self.module, "preflight", return_value="220 ok"):
                return self.module.send_preview(self.workspace, operations, Path(f"artifacts/T-1/{preview_id}/manifest.json"), manifest["eml_sha256"], True, {}, smtp_factory=FakeSmtp)

        self.assertEqual(send("inside", preview("inside", "colleague@example.com"))["status"], "sent")
        self.assertEqual(FakeSmtp.sent, [("ops@example.com", ["colleague@example.com"])])
        with self.assertRaisesRegex(self.module.SendError, "outside the configured internal groups and domains"):
            send("outside", preview("outside", "someone@example.org"))

    def test_unapproved_preview_hash_is_rejected_before_smtp(self) -> None:
        operations = self.write_operations()
        with mock.patch.object(self.module, "preflight", return_value="220 ok"):
            with self.assertRaisesRegex(self.module.SendError, "preview hash"):
                self.module.send_preview(self.workspace, operations, self.manifest_path, "0" * 64, True, {}, smtp_factory=FakeSmtp)
        self.assertEqual(FakeSmtp.connections, [])
        self.assertFalse((self.workspace / "tasks/T-1/email-preview/send-record.json").exists())

    def write_artifact(self, name: str, payload: bytes) -> Path:
        deliverable = self.workspace / "deliverables" / name
        deliverable.parent.mkdir(exist_ok=True)
        deliverable.write_bytes(payload)
        manifest = self.workspace / "artifacts" / "T-1" / f"{name}.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps({
            "id": f"{name}-v1", "state": "ready", "location": f"deliverables/{name}",
            "media_type": "application/pdf", "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }), encoding="utf-8")
        return deliverable

    def test_template_attaches_reviewed_document_manifest(self) -> None:
        self.write_artifact("incident-report.pdf", b"reviewed report bytes")
        manifest = self.preview.build_preview(self.workspace, {
            "case_id": "T-1", "preview_id": "document-delivery",
            "from": "ops@example.com", "to": ["team@example.com"],
            "template": {"name": "document-delivery", "variables": {
                "case_id": "T-1", "short_outcome": "incident report",
                "status": "Done and independently verified",
                "completed": "The report covers orders < 100.",
                "verification": "Totals reconciled to the source.",
                "deliverables": "incident-report.pdf",
                "action_required": "No action required.", "reference": "T-1",
            }},
            "attachments": [{"manifest": "artifacts/T-1/incident-report.pdf.json"}],
        })
        self.assertEqual(manifest["template"]["name"], "document-delivery")
        attachment = manifest["attachments"][0]
        self.assertEqual(attachment["name"], "incident-report.pdf")
        self.assertEqual(attachment["source_manifest"], "artifacts/T-1/incident-report.pdf.json")
        message = BytesParser(policy=policy.default).parsebytes((self.workspace / manifest["eml"]).read_bytes())
        self.assertEqual(message["Subject"], "Deliverable ready: T-1 - incident report")
        self.assertIn("The report covers orders < 100.", message.get_body(preferencelist=("plain",)).get_content())
        self.assertIn("orders &lt; 100", message.get_body(preferencelist=("html",)).get_content())
        self.assertEqual(next(message.iter_attachments()).get_filename(), "incident-report.pdf")

    def test_document_changed_after_artifact_manifest_is_rejected(self) -> None:
        deliverable = self.write_artifact("report.pdf", b"reviewed")
        deliverable.write_bytes(b"changed after review")
        with self.assertRaisesRegex(ValueError, "changed after review"):
            self.preview.build_preview(self.workspace, {
                "case_id": "T-1", "preview_id": "tampered-document",
                "from": "ops@example.com", "to": ["team@example.com"],
                "subject": "Report", "text": "Attached.",
                "attachments": [{"manifest": "artifacts/T-1/report.pdf.json"}],
            })

    def test_check_reports_the_resolved_server(self) -> None:
        operations = self.write_operations()
        with mock.patch.object(self.module, "preflight", return_value="220 relay ready"):
            result = self.module.check(operations, {"SMTP_HOST": "10.121.0.205"})
        self.assertEqual(result["server"], "10.121.0.205:25")
        self.assertTrue(result["reachable"])

    def test_preview_uses_body_files_and_task_folder(self) -> None:
        self.assertEqual(self.manifest["eml"], "tasks/T-1/email-preview/message.eml")
        self.assertEqual(self.manifest["bcc"], ["audit@example.com"])
        eml = (self.workspace / self.manifest["eml"]).read_text(encoding="utf-8")
        self.assertIn("text/html", eml)
        self.assertNotIn("audit@example.com", eml)

    def deliver(self, env: dict, **smtp):
        operations = self.write_operations(smtp={"host": "smtp.example.com", **smtp})
        with mock.patch.object(self.module, "preflight", return_value="220 ok"):
            return self.module.send_preview(self.workspace, operations, self.manifest_path, self.manifest["eml_sha256"], True, env)

    def test_ssl_security_uses_smtp_ssl_on_the_default_port(self) -> None:
        with mock.patch.object(self.module.smtplib, "SMTP_SSL", FakeSmtp), mock.patch.object(self.module.smtplib, "SMTP", side_effect=AssertionError("plain SMTP")):
            record = self.deliver({"SMTP_SECURITY": "ssl"})
        self.assertEqual(record["status"], "sent")
        self.assertEqual(FakeSmtp.connections, [("smtp.example.com", 465, 30)])
        self.assertFalse(FakeSmtp.starttls_called)

    def test_starttls_security_upgrades_the_connection(self) -> None:
        with mock.patch.object(self.module.smtplib, "SMTP", FakeSmtp):
            self.deliver({"SMTP_SECURITY": "starttls"})
        self.assertEqual(FakeSmtp.connections, [("smtp.example.com", 587, 30)])
        self.assertTrue(FakeSmtp.starttls_called)

    def test_use_tls_still_means_starttls_and_an_explicit_port_wins(self) -> None:
        with mock.patch.object(self.module.smtplib, "SMTP", FakeSmtp):
            self.deliver({"SMTP_USE_TLS": "true", "SMTP_PORT": "2525"})
        self.assertEqual(FakeSmtp.connections, [("smtp.example.com", 2525, 30)])
        self.assertTrue(FakeSmtp.starttls_called)
        config = self.module.load_config(self.write_operations(smtp={"host": "h", "use_tls": True}), {})
        self.assertEqual((config["security"], config["port"]), ("starttls", 25))
        config = self.module.load_config(self.write_operations(smtp={"host": "h", "security": "ssl", "port": 990}), {})
        self.assertEqual((config["security"], config["port"]), ("ssl", 990))

    def test_username_logs_in_with_the_credentials(self) -> None:
        logins = []
        with mock.patch.object(self.module.smtplib, "SMTP", FakeSmtp), mock.patch.object(FakeSmtp, "login", lambda self, user, password: logins.append((user, password))):
            self.deliver({"SMTP_SECURITY": "starttls", "SMTP_USERNAME": "mailer", "SMTP_PASSWORD": "s3cret"})
        self.assertEqual(logins, [("mailer", "s3cret")])
        self.assertEqual(FakeSmtp.sent, [("ops@example.com", ["team@example.com", "audit@example.com"])])

    def test_no_username_means_no_login(self) -> None:
        with mock.patch.object(self.module.smtplib, "SMTP", FakeSmtp), mock.patch.object(FakeSmtp, "login", side_effect=AssertionError("login")):
            self.deliver({"SMTP_SECURITY": "starttls"})

    def test_password_without_tls_is_refused_unless_loopback(self) -> None:
        env = {"SMTP_USERNAME": "mailer", "SMTP_PASSWORD": "s3cret"}
        with mock.patch.object(self.module, "loopback", return_value=False):
            with self.assertRaisesRegex(self.module.SendError, "without TLS"):
                self.deliver(env)
        self.assertEqual(FakeSmtp.connections, [])
        with mock.patch.object(self.module, "loopback", return_value=True), mock.patch.object(self.module.smtplib, "SMTP", FakeSmtp):
            self.assertEqual(self.deliver(env)["status"], "sent")

if __name__ == "__main__":
    unittest.main()
