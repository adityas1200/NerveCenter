from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "setup" / "scripts" / "init_workspace.py"


class InitWorkspaceTest(unittest.TestCase):
    def test_initializer_creates_one_configuration_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp) / "client"
            result = subprocess.run(
                [sys.executable, str(SCRIPT), str(workspace)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertTrue((workspace / "operations.yaml").is_file())
            self.assertFalse((workspace / "config").exists())
            self.assertTrue((workspace / "knowledge").is_dir())
            self.assertTrue((workspace / "workflows").is_dir())
            value = yaml.safe_load((workspace / "operations.yaml").read_text(encoding="utf-8"))
            self.assertIn("team", value)
            self.assertIn("connections", value)


if __name__ == "__main__":
    unittest.main()
