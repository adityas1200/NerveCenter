#!/usr/bin/env python3
"""Validate the single-plugin Operations Fleet source tree."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required: python -m pip install -r requirements-dev.txt") from exc

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SKILLS = {
    "access",
    "ask-data",
    "build",
    "communication",
    "data-pull",
    "documents",
    "evaluate",
    "knowledge",
    "knowledge-build",
    "knowledge-eval",
    "knowledge-extract",
    "knowledge-pass",
    "lineage-impact",
    "monitoring",
    "orchestrate",
    "rca",
    "remediation",
    "research",
    "setup",
    "tickets",
    "unslop",
    "verification",
    "workflow",
}
SKILL_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER = re.compile(r"\A---\n(.*?)\n---(?:\n|\Z)", re.DOTALL)
LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
ALLOWED_SKILL_FIELDS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
FORBIDDEN_DIRS = {"packages", "dist", "artifacts", "runs", "legacy"}
FORBIDDEN_FILES = {"VERSION", "MANIFEST.sha256", "CHANGELOG.md"}


def parse_frontmatter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER.match(text)
    if not match:
        raise ValueError("missing YAML frontmatter")
    value = yaml.safe_load(match.group(1)) or {}
    if not isinstance(value, dict):
        raise ValueError("frontmatter must be a mapping")
    return value


def active_files() -> list[Path]:
    ignored = {".git", ".venv", "__pycache__"}
    return [
        path
        for path in ROOT.rglob("*")
        if path.is_file() and not any(part in ignored for part in path.relative_to(ROOT).parts)
    ]


def validate() -> list[str]:
    errors: list[str] = []

    manifest_path = ROOT / ".claude-plugin" / "plugin.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("name") != "operations-fleet":
            errors.append("plugin name must be operations-fleet")
        if "version" in manifest:
            errors.append("do not force version metadata into the active source manifest")
    except Exception as exc:
        errors.append(f"invalid plugin manifest: {exc}")

    for name in FORBIDDEN_DIRS:
        if (ROOT / name).exists():
            errors.append(f"unnecessary top-level directory present: {name}")
    for name in FORBIDDEN_FILES:
        if (ROOT / name).exists():
            errors.append(f"unnecessary release metadata present: {name}")
    for path in ROOT.rglob("*.zip"):
        errors.append(f"archive committed inside source: {path.relative_to(ROOT)}")

    skill_paths = sorted((ROOT / "skills").glob("*/SKILL.md"))
    skill_names = {path.parent.name for path in skill_paths}
    if skill_names != EXPECTED_SKILLS:
        errors.append(
            f"skill set mismatch: expected={sorted(EXPECTED_SKILLS)} actual={sorted(skill_names)}"
        )

    for path in skill_paths:
        try:
            data = parse_frontmatter(path)
            name = path.parent.name
            if data.get("name") != name:
                errors.append(f"{path.relative_to(ROOT)} name must be {name}")
            if not SKILL_NAME.fullmatch(name) or len(name) > 64:
                errors.append(f"{path.relative_to(ROOT)} has an invalid skill name")
            description = data.get("description")
            if not isinstance(description, str) or not description.strip():
                errors.append(f"{path.relative_to(ROOT)} needs a useful description")
            else:
                if len(description) < 80:
                    errors.append(f"{path.relative_to(ROOT)} description is too vague")
                if "use" not in description.lower():
                    errors.append(f"{path.relative_to(ROOT)} description must say when to use it")
                if len(description) > 1024:
                    errors.append(f"{path.relative_to(ROOT)} description exceeds 1024 characters")
            extra = set(data) - ALLOWED_SKILL_FIELDS
            if extra:
                errors.append(f"{path.relative_to(ROOT)} has unsupported frontmatter: {sorted(extra)}")
            line_count = path.read_text(encoding="utf-8").count("\n") + 1
            if line_count > 150:
                errors.append(f"{path.relative_to(ROOT)} is too long ({line_count} lines)")
        except Exception as exc:
            errors.append(f"invalid skill {path.relative_to(ROOT)}: {exc}")

    research_path = ROOT / "skills" / "research" / "SKILL.md"
    if research_path.is_file():
        research = parse_frontmatter(research_path)
        allowed = str(research.get("allowed-tools", ""))
        for tool in ("WebSearch", "WebFetch"):
            if tool not in allowed:
                errors.append(f"research skill must pre-approve {tool}")

    agent_paths = sorted((ROOT / "agents").glob("*.md"))
    if [path.name for path in agent_paths] != ["orchestrator.md"]:
        errors.append("keep exactly one plugin agent: agents/orchestrator.md")
    else:
        try:
            agent = parse_frontmatter(agent_paths[0])
            if agent.get("name") != "orchestrator":
                errors.append("main agent name must be orchestrator")
            agent_text = agent_paths[0].read_text(encoding="utf-8")
            for phrase in ("web research", "operations.yaml", "untrusted data"):
                if phrase not in agent_text.lower():
                    errors.append(f"orchestrator is missing required guidance: {phrase}")
        except Exception as exc:
            errors.append(f"invalid orchestrator agent: {exc}")

    try:
        settings = json.loads((ROOT / "settings.json").read_text(encoding="utf-8"))
        if settings != {"agent": "orchestrator"}:
            errors.append("settings.json should activate only the orchestrator agent")
    except Exception as exc:
        errors.append(f"invalid settings.json: {exc}")

    example = ROOT / "examples" / "client-workspace"
    if (example / "config").exists():
        errors.append("client workspace must use one operations.yaml file, not config/")
    if not (example / "operations.yaml").is_file():
        errors.append("example client workspace is missing operations.yaml")
    else:
        try:
            operations = yaml.safe_load((example / "operations.yaml").read_text(encoding="utf-8"))
            if not isinstance(operations, dict):
                errors.append("example operations.yaml must contain a mapping")
            elif "capabilities" in operations:
                errors.append("example operations.yaml must not expose a capabilities read/write matrix")
        except Exception as exc:
            errors.append(f"invalid example operations.yaml: {exc}")

    required_setup_files = [
        ROOT / "skills" / "setup" / "assets" / "operations.template.yaml",
        ROOT / "skills" / "setup" / "scripts" / "init_workspace.py",
        ROOT / "skills" / "setup" / "scripts" / "render_mcp.py",
        ROOT / "skills" / "setup" / "scripts" / "check_workspace.py",
    ]
    for path in required_setup_files:
        if not path.is_file():
            errors.append(f"missing setup component: {path.relative_to(ROOT)}")

    eval_root = ROOT / "evals"
    eval_dirs = [path for path in eval_root.iterdir() if path.is_dir() and path.name != "results"]
    for case_dir in sorted(eval_dirs):
        prompt = case_dir / "prompt.md"
        graders = case_dir / "graders"
        if not prompt.is_file():
            errors.append(f"eval case missing prompt.md: {case_dir.relative_to(ROOT)}")
        if not graders.is_dir() or not list(graders.glob("*.md")):
            errors.append(f"eval case needs graders: {case_dir.relative_to(ROOT)}")
        if prompt.is_file():
            try:
                parse_frontmatter(prompt)
            except Exception as exc:
                errors.append(f"invalid eval prompt {prompt.relative_to(ROOT)}: {exc}")
        if graders.is_dir():
            for grader in graders.glob("*.md"):
                try:
                    parse_frontmatter(grader)
                except Exception as exc:
                    errors.append(f"invalid eval grader {grader.relative_to(ROOT)}: {exc}")

    for path in active_files():
        rel = path.relative_to(ROOT)
        if path.suffix.lower() == ".json":
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                errors.append(f"invalid JSON {rel}: {exc}")
        if path.suffix.lower() in {".yaml", ".yml"}:
            try:
                yaml.safe_load(path.read_text(encoding="utf-8"))
            except Exception as exc:
                errors.append(f"invalid YAML {rel}: {exc}")
        if path.suffix.lower() == ".md":
            text = path.read_text(encoding="utf-8")
            # Tool names (`mcp__nervecenter__*`) are the host's API, not prose about the old product.
            if "nervecenter" in re.sub(r"mcp__nervecenter__\w*", "", text).lower():
                errors.append(f"old product name remains in {rel}")
            for raw_target in LINK.findall(text):
                target = raw_target.split("#", 1)[0].strip()
                if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                    continue
                target_path = (path.parent / target).resolve()
                try:
                    target_path.relative_to(ROOT.resolve())
                except ValueError:
                    errors.append(f"link escapes repository in {rel}: {raw_target}")
                    continue
                if not target_path.exists():
                    errors.append(f"broken link in {rel}: {raw_target}")

    return errors


def main() -> int:
    errors = validate()
    if errors:
        print("Plugin validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Plugin validation passed: 1 plugin, {len(EXPECTED_SKILLS)} skills, 1 orchestrator")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
