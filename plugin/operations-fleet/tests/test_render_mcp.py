from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

from _helpers import load_module

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "setup" / "scripts" / "render_mcp.py"
EXAMPLE = ROOT / "examples" / "client-workspace" / "operations.yaml"


class RenderMcpTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module("render_mcp", SCRIPT)

    def test_only_mcp_connections_are_rendered(self) -> None:
        value = yaml.safe_load(EXAMPLE.read_text(encoding="utf-8"))
        output = self.module.render(value)
        self.assertEqual({"databricks", "jira", "knowledge"}, set(output["mcpServers"]))
        self.assertNotIn("github", output["mcpServers"])
        self.assertNotIn("microsoft", output["mcpServers"])

    def test_render_is_deterministic(self) -> None:
        value = self.module.load_operations(EXAMPLE)
        first = self.module.serialized(self.module.render(value))
        second = self.module.serialized(self.module.render(value))
        self.assertEqual(first, second)
        self.assertEqual(first, json.dumps(json.loads(first), indent=2, sort_keys=True) + "\n")

    def test_workspace_directory_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp) / "client"
            workspace.mkdir()
            (workspace / "operations.yaml").write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), str(workspace)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertTrue((workspace / ".mcp.json").is_file())

    def test_stdio_connection_requires_command(self) -> None:
        value = {"connections": {"local": {"kind": "mcp", "transport": "stdio"}}}
        with self.assertRaisesRegex(ValueError, "requires command"):
            self.module.render(value)


if __name__ == "__main__":
    unittest.main()
