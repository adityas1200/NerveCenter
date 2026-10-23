#!/usr/bin/env python3
"""Run safe local checks on an operations workspace.

The script reads only local files. It never connects to a provider and never
performs a business write.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required: python -m pip install pyyaml") from exc

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
SECRET_KEY = re.compile(
    r"(^|_)(password|passwd|token|secret|client_secret|private_key|api_key|access_key)($|_)",
    re.IGNORECASE,
)
SECRET_VALUE = re.compile(
    r"(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|[^A-Za-z])(?:ghp|github_pat|xox[baprs]|sk)-[A-Za-z0-9_-]{12,})"
)
PLACEHOLDER = re.compile(r"^(?:\$\{[A-Z][A-Z0-9_]*(?::-[^}]*)?\}|<[^>]+>|REPLACE_ME)$")
FRONTMATTER = re.compile(r"\A---\n(.*?)\n---(?:\n|\Z)", re.DOTALL)
WORKFLOW_REQUIRED = {"name", "objective", "trigger", "success"}
TOP_LEVEL = {
    "team",
    "ticketing",
    "platforms",
    "identity",
    "source_control",
    "documents",
    "communication",
    "knowledge",
    "policy",
    "connections",
    "routines",
    "branding",
}
# Sections a host app may add and own (sync state, connector settings, UI, model choice).
HOST_SECTIONS = {"agent", "sync", "connectors", "ui"}
CONNECTION_KINDS = {"mcp", "cli", "api", "native", "smtp"}
MCP_TRANSPORTS = {"http", "sse", "ws", "stdio"}
POLICY_VALUES = {"allow", "ask", "deny", "verified-only"}
POLICY_CATEGORIES = {
    "email_send",
    "privileged_access",
    "production_changes",
    "ticket_writes",
    "workspace_changes",
    "knowledge_drafts",
    "default_write",
}


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def is_placeholder(value: Any) -> bool:
    return isinstance(value, str) and bool(PLACEHOLDER.fullmatch(value.strip()))


def scan_secrets(value: Any, location: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for raw_key, child in value.items():
            key = str(raw_key)
            child_location = f"{location}.{key}" if location else key
            if SECRET_KEY.search(key) and child not in (None, "", False):
                if not is_placeholder(child):
                    errors.append(f"possible committed secret at {child_location}")
            scan_secrets(child, child_location, errors)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            scan_secrets(child, f"{location}[{index}]", errors)
    elif isinstance(value, str) and SECRET_VALUE.search(value):
        errors.append(f"possible committed secret value at {location}")


def iter_connection_refs(value: Any, location: str = "") -> Iterable[tuple[str, Any]]:
    if isinstance(value, dict):
        for raw_key, child in value.items():
            key = str(raw_key)
            child_location = f"{location}.{key}" if location else key
            if key == "connection":
                yield child_location, child
            yield from iter_connection_refs(child, child_location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_connection_refs(child, f"{location}[{index}]")


def validate_connection(name: str, value: Any, errors: list[str], warnings: list[str]) -> None:
    location = f"operations.yaml.connections.{name}"
    if not isinstance(value, dict):
        errors.append(f"{location} must be a mapping")
        return

    kind = value.get("kind")
    if kind not in CONNECTION_KINDS:
        errors.append(f"{location}.kind must be one of {', '.join(sorted(CONNECTION_KINDS))}")
        return

    if value.get("enabled") is False:
        return

    if kind == "mcp":
        transport = value.get("transport")
        if transport not in MCP_TRANSPORTS:
            errors.append(
                f"{location}.transport must be one of {', '.join(sorted(MCP_TRANSPORTS))}"
            )
        elif transport == "stdio":
            if not isinstance(value.get("command"), str) or not value.get("command", "").strip():
                errors.append(f"{location}.command is required for stdio MCP")
            if "args" in value and not isinstance(value["args"], list):
                errors.append(f"{location}.args must be a list")
        else:
            if not isinstance(value.get("url"), str) or not value.get("url", "").strip():
                errors.append(f"{location}.url is required for {transport or 'remote'} MCP")
        for field in ("headers", "env", "oauth"):
            if field in value and not isinstance(value[field], dict):
                errors.append(f"{location}.{field} must be a mapping")
    elif kind == "cli":
        if not isinstance(value.get("command"), str) or not value.get("command", "").strip():
            errors.append(f"{location}.command is required for a CLI connection")
    elif kind == "api":
        if not value.get("base_url") and not value.get("provider"):
            warnings.append(f"{location} has no base_url or provider name")
    elif kind == "smtp":
        if "env" in value and not isinstance(value["env"], dict):
            errors.append(f"{location}.env must be a mapping")


def validate_operations(value: Any, workspace: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(value, dict):
        return ["operations.yaml must contain a mapping"], warnings

    unknown = sorted(set(value) - TOP_LEVEL - HOST_SECTIONS)
    if unknown:
        warnings.append(f"operations.yaml has unrecognized top-level sections: {', '.join(unknown)}")

    team = value.get("team")
    if not isinstance(team, dict):
        errors.append("operations.yaml.team must be a mapping")
    else:
        if not str(team.get("name", "")).strip():
            errors.append("operations.yaml.team.name is required")
        if not str(team.get("timezone", "")).strip():
            errors.append("operations.yaml.team.timezone is required")

    connections = value.get("connections", {})
    if connections is None:
        connections = {}
    if not isinstance(connections, dict):
        errors.append("operations.yaml.connections must be a mapping")
        connections = {}
    else:
        for name, connection in connections.items():
            validate_connection(str(name), connection, errors, warnings)

    for location, reference in iter_connection_refs(value):
        if reference in (None, ""):
            warnings.append(f"{location} is not configured")
        elif not isinstance(reference, str):
            errors.append(f"{location} must be a connection name")
        elif reference not in connections:
            errors.append(f"{location} references unknown connection: {reference}")

    platforms = value.get("platforms", [])
    if platforms is not None and not isinstance(platforms, list):
        errors.append("operations.yaml.platforms must be a list")
    elif isinstance(platforms, list):
        names: set[str] = set()
        for index, platform in enumerate(platforms):
            location = f"operations.yaml.platforms[{index}]"
            if not isinstance(platform, dict):
                errors.append(f"{location} must be a mapping")
                continue
            name = str(platform.get("name", "")).strip()
            if not name:
                errors.append(f"{location}.name is required")
            elif name in names:
                errors.append(f"duplicate platform name: {name}")
            names.add(name)
            if not str(platform.get("type", "")).strip():
                errors.append(f"{location}.type is required")

    policy = value.get("policy", {})
    if not isinstance(policy, dict):
        errors.append("operations.yaml.policy must be a mapping")
    else:
        for key, item in policy.items():
            if key == "rules":
                if item is not None and not isinstance(item, list):
                    errors.append("operations.yaml.policy.rules must be a list")
                continue
            if key not in POLICY_CATEGORIES and key != "external_recipients":
                warnings.append(
                    f"operations.yaml.policy.{key} is not an enforced policy category; put the rule in knowledge"
                )
            if isinstance(item, str) and item not in POLICY_VALUES:
                warnings.append(
                    f"operations.yaml.policy.{key} uses custom value {item!r}; make its meaning explicit in knowledge"
                )
        if "default_write" not in policy:
            warnings.append("operations.yaml.policy.default_write is missing; treat writes as ask")

    knowledge = value.get("knowledge", {})
    if knowledge is not None and not isinstance(knowledge, dict):
        errors.append("operations.yaml.knowledge must be a mapping")
    elif isinstance(knowledge, dict):
        mode = knowledge.get("mode", "local")
        if mode not in {"local", "mcp", "both"}:
            errors.append("operations.yaml.knowledge.mode must be local, mcp, or both")
        if mode in {"local", "both"}:
            raw_path = knowledge.get("path", "knowledge")
            if not isinstance(raw_path, str) or not raw_path.strip():
                errors.append("operations.yaml.knowledge.path is required for local knowledge")
            elif not (workspace / raw_path).exists():
                warnings.append(f"knowledge path does not exist: {raw_path}")
        if mode in {"mcp", "both"} and not knowledge.get("connection"):
            warnings.append("knowledge mode includes MCP but no knowledge.connection is configured")

    routines = value.get("routines", [])
    if routines is not None and not isinstance(routines, list):
        errors.append("operations.yaml.routines must be a list")

    scan_secrets(value, "operations.yaml", errors)
    return errors, warnings


def validate_workspace(workspace: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    workspace = workspace.resolve()

    operations_path = workspace / "operations.yaml"
    if not operations_path.is_file():
        errors.append("missing required file: operations.yaml")
        operations: Any = {}
    else:
        try:
            operations = load_yaml(operations_path)
            op_errors, op_warnings = validate_operations(operations, workspace)
            errors.extend(op_errors)
            warnings.extend(op_warnings)
        except Exception as exc:
            errors.append(f"invalid YAML operations.yaml: {exc}")
            operations = {}

    if not (workspace / "CLAUDE.md").is_file():
        warnings.append("CLAUDE.md is missing; the workspace can run, but operator guidance will not load")

    structured: list[tuple[Path, Any]] = []
    if operations_path.is_file() and isinstance(operations, dict):
        structured.append((operations_path, operations))

    mcp_path = workspace / ".mcp.json"
    example_mcp_path = workspace / ".mcp.json.example"
    chosen_mcp = mcp_path if mcp_path.exists() else example_mcp_path
    configured_mcp = {
        str(name)
        for name, item in (operations.get("connections", {}) if isinstance(operations, dict) else {}).items()
        if isinstance(item, dict) and item.get("kind") == "mcp" and item.get("enabled") is not False
    }
    if chosen_mcp.exists():
        try:
            value = json.loads(chosen_mcp.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or not isinstance(value.get("mcpServers"), dict):
                errors.append(f"{chosen_mcp.name} must contain an mcpServers object")
            else:
                actual_mcp = set(value["mcpServers"])
                if actual_mcp != configured_mcp:
                    warnings.append(
                        f"{chosen_mcp.name} does not match MCP connections in operations.yaml; run render_mcp.py"
                    )
            structured.append((chosen_mcp, value))
        except Exception as exc:
            errors.append(f"invalid JSON {chosen_mcp.name}: {exc}")
    elif configured_mcp:
        warnings.append("MCP connections are configured but .mcp.json is missing; run render_mcp.py")

    workflows_dir = workspace / "workflows"
    if workflows_dir.exists():
        for path in sorted(workflows_dir.glob("*.y*ml")):
            try:
                value = load_yaml(path)
                structured.append((path, value))
                if not isinstance(value, dict):
                    errors.append(f"{path.relative_to(workspace)} must contain a mapping")
                    continue
                missing = WORKFLOW_REQUIRED - set(value)
                if missing:
                    errors.append(
                        f"{path.relative_to(workspace)} is missing {', '.join(sorted(missing))}"
                    )
                uses = value.get("uses", [])
                if uses is not None and not isinstance(uses, list):
                    errors.append(f"{path.relative_to(workspace)} uses must be a list")
                elif uses and isinstance(operations, dict):
                    known = set((operations.get("connections") or {}) if isinstance(operations.get("connections"), dict) else {})
                    if known:
                        missing_uses = [str(item) for item in uses if str(item) not in known]
                        if missing_uses:
                            warnings.append(
                                f"{path.relative_to(workspace)} uses names that are not connections: {', '.join(missing_uses)}"
                            )
                authority = value.get("authority", {})
                if authority is not None and not isinstance(authority, dict):
                    errors.append(f"{path.relative_to(workspace)} authority must be a mapping")
                success = value.get("success")
                if not isinstance(success, list) or not success:
                    errors.append(f"{path.relative_to(workspace)} success must be a non-empty list")
            except Exception as exc:
                errors.append(f"invalid workflow {path.relative_to(workspace)}: {exc}")

    knowledge_dir = workspace / "knowledge"
    if knowledge_dir.exists():
        for path in sorted(knowledge_dir.rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            if text.startswith("---\n"):
                match = FRONTMATTER.match(text)
                if not match:
                    errors.append(f"invalid frontmatter in {path.relative_to(workspace)}")
                    continue
                try:
                    data = yaml.safe_load(match.group(1)) or {}
                    if not isinstance(data, dict):
                        raise ValueError("frontmatter must be a mapping")
                    structured.append((path, data))
                except Exception as exc:
                    errors.append(f"invalid frontmatter in {path.relative_to(workspace)}: {exc}")

    for path, value in structured:
        scan_secrets(value, path.relative_to(workspace).as_posix(), errors)

    for env_path in workspace.rglob(".env*"):
        if env_path.is_file() and env_path.name not in {".env.example", ".env.template"}:
            errors.append(f"environment file should not be committed: {env_path.relative_to(workspace)}")

    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path, nargs="?", default=Path.cwd())
    args = parser.parse_args(argv)

    errors, warnings = validate_workspace(args.workspace)
    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("Local workspace checks passed.")
    print("Live authentication, provider permissions, and representative reads still need host checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
