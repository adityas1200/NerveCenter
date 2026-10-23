from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

from _helpers import load_module

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "setup" / "scripts" / "check_workspace.py"
EXAMPLE = ROOT / "examples" / "client-workspace"


class WorkspaceCheckTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module("check_workspace", SCRIPT)
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name) / "client"
        shutil.copytree(EXAMPLE, self.workspace)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def read_operations(self):
        path = self.workspace / "operations.yaml"
        return path, yaml.safe_load(path.read_text(encoding="utf-8"))

    def write_operations(self, value):
        path = self.workspace / "operations.yaml"
        path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")

    def test_example_workspace_passes_local_checks(self) -> None:
        errors, warnings = self.module.validate_workspace(self.workspace)
        self.assertEqual([], errors)
        self.assertIsInstance(warnings, list)

    def test_unknown_connection_is_rejected(self) -> None:
        _, value = self.read_operations()
        value["ticketing"]["connection"] = "imaginary"
        self.write_operations(value)
        errors, _ = self.module.validate_workspace(self.workspace)
        self.assertTrue(any("unknown connection" in error for error in errors))

    def test_likely_secret_is_rejected(self) -> None:
        _, value = self.read_operations()
        value["connections"]["jira"]["api_token"] = "sk-example123456789012"
        self.write_operations(value)
        errors, _ = self.module.validate_workspace(self.workspace)
        self.assertTrue(any("secret" in error for error in errors))

    def test_environment_placeholder_is_allowed(self) -> None:
        _, value = self.read_operations()
        value["connections"]["jira"]["api_token"] = "${JIRA_TOKEN}"
        self.write_operations(value)
        errors, _ = self.module.validate_workspace(self.workspace)
        self.assertFalse(any("secret" in error for error in errors))

    def test_stale_mcp_file_is_reported(self) -> None:
        mcp = self.workspace / ".mcp.json.example"
        mcp.write_text('{"mcpServers": {}}\n', encoding="utf-8")
        errors, warnings = self.module.validate_workspace(self.workspace)
        self.assertEqual([], errors)
        self.assertTrue(any("does not match" in warning for warning in warnings))

    def test_workflow_success_must_be_non_empty(self) -> None:
        workflow = self.workspace / "workflows" / "bad.yaml"
        workflow.write_text(
            "name: bad\nobjective: bad\ntrigger: {type: manual}\nsuccess: []\n",
            encoding="utf-8",
        )
        errors, _ = self.module.validate_workspace(self.workspace)
        self.assertTrue(any("success must be a non-empty list" in error for error in errors))

    def test_smtp_connection_and_host_sections_are_accepted(self) -> None:
        _, value = self.read_operations()
        value["connections"]["email"] = {"kind": "smtp", "env": {"SMTP_HOST": "${SMTP_HOST}"}}
        for section in ("sync", "connectors", "ui", "agent"):
            value[section] = {}
        value["policy"]["rules"] = []
        self.write_operations(value)
        errors, warnings = self.module.validate_workspace(self.workspace)
        self.assertEqual([], errors)
        self.assertFalse(any("unrecognized top-level" in warning for warning in warnings))


if __name__ == "__main__":
    unittest.main()
