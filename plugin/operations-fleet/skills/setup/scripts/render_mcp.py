#!/usr/bin/env python3
"""Render Claude Code .mcp.json from MCP connections in operations.yaml."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required: python -m pip install pyyaml") from exc

REMOTE_TRANSPORTS = {"http", "sse", "ws"}
PASSTHROUGH_FIELDS = {"headers", "env", "oauth"}


def load_operations(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("operations.yaml must contain a mapping")
    connections = value.get("connections", {})
    if connections is None:
        connections = {}
    if not isinstance(connections, dict):
        raise ValueError("operations.yaml connections must be a mapping")
    return value


def render(value: dict[str, Any]) -> dict[str, Any]:
    servers: dict[str, Any] = {}
    connections = value.get("connections", {}) or {}

    for raw_name, raw_connection in connections.items():
        name = str(raw_name)
        if not isinstance(raw_connection, dict):
            raise ValueError(f"connection {name} must be a mapping")
        if raw_connection.get("kind") != "mcp" or raw_connection.get("enabled") is False:
            continue

        transport = raw_connection.get("transport")
        if transport in REMOTE_TRANSPORTS:
            url = raw_connection.get("url")
            if not isinstance(url, str) or not url.strip():
                raise ValueError(f"connection {name} requires url")
            server: dict[str, Any] = {"type": transport, "url": url}
        elif transport == "stdio":
            command = raw_connection.get("command")
            if not isinstance(command, str) or not command.strip():
                raise ValueError(f"connection {name} requires command")
            server = {"type": "stdio", "command": command}
            if "args" in raw_connection:
                if not isinstance(raw_connection["args"], list):
                    raise ValueError(f"connection {name} args must be a list")
                server["args"] = raw_connection["args"]
        else:
            raise ValueError(f"connection {name} has unsupported MCP transport {transport!r}")

        for field in PASSTHROUGH_FIELDS:
            if field in raw_connection:
                if not isinstance(raw_connection[field], dict):
                    raise ValueError(f"connection {name} {field} must be a mapping")
                server[field] = raw_connection[field]

        servers[name] = server

    return {"mcpServers": servers}


def serialized(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "operations",
        type=Path,
        nargs="?",
        default=Path("operations.yaml"),
        help="operations.yaml or its workspace directory",
    )
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="output path; defaults to .mcp.json beside operations.yaml",
    )
    parser.add_argument("--check", action="store_true", help="Fail when output is absent or stale")
    args = parser.parse_args(argv)

    operations_path = args.operations
    if operations_path.is_dir():
        operations_path = operations_path / "operations.yaml"
    output_path = args.output or operations_path.parent / ".mcp.json"

    expected = serialized(render(load_operations(operations_path)))
    if args.check:
        if not output_path.is_file():
            print(f"ERROR: missing {output_path}")
            return 1
        if output_path.read_text(encoding="utf-8") != expected:
            print(f"ERROR: {output_path} is stale; regenerate it from {operations_path}")
            return 1
        print(f"{output_path} matches {operations_path}")
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(expected, encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
