#!/usr/bin/env python3
"""Create a deterministic .eml preview and verify local attachments.

The script never sends email. Input is JSON. Paths must stay inside the workspace.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_module
import json
import mimetypes
import re
import sys
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import parseaddr
from pathlib import Path
from typing import Any

HEADER_CONTROL = re.compile(r"[\r\n\x00]")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
PLACEHOLDER = re.compile(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}")
TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "assets" / "email-templates"


class PreviewError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        raise PreviewError(f"{field} must be a simple stable identifier")
    return value


def safe_header(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PreviewError(f"{field} is required")
    value = value.strip()
    if HEADER_CONTROL.search(value):
        raise PreviewError(f"{field} contains an unsafe control character")
    return value


def email_address(value: Any, field: str) -> str:
    value = safe_header(value, field)
    _, address = parseaddr(value)
    if address.count("@") != 1:
        raise PreviewError(f"{field} is not a valid email address")
    local, domain = address.rsplit("@", 1)
    if not local or "." not in domain:
        raise PreviewError(f"{field} is not a valid email address")
    return address


def address_list(value: Any, field: str, required: bool = False) -> list[str]:
    value = [] if value is None else value
    if not isinstance(value, list):
        raise PreviewError(f"{field} must be a list")
    result = [email_address(item, f"{field}[{index}]") for index, item in enumerate(value)]
    if required and not result:
        raise PreviewError(f"{field} requires at least one recipient")
    if len({item.lower() for item in result}) != len(result):
        raise PreviewError(f"{field} contains duplicate recipients")
    return result


def workspace_file(workspace: Path, raw: Any, field: str = "attachment.location") -> Path:
    if not isinstance(raw, str) or not raw:
        raise PreviewError(f"{field} is required")
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = workspace / candidate
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(workspace)
    except ValueError as exc:
        raise PreviewError(f"{field} is outside the workspace") from exc
    if not resolved.is_file():
        raise PreviewError(f"{field} is not a file")
    return resolved


def body(workspace: Path, request: dict[str, Any], kind: str) -> str | None:
    path_field = f"{kind}_path"
    if path_field not in request:
        return request.get(kind)
    if request.get(kind) is not None:
        raise PreviewError(f"give either {kind} or {path_field}, not both")
    return workspace_file(workspace, request[path_field], path_field).read_text(encoding="utf-8")


def output_folder(workspace: Path, request: dict[str, Any], case_id: str, preview_id: str) -> Path:
    raw = request.get("output_dir")
    if raw is None:
        return workspace / "artifacts" / case_id / preview_id
    if not isinstance(raw, str) or not raw.strip():
        raise PreviewError("output_dir must be a folder path")
    folder = Path(raw)
    folder = (folder if folder.is_absolute() else workspace / folder).resolve()
    try:
        folder.relative_to(workspace)
    except ValueError as exc:
        raise PreviewError("output_dir is outside the workspace") from exc
    return folder


def verify_attachment(workspace: Path, item: Any, require_integrity: bool = False) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise PreviewError("each attachment must be an object")
    artifact_id = safe_id(item.get("id"), "attachment.id")
    if item.get("state") != "ready":
        raise PreviewError(f"attachment {artifact_id} is not ready")
    path = workspace_file(workspace, item.get("location"))
    actual_sha = sha256_file(path)
    expected_sha = item.get("sha256")
    if require_integrity and not expected_sha:
        raise PreviewError(f"attachment {artifact_id} manifest requires sha256")
    if expected_sha and expected_sha != actual_sha:
        raise PreviewError(f"attachment {artifact_id} changed after review")
    expected_size = item.get("size_bytes")
    if expected_size is not None and expected_size != path.stat().st_size:
        raise PreviewError(f"attachment {artifact_id} size changed after review")
    media_type = item.get("media_type") or mimetypes.guess_type(path.name)[0]
    media_type = media_type or "application/octet-stream"
    if "/" not in media_type or HEADER_CONTROL.search(media_type):
        raise PreviewError(f"attachment {artifact_id} has an invalid media type")
    return {
        "id": artifact_id,
        "name": path.name,
        "location": path.relative_to(workspace).as_posix(),
        "media_type": media_type,
        "size_bytes": path.stat().st_size,
        "sha256": actual_sha,
    }


def resolve_attachment(workspace: Path, item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise PreviewError("each attachment must be an object")
    if "manifest" not in item:
        return verify_attachment(workspace, item)
    if set(item) != {"manifest"}:
        raise PreviewError("a manifest attachment may contain only the manifest field")
    manifest_path = workspace_file(workspace, item["manifest"], "attachment.manifest")
    try:
        descriptor = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PreviewError("attachment manifest is not valid JSON") from exc
    if not isinstance(descriptor, dict):
        raise PreviewError("attachment manifest must contain an object")
    attachment = verify_attachment(workspace, descriptor, require_integrity=True)
    attachment["source_manifest"] = manifest_path.relative_to(workspace).as_posix()
    attachment["source_manifest_sha256"] = sha256_file(manifest_path)
    return attachment


def template_value(value: Any, field: str) -> str:
    if not isinstance(value, (str, int, float, bool)):
        raise PreviewError(f"template variable {field} must be a string, number, or boolean")
    return str(value)


def render_template(source: str, variables: dict[str, str], escape_html: bool) -> str:
    required = set(PLACEHOLDER.findall(source))
    missing = sorted(required - variables.keys())
    if missing:
        raise PreviewError(f"template variable is missing: {missing[0]}")

    def replace(match: re.Match[str]) -> str:
        value = variables[match.group(1)]
        return html_module.escape(value, quote=True) if escape_html else value

    return PLACEHOLDER.sub(replace, source)


def resolve_message_content(
    workspace: Path, request: dict[str, Any]
) -> tuple[str, str, str | None, dict[str, Any] | None]:
    template = request.get("template")
    if template is None:
        subject = safe_header(request.get("subject"), "subject")
        text = body(workspace, request, "text")
        html = body(workspace, request, "html")
        if not isinstance(text, str) or not text.strip():
            raise PreviewError("text is required")
        if html is not None and (not isinstance(html, str) or not html.strip()):
            raise PreviewError("html must be non-empty when supplied")
        return subject, text, html, None

    if not isinstance(template, dict):
        raise PreviewError("template must be an object")
    if any(field in request for field in ("subject", "text", "html", "text_path", "html_path")):
        raise PreviewError("subject, text, html, text_path, and html_path cannot override a named template")
    name = safe_id(template.get("name"), "template.name")
    raw_variables = template.get("variables")
    if not isinstance(raw_variables, dict):
        raise PreviewError("template.variables must be an object")
    variables = {
        str(key): template_value(value, str(key))
        for key, value in raw_variables.items()
    }
    paths = {
        "subject": TEMPLATE_DIR / f"{name}.subject.txt",
        "text": TEMPLATE_DIR / f"{name}.txt",
        "html": TEMPLATE_DIR / f"{name}.html",
    }
    if not all(path.is_file() for path in paths.values()):
        raise PreviewError(f"unknown or incomplete email template: {name}")
    sources = {key: path.read_text(encoding="utf-8") for key, path in paths.items()}
    subject = safe_header(render_template(sources["subject"], variables, False), "subject")
    text = render_template(sources["text"], variables, False)
    html = render_template(sources["html"], variables, True)
    metadata = {
        "name": name,
        "source_sha256": {
            key: hashlib.sha256(value.encode("utf-8")).hexdigest()
            for key, value in sources.items()
        },
    }
    return subject, text, html, metadata


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def build_preview(workspace: Path, request: dict[str, Any]) -> dict[str, Any]:
    workspace = workspace.resolve(strict=True)
    case_id = safe_id(request.get("case_id", "case"), "case_id")
    preview_id = safe_id(request.get("preview_id", "email-preview"), "preview_id")
    sender = email_address(request.get("from"), "from")
    to = address_list(request.get("to"), "to", required=True)
    cc = address_list(request.get("cc"), "cc")
    bcc = address_list(request.get("bcc"), "bcc")
    combined = [address.lower() for address in to + cc + bcc]
    if len(set(combined)) != len(combined):
        raise PreviewError("a recipient appears in more than one recipient list")

    subject, text, html, template = resolve_message_content(workspace, request)

    attachments = [resolve_attachment(workspace, item) for item in request.get("attachments", [])]
    seed = canonical_hash({
        "case_id": case_id,
        "preview_id": preview_id,
        "from": sender,
        "to": to,
        "cc": cc,
        "bcc": bcc,
        "subject": subject,
        "text": text,
        "html": html,
        "template": template,
        "attachments": attachments,
    })

    message = EmailMessage()
    message["From"] = sender
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Subject"] = subject
    message["X-Operations-Case"] = case_id
    message["X-Operations-Preview"] = preview_id
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")
        message.set_boundary(f"ops-alt-{seed[:24]}")

    for attachment in attachments:
        path = workspace / attachment["location"]
        main_type, sub_type = attachment["media_type"].split("/", 1)
        message.add_attachment(
            path.read_bytes(),
            maintype=main_type,
            subtype=sub_type,
            filename=attachment["name"],
        )
    if attachments:
        message.set_boundary(f"ops-mixed-{seed[24:48]}")
        first_part = message.get_payload(0)
        if getattr(first_part, "is_multipart", lambda: False)():
            first_part.set_boundary(f"ops-alt-{seed[:24]}")

    output_dir = output_folder(workspace, request, case_id, preview_id)
    output_dir.mkdir(parents=True, exist_ok=True)
    eml_path = output_dir / "message.eml"
    manifest_path = output_dir / "manifest.json"
    eml = message.as_bytes(policy=SMTP)
    eml_path.write_bytes(eml)

    manifest = {
        "case_id": case_id,
        "preview_id": preview_id,
        "from": sender,
        "to": to,
        "cc": cc,
        "bcc": bcc,
        "bcc_count": len(bcc),
        "envelope_recipients": to + cc + bcc,
        "subject": subject,
        "template": template,
        "attachments": attachments,
        "eml": eml_path.relative_to(workspace).as_posix(),
        "eml_sha256": hashlib.sha256(eml).hexdigest(),
        "sent": False,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        request = json.loads(args.input.read_text(encoding="utf-8"))
        result = build_preview(args.workspace, request)
    except (OSError, json.JSONDecodeError, PreviewError) as exc:
        print(f"preview failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
