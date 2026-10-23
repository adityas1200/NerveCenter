#!/usr/bin/env python3
"""Create a small operations client workspace."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
TEMPLATE = SKILL_DIR / "assets" / "operations.template.yaml"

CLAUDE_MD = """# Operations workspace

Use `operations.yaml` for stable mappings, connection names, and authority boundaries. Use `knowledge/` or the configured knowledge MCP for SOPs, definitions, owners, runbooks, and templates.

Do not place credentials in this repository. Start with read-only work, read provider state back after material writes, and verify outcomes before claiming completion.
"""

GITIGNORE = """.env
.env.*
!.env.example
artifacts/
runs/
.knowledge-extract/
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    workspace = args.workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    destination = workspace / "operations.yaml"
    if destination.exists() and not args.force:
        raise SystemExit(f"{destination} already exists; use --force to replace it")

    shutil.copyfile(TEMPLATE, destination)
    for directory in ("knowledge", "workflows", "templates"):
        (workspace / directory).mkdir(exist_ok=True)
    for path, content in ((workspace / "CLAUDE.md", CLAUDE_MD), (workspace / ".gitignore", GITIGNORE)):
        if not path.exists() or args.force:
            path.write_text(content, encoding="utf-8")

    print(f"Created workspace at {workspace}")
    print("Next: ask the setup skill to complete operations.yaml for one read-only journey.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
