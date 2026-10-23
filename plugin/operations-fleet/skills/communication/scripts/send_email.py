#!/usr/bin/env python3
"""Send an unchanged, explicitly approved email preview."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import smtplib
import socket
import ssl
import sys
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from pathlib import Path
from typing import Any, Callable, Mapping

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required: python -m pip install pyyaml") from exc


class SendError(ValueError):
    pass


def parse_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise SendError(f"{field} must be true or false")


def email_address(value: Any, field: str) -> str:
    if not isinstance(value, str) or any(char in value for char in "\r\n\x00"):
        raise SendError(f"{field} is not a valid email address")
    _, address = parseaddr(value.strip())
    if address.count("@") != 1 or not address.rsplit("@", 1)[0]:
        raise SendError(f"{field} is not a valid email address")
    return address


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def workspace_file(workspace: Path, path: Path) -> Path:
    candidate = path if path.is_absolute() else workspace / path
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(workspace)
    except ValueError as exc:
        raise SendError("path is outside the workspace") from exc
    return resolved


def env_or(mapping: Mapping[str, str], name: str, fallback: Any) -> Any:
    value = mapping.get(name)
    return fallback if value is None or not value.strip() else value


def load_config(operations_path: Path, environ: Mapping[str, str]) -> dict[str, Any]:
    raw = yaml.safe_load(operations_path.read_text(encoding="utf-8")) or {}
    communication = raw.get("communication") or {}
    smtp = communication.get("smtp") or {}
    policy_config = raw.get("policy") or {}

    if policy_config.get("email_send", "ask") == "deny":
        raise SendError("operations.yaml policy.email_send denies email delivery")

    enabled = parse_bool(
        env_or(environ, "EMAIL_NOTIFICATIONS_ENABLED", communication.get("notifications_enabled", False)),
        "EMAIL_NOTIFICATIONS_ENABLED",
    )
    if not enabled:
        raise SendError("email notifications are disabled")

    provider = str(env_or(environ, "EMAIL_PROVIDER", communication.get("platform", ""))).lower()
    if provider != "smtp":
        raise SendError("EMAIL_PROVIDER must be smtp")

    host = str(env_or(environ, "SMTP_HOST", smtp.get("host", ""))).strip()
    if not host or any(char in host for char in "\r\n\x00"):
        raise SendError("SMTP_HOST is required")
    # Same rule as the Email connector: an explicit valid security wins, else use_tls means
    # starttls, else none. The port default follows the security mode only when security is explicit; otherwise it stays 25.
    security = str(env_or(environ, "SMTP_SECURITY", smtp.get("security") or "")).strip().lower()
    explicit_security = security in SMTP_DEFAULT_PORTS
    if not explicit_security:
        use_tls = parse_bool(env_or(environ, "SMTP_USE_TLS", smtp.get("use_tls", False)), "SMTP_USE_TLS")
        security = "starttls" if use_tls else "none"
    try:
        port = int(env_or(environ, "SMTP_PORT", smtp.get("port") or (SMTP_DEFAULT_PORTS[security] if explicit_security else 25)))
    except (TypeError, ValueError) as exc:
        raise SendError("SMTP_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise SendError("SMTP_PORT must be between 1 and 65535")
    username = str(env_or(environ, "SMTP_USERNAME", smtp.get("username") or "")).strip()
    password = environ.get("SMTP_PASSWORD", "")
    if username and security == "none" and not loopback(host):
        raise SendError("refusing to send a password without TLS; set SMTP_SECURITY to starttls or ssl")

    sender = email_address(communication.get("sender"), "communication.sender")
    groups = communication.get("recipient_groups") or {}
    allowed = {
        email_address(address, "communication.recipient_groups").lower()
        for addresses in groups.values()
        for address in addresses
    }
    # Internal mail domains (from the Email connector) count as internal recipients too, so a
    # colleague who is not in a named group can still receive mail when external sends are denied.
    internal_domains = [
        str(domain).strip().lstrip("@").lower()
        for domain in (communication.get("internal_domains") or [])
        if str(domain).strip()
    ]
    # The sender's own domain is the organisation's domain: a colleague there is never "external".
    sender_domain = sender.rsplit("@", 1)[-1].lower()
    if sender_domain and sender_domain not in internal_domains:
        internal_domains.append(sender_domain)
    if not allowed and not internal_domains:
        raise SendError("no configured email recipients")

    return {
        "host": host,
        "port": port,
        "security": security,
        "use_tls": security != "none",
        "username": username,
        "password": password,
        "ca_file": environ.get("SMTP_CA_FILE") or None,
        "sender": sender,
        "allowed_recipients": allowed,
        "internal_domains": internal_domains,
        "external_recipients": policy_config.get("external_recipients", "deny"),
    }


SMTP_DEFAULT_PORTS = {"starttls": 587, "ssl": 465, "none": 25}
PREFLIGHT_TIMEOUT_SECONDS = 8


def preflight(host: str, port: int, timeout: float = PREFLIGHT_TIMEOUT_SECONDS) -> str:
    """Open a TCP connection to the mail server and read its greeting.

    Runs before anything is sent so an unreachable server fails in seconds with one plain
    sentence, instead of a 30-second hang and an ambiguous send record. Returns the greeting.
    """
    where = f"SMTP server {host}:{port}"
    try:
        with socket.create_connection((host, port), timeout=timeout) as connection:
            connection.settimeout(timeout)
            greeting = connection.recv(512).decode(errors="replace").strip()
    except socket.gaierror as exc:
        raise SendError(f"{where}: the hostname could not be resolved ({exc}). Check SMTP_HOST.") from exc
    except socket.timeout as exc:
        raise SendError(
            f"{where} did not answer within {int(timeout)} seconds from this machine. "
            "The network route to the mail server is missing (VPN, firewall or wrong network). "
            "Fix the route, then retry this same send; do not try another server, port or address."
        ) from exc
    except ConnectionRefusedError as exc:
        raise SendError(f"{where} refused the connection: nothing is listening on port {port}.") from exc
    except OSError as exc:
        raise SendError(f"{where} could not be reached: {exc}") from exc
    if not greeting.startswith("220"):
        raise SendError(f"{where} answered with {greeting[:80]!r} instead of an SMTP greeting.")
    return greeting


def check(operations_path: Path, environ: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Resolve the mail configuration and prove the server is reachable, without sending."""
    config = load_config(operations_path, environ or os.environ)
    greeting = preflight(config["host"], config["port"])
    return {
        "server": f"{config['host']}:{config['port']}",
        "security": config["security"],
        "use_tls": config["use_tls"],
        "username": config["username"],
        "sender": config["sender"],
        "internal_domains": config["internal_domains"],
        "greeting": greeting,
        "reachable": True,
    }


def write_record(path: Path, record: dict[str, Any]) -> None:
    path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def send_preview(
    workspace: Path,
    operations_path: Path,
    manifest_path: Path,
    approved_hash: str,
    confirmed: bool,
    environ: Mapping[str, str] | None = None,
    smtp_factory: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    if not confirmed:
        raise SendError("--confirm-send is required")
    workspace = workspace.resolve(strict=True)
    operations_path = workspace_file(workspace, operations_path)
    manifest_path = workspace_file(workspace, manifest_path)
    config = load_config(operations_path, environ or os.environ)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    eml_path = workspace_file(workspace, Path(manifest.get("eml", "")))
    actual_hash = sha256_file(eml_path)
    if actual_hash != manifest.get("eml_sha256") or actual_hash != approved_hash:
        raise SendError("preview hash does not match the manifest and approved SHA-256")
    if manifest.get("sent") is not False:
        raise SendError("manifest is not in an unsent state")

    sender = email_address(manifest.get("from"), "manifest.from")
    if sender.lower() != config["sender"].lower():
        raise SendError("preview sender does not match communication.sender")
    recipients = [
        email_address(value, "manifest.envelope_recipients")
        for value in manifest.get("envelope_recipients", [])
    ]
    if not recipients or len({value.lower() for value in recipients}) != len(recipients):
        raise SendError("manifest envelope recipients are missing or duplicated")
    if config["external_recipients"] == "deny":
        internal = config.get("internal_domains") or []
        unexpected = sorted(
            value.lower()
            for value in recipients
            if value.lower() not in config["allowed_recipients"] and not allowed(value, internal)
        )
        if unexpected:
            raise SendError(f"recipient is outside the configured internal groups and domains: {unexpected[0]}")

    record_path = manifest_path.with_name("send-record.json")
    if record_path.exists():
        raise SendError("a send attempt already exists; inspect it before retrying")
    # Prove the server answers before a send record exists, so an unreachable relay leaves
    # nothing ambiguous behind and the same send can simply be retried once the route is back.
    preflight(config["host"], config["port"])
    attempt = {
        "status": "attempting",
        "eml_sha256": actual_hash,
        "from": sender,
        "recipients": recipients,
        "smtp_host": config["host"],
        "smtp_port": config["port"],
        "smtp_security": config["security"],
        "smtp_use_tls": config["use_tls"],
        "attempted_at": datetime.now(timezone.utc).isoformat(),
    }
    write_record(record_path, attempt)

    message = BytesParser(policy=policy.default).parsebytes(eml_path.read_bytes())
    try:
        context = ssl.create_default_context(cafile=config["ca_file"])
        if config["security"] == "ssl":
            client = (smtp_factory or smtplib.SMTP_SSL)(config["host"], config["port"], timeout=30, context=context)
        else:
            client = (smtp_factory or smtplib.SMTP)(config["host"], config["port"], timeout=30)
        with client as smtp:
            smtp.ehlo()
            if config["security"] == "starttls":
                smtp.starttls(context=context)
                smtp.ehlo()
            if config["username"]:
                smtp.login(config["username"], config["password"])
            refused = smtp.send_message(message, from_addr=sender, to_addrs=recipients)
        if refused:
            raise SendError(f"SMTP refused {len(refused)} recipient(s)")
    except Exception as exc:
        attempt["status"] = "failed_or_ambiguous"
        attempt["error"] = f"{type(exc).__name__}: {exc}"
        write_record(record_path, attempt)
        raise SendError("SMTP send failed or is ambiguous; inspect send-record.json before retrying") from exc

    attempt["status"] = "sent"
    attempt["sent_at"] = datetime.now(timezone.utc).isoformat()
    write_record(record_path, attempt)
    return attempt


def allowed(address: str, domains: list[str]) -> bool:
    domain = address.rsplit("@", 1)[-1].lower()
    return any(domain == item or domain.endswith("." + item) for item in domains)


def loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(socket.gethostbyname(host)).is_loopback
    except (OSError, ValueError):
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--operations", type=Path, default=Path("operations.yaml"))
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--approved-eml-sha256")
    parser.add_argument("--confirm-send", action="store_true")
    parser.add_argument(
        "--check",
        action="store_true",
        help="resolve the mail settings and prove the server answers, without sending anything",
    )
    args = parser.parse_args(argv)
    if args.check:
        try:
            result = check(workspace_file(args.workspace.resolve(strict=True), args.operations))
        except (OSError, json.JSONDecodeError, SendError) as exc:
            print(f"check failed: {exc}", file=sys.stderr)
            return 1
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    if args.manifest is None or not args.approved_eml_sha256:
        parser.error("--manifest and --approved-eml-sha256 are required unless --check is given")
    try:
        result = send_preview(
            args.workspace,
            args.operations,
            args.manifest,
            args.approved_eml_sha256,
            args.confirm_send,
        )
    except (OSError, json.JSONDecodeError, SendError) as exc:
        print(f"send failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
