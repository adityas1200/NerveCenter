from __future__ import annotations

import unittest
from pathlib import Path

from _helpers import load_module

ROOT = Path(__file__).resolve().parents[1]


class PluginStructureTest(unittest.TestCase):
    def test_repository_validator(self) -> None:
        validator = load_module("validate_plugin", ROOT / "tools" / "validate_plugin.py")
        self.assertEqual([], validator.validate())

    def test_single_plugin_manifest(self) -> None:
        manifests = list(ROOT.rglob(".claude-plugin/plugin.json"))
        self.assertEqual([ROOT / ".claude-plugin" / "plugin.json"], manifests)

    def test_orchestrator_enforces_knowledge_first_routing(self) -> None:
        text = (ROOT / "agents" / "orchestrator.md").read_text(encoding="utf-8").lower()
        operations_position = text.index("read `operations.yaml`")
        knowledge_position = text.index("retrieve relevant team knowledge")
        live_position = text.index("check current system state")
        skill_position = text.index("load the relevant task skill")
        self.assertLess(operations_position, knowledge_position)
        self.assertLess(knowledge_position, live_position)
        self.assertLess(live_position, skill_position)
        self.assertIn("root `index.md`", text)
        self.assertIn("approved_only", text)
        self.assertIn("human-reviewed", text)

    def test_orchestrate_is_the_fleet_entry_workflow(self) -> None:
        text = (ROOT / "skills" / "orchestrate" / "SKILL.md").read_text(
            encoding="utf-8"
        ).lower()
        self.assertIn("use for end-to-end requests", text)
        self.assertNotIn("fast path", text)
        self.assertIn("before loading a specialist skill", text)
        self.assertIn("selected knowledge, trust state, and applicability", text)
        self.assertIn("references/reply-format.md", text)

    def test_reply_contract_lives_in_one_place(self) -> None:
        text = (ROOT / "skills" / "orchestrate" / "references" / "reply-format.md").read_text(
            encoding="utf-8"
        ).lower()
        self.assertIn("## approvals and writes", text)
        self.assertIn("## one write-up file", text)
        self.assertNotIn("even under an `ask` or `allow`", text)

    def test_ticket_email_is_opt_in(self) -> None:
        for path in (ROOT / "skills").rglob("*.md"):
            text = path.read_text(encoding="utf-8").lower()
            self.assertNotIn("notification contract", text, str(path))
            self.assertNotIn("incomplete: notification pending", text, str(path))


if __name__ == "__main__":
    unittest.main()
