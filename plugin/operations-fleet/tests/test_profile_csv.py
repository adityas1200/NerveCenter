from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from _helpers import load_module

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "data-pull" / "scripts" / "profile_csv.py"


class ProfileCsvTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module("profile_csv", SCRIPT)
        self.temp = tempfile.TemporaryDirectory()
        self.file = Path(self.temp.name) / "sales.csv"
        self.file.write_text(
            "territory_id,sale_date,net_sales,rep_email,code\n"
            "T1,2026-09-15,100.50,a@x.com,7\n"
            "T2,2026-09-16,200,,A7\n"
            "T1,2026-09-15,-0.50,b@x.com,8\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_profile_reports_totals_ranges_and_duplicates(self) -> None:
        result = self.module.profile(self.file, ["territory_id", "sale_date"])
        columns = {column["name"]: column for column in result["columns"]}
        self.assertEqual(result["rows"], 3)
        self.assertEqual(result["sha256"], hashlib.sha256(self.file.read_bytes()).hexdigest())
        self.assertEqual(columns["net_sales"]["type"], "number")
        self.assertEqual(columns["net_sales"]["total"], "300.00")
        self.assertEqual((columns["sale_date"]["min"], columns["sale_date"]["max"]), ("2026-09-15", "2026-09-16"))
        self.assertEqual(columns["rep_email"]["nulls"], 1)
        self.assertEqual(columns["code"]["type"], "text")
        self.assertEqual(result["duplicate_keys"], 1)
        self.assertEqual(result["possible_personal_columns"], ["rep_email"])

    def test_unknown_key_column_is_an_error(self) -> None:
        with self.assertRaises(ValueError):
            self.module.profile(self.file, ["region"])


if __name__ == "__main__":
    unittest.main()
