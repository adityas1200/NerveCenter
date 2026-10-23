#!/usr/bin/env python3
"""Profile a CSV extract so it can be checked and sent without reading every row.

Writes <file>.profile.json next to the CSV: rows, columns, nulls, ranges, numeric totals,
duplicate keys, column names that look personal, size, and SHA-256. Standard library only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

PERSONAL = re.compile(
    r"(^|_)(first_?name|last_?name|full_?name|e_?mail|phone|mobile|address|street|postcode|zip|"
    r"dob|birth|ssn|national_?id|passport|employee_?id|patient|npi|notes?|comment)s?($|_)",
    re.IGNORECASE,
)
MAX_DUPLICATES = 20


def number(value: str) -> Decimal | None:
    try:
        return Decimal(value)
    except (InvalidOperation, ValueError):
        return None


def moment(value: str) -> str | None:
    try:
        if len(value) == 10:
            return date.fromisoformat(value).isoformat()
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


class Column:
    def __init__(self, name: str) -> None:
        self.name = name
        self.nulls = 0
        self.values = 0
        self.numeric = True
        self.temporal = True
        self.total = Decimal(0)
        # One range per type, so a column that stops parsing as a number never compares mixed types.
        self.ranges: dict[str, list[Any]] = {}

    def widen(self, kind: str, value: Any) -> None:
        bounds = self.ranges.setdefault(kind, [value, value])
        bounds[0] = min(bounds[0], value)
        bounds[1] = max(bounds[1], value)

    def add(self, raw: str) -> None:
        value = raw.strip()
        if not value:
            self.nulls += 1
            return
        self.values += 1
        if self.numeric:
            parsed = number(value)
            if parsed is None:
                self.numeric = False
            else:
                self.total += parsed
                self.widen("number", parsed)
        if self.temporal:
            parsed_moment = moment(value)
            if parsed_moment is None:
                self.temporal = False
            else:
                self.widen("date", parsed_moment)

    def report(self) -> dict[str, Any]:
        kind = "empty" if not self.values else "number" if self.numeric else "date" if self.temporal else "text"
        result: dict[str, Any] = {"name": self.name, "type": kind, "nulls": self.nulls}
        if kind in self.ranges:
            result["min"], result["max"] = (str(bound) for bound in self.ranges[kind])
        if kind == "number":
            result["total"] = str(self.total)
        return result


def profile(path: Path, keys: list[str]) -> dict[str, Any]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        header = next(reader, None)
        if not header:
            raise ValueError("the file has no header row")
        missing = [key for key in keys if key not in header]
        if missing:
            raise ValueError(f"key columns not in header: {', '.join(missing)}")
        columns = [Column(name) for name in header]
        key_index = [header.index(key) for key in keys]
        seen: set[tuple[str, ...]] = set()
        duplicates: list[list[str]] = []
        duplicate_count = 0
        ragged = 0
        rows = 0
        for row in reader:
            rows += 1
            if len(row) != len(header):
                ragged += 1
            for column, value in zip(columns, row):
                column.add(value)
            if key_index:
                key = tuple(row[i] if i < len(row) else "" for i in key_index)
                if key in seen:
                    duplicate_count += 1
                    if len(duplicates) < MAX_DUPLICATES:
                        duplicates.append(list(key))
                seen.add(key)
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": digest,
        "rows": rows,
        "ragged_rows": ragged,
        "columns": [column.report() for column in columns],
        "key": keys,
        "duplicate_keys": duplicate_count,
        "duplicate_examples": duplicates,
        "possible_personal_columns": [name for name in header if PERSONAL.search(name)],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--key", default="", help="comma-separated columns that identify one row")
    args = parser.parse_args(argv)
    keys = [part.strip() for part in args.key.split(",") if part.strip()]
    try:
        result = profile(args.csv, keys)
    except (OSError, UnicodeDecodeError, ValueError, csv.Error) as exc:
        print(f"profile failed: {exc}", file=sys.stderr)
        return 1
    output = args.csv.with_name(args.csv.name + ".profile.json")
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("file", "rows", "bytes", "sha256", "duplicate_keys", "possible_personal_columns")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
