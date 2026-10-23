#!/usr/bin/env python3
"""Render a document to page images for visual review, and check workbook formulas.

  python render_check.py report.docx            -> report.review/report.pdf + page-1.png ...
  python render_check.py model.xlsx             -> the same, plus formula errors and uncalculated cells

Uses LibreOffice (soffice) to convert DOCX, PPTX and XLSX to PDF, and pdftoppm (poppler) to make PNGs.
Workbook checks need openpyxl. A missing tool is reported, not hidden, so the caller can say which
check did not run.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ERRORS = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!", "#SPILL!", "#CALC!"}
OFFICE = {".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xlsm", ".xls", ".odt", ".odp", ".ods", ".rtf"}
WINDOWS_SOFFICE = Path("C:/Program Files/LibreOffice/program/soffice.exe")
MAX_LISTED = 50


def soffice() -> str | None:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    return found or (str(WINDOWS_SOFFICE) if WINDOWS_SOFFICE.exists() else None)


def convert(source: Path, target_ext: str, out_dir: Path) -> Path:
    office = soffice()
    if not office:
        raise FileNotFoundError("LibreOffice (soffice) is not installed")
    with tempfile.TemporaryDirectory() as profile:
        # A private profile lets several sessions convert at once without a profile lock.
        subprocess.run(
            [office, f"-env:UserInstallation={Path(profile).as_uri()}", "--headless", "--convert-to", target_ext, "--outdir", str(out_dir), str(source)],
            check=True, capture_output=True, timeout=240,
        )
    result = out_dir / f"{source.stem}.{target_ext.split(':')[0]}"
    if not result.exists():
        raise RuntimeError(f"LibreOffice did not produce {result.name}")
    return result


def pages(pdf: Path, out_dir: Path, dpi: int) -> list[str]:
    tool = shutil.which("pdftoppm")
    if not tool:
        raise FileNotFoundError("pdftoppm (poppler-utils) is not installed")
    subprocess.run([tool, "-png", "-r", str(dpi), str(pdf), str(out_dir / "page")], check=True, capture_output=True, timeout=240)
    return sorted((path.name for path in out_dir.glob("page-*.png")), key=lambda name: int(name[5:-4]))


def workbook(source: Path) -> dict[str, Any]:
    import openpyxl  # noqa: PLC0415 - optional dependency, only for workbooks

    formulas = openpyxl.load_workbook(source, data_only=False)
    with tempfile.TemporaryDirectory() as temp:
        try:
            # LibreOffice recalculates on load, so the converted copy carries fresh cached values.
            values = openpyxl.load_workbook(convert(source, "xlsx:Calc MS Excel 2007 XML", Path(temp)), data_only=True)
            recalculated = True
        except (FileNotFoundError, RuntimeError, subprocess.SubprocessError):
            values = openpyxl.load_workbook(source, data_only=True)
            recalculated = False
        errors, uncalculated, count = [], [], 0
        for sheet in formulas.worksheets:
            computed = values[sheet.title]
            for row in sheet.iter_rows():
                for cell in row:
                    if not (isinstance(cell.value, str) and cell.value.startswith("=")):
                        continue
                    count += 1
                    value = computed[cell.coordinate].value
                    where = f"{sheet.title}!{cell.coordinate}"
                    if isinstance(value, str) and value.strip() in ERRORS:
                        errors.append(f"{where} {value.strip()} ({cell.value[:80]})")
                    elif value is None:
                        uncalculated.append(where)
    return {
        "recalculated": recalculated,
        "formulas": count,
        "errors": errors[:MAX_LISTED],
        "error_count": len(errors),
        "uncalculated": uncalculated[:MAX_LISTED],
        "uncalculated_count": len(uncalculated),
        "hidden_sheets": [sheet.title for sheet in formulas.worksheets if sheet.sheet_state != "visible"],
    }


def review(source: Path, dpi: int) -> dict[str, Any]:
    source = source.resolve(strict=True)
    out_dir = source.with_name(f"{source.stem}.review")
    out_dir.mkdir(exist_ok=True)
    result: dict[str, Any] = {"file": source.name, "review_dir": str(out_dir), "skipped": []}
    ext = source.suffix.lower()
    if ext in {".xlsx", ".xlsm"}:
        try:
            result["workbook"] = workbook(source)
            if not result["workbook"]["recalculated"]:
                result["skipped"].append("recalculation: LibreOffice (soffice) is not installed, so formulas without cached values were not checked for errors")
        except ImportError:
            result["skipped"].append("formula check: openpyxl is not installed")
    try:
        pdf = source if ext == ".pdf" else convert(source, "pdf", out_dir) if ext in OFFICE else None
        if pdf is None:
            result["skipped"].append(f"rendering: {ext} is not a document format")
        else:
            result["pdf"] = str(pdf)
            result["pages"] = pages(pdf, out_dir, dpi)
    except (FileNotFoundError, RuntimeError) as exc:
        result["skipped"].append(f"rendering: {exc}")
    except subprocess.SubprocessError as exc:
        result["skipped"].append(f"rendering failed: {exc}")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path)
    parser.add_argument("--dpi", type=int, default=80, help="page image resolution (default 80)")
    args = parser.parse_args(argv)
    try:
        result = review(args.file, args.dpi)
    except OSError as exc:
        print(f"review failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    problems = result.get("workbook", {}).get("error_count", 0)
    return 2 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
