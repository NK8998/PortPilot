from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DemoPackageTests(unittest.TestCase):
    def test_hackathon_package_contains_current_proofs(self) -> None:
        required = [
            ROOT / "docs" / "PORTPILOT_ARCHITECTURE.md",
            ROOT / "docs" / "HACKATHON_DEMO.md",
            ROOT / "docs" / "HACKATHON_EVIDENCE.md",
            ROOT / "docs" / "HACKATHON_QUICKSTART.md",
            ROOT / "docs" / "HACKATHON_FALLBACK.md",
            ROOT / "scripts" / "demo.ps1",
            ROOT / "scripts" / "build-fallback-recording.ps1",
        ]
        for path in required:
            self.assertTrue(path.is_file(), path)

        combined = "\n".join(
            path.read_text(encoding="utf-8")
            for path in required
            if path.suffix == ".md"
        )
        self.assertIn("32714075611", combined)
        self.assertIn("32714080799", combined)
        self.assertIn("0xAA64", combined)
        self.assertIn("not-ready", combined)

    def test_architecture_and_demo_script_are_executable_assets(self) -> None:
        architecture = (
            ROOT / "docs" / "PORTPILOT_ARCHITECTURE.md"
        ).read_text(encoding="utf-8")
        script = (ROOT / "scripts" / "demo.ps1").read_text(encoding="utf-8")

        self.assertIn("flowchart LR", architecture)
        self.assertIn("scripts\\validate_contracts.py", script)
        self.assertIn("unittest discover", script)

    def test_whisper_disposition_ledger_covers_latest_findings(self) -> None:
        ledger = (
            ROOT / "docs" / "WHISPER_CPP_FINDING_DISPOSITIONS.md"
        ).read_text(encoding="utf-8")
        identifiers = set(re.findall(r"PP-WHISPER-CPP-\d{3}", ledger))

        self.assertEqual(
            {f"PP-WHISPER-CPP-{index:03d}" for index in range(1, 26)},
            identifiers,
        )


if __name__ == "__main__":
    unittest.main()
