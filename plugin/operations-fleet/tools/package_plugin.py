#!/usr/bin/env python3
"""Create a deterministic ZIP of the single plugin."""

from __future__ import annotations

import argparse
import hashlib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDE_PARTS = {"__pycache__", ".git", ".venv", "runs", "artifacts", "dist", "results"}


def files_to_pack() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in EXCLUDE_PARTS for part in rel.parts):
            continue
        if path.suffix in {".pyc", ".zip"}:
            continue
        files.append(path)
    return sorted(files, key=lambda item: item.relative_to(ROOT).as_posix())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files_to_pack():
            rel = Path("operations-fleet") / path.relative_to(ROOT)
            info = zipfile.ZipInfo(rel.as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if path.stat().st_mode & 0o111 else 0o644) << 16
            archive.writestr(info, path.read_bytes())

    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    checksum = args.output.with_suffix(args.output.suffix + ".sha256")
    checksum.write_text(f"{digest}  {args.output.name}\n", encoding="utf-8")
    print(args.output)
    print(checksum)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
