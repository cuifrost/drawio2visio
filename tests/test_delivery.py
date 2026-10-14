"""Inspect real CLI outputs and deliberately corrupt their VSDX references."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_vsdx", ROOT / "scripts/check_vsdx.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
V = "{http://schemas.microsoft.com/office/visio/2012/main}"


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name) / "delivery"

    def run_cli(self, *extra, fixture="review-flow.drawio"):
        result = subprocess.run(
            ["node", str(ROOT / "scripts/convert.js"), str(ROOT / "examples" / fixture), "-o", str(self.base), "--json", *extra],
            cwd=self.tmp.name, capture_output=True, text=True, encoding="utf-8",
        )
        return result.returncode, json.loads(result.stdout)

    def corrupt(self, transform):
        target = Path(self.tmp.name) / "corrupted.vsdx"
        with zipfile.ZipFile(str(self.base) + ".vsdx") as source, zipfile.ZipFile(target, "w") as output:
            for name in source.namelist():
                text = source.read(name).decode("utf-8")
                output.writestr(name, transform(name, text))
        return target

    def test_delivery_counts_text_font_master_and_metadata(self):
        code, result = self.run_cli("--strict", "--set", "fontSizePt=10")
        self.assertEqual(code, 0, result)
        self.assertEqual(result["report"]["status"], "ready")
        self.assertEqual(len(result["outputs"]), 5)
        data = checker.validate(result["outputs"]["vsdx"], ["接收申请", "否 / No", "结束 / End"])
        self.assertTrue(data["ok"], data)
        self.assertEqual(data["counts"]["shapes"], 13)
        self.assertEqual(data["counts"]["connects"], 12)
        with zipfile.ZipFile(result["outputs"]["vsdx"]) as archive:
            page = ET.fromstring(archive.read("visio/pages/page1.xml"))
            shapes = page.findall(f"{V}Shapes/{V}Shape")
            self.assertEqual([s.get("Master") for s in shapes[:7]], ["4", "5", "5", "7", "5", "5", "4"])
            for shape in shapes:
                rows = shape.findall(f"{V}Section[@N='Character']/{V}Row")
                for row in rows:
                    self.assertAlmostEqual(float(row.find(f"{V}Cell[@N='Size']").get("V")), 10 / 72)
                if shape.get("Master") == "6":
                    endpoint = shape.find(f"{V}Section[@N='Geometry']/{V}Row[@T='LineTo']")
                    self.assertEqual(endpoint.find(f"{V}Cell[@N='X']").get("F"), "Width")
                    self.assertEqual(endpoint.find(f"{V}Cell[@N='Y']").get("F"), "Height")
            self.assertNotIn("Users", archive.read("docProps/app.xml").decode())
            self.assertEqual(ET.fromstring(archive.read("docProps/core.xml")).find("{http://purl.org/dc/elements/1.1/}creator").text, None)

    def test_strict_warnings_write_no_files(self):
        code, result = self.run_cli("--strict", fixture="compatibility.drawio")
        self.assertNotEqual(code, 0)
        self.assertFalse(result["ok"])
        self.assertEqual(result["report"]["summary"]["edgesExported"], 1)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_preflight_and_invalid_options_write_no_files(self):
        code, result = self.run_cli("--report-only")
        self.assertEqual(code, 0)
        self.assertEqual(result["outputs"], {})
        for params in [("--set", "fontSizePt=0"), ("--preset", "does-not-exist"), ("--set", "verticalGap=1")]:
            code, result = self.run_cli(*params)
            self.assertNotEqual(code, 0)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_report_and_config_are_portable(self):
        code, result = self.run_cli("--preset", "compact")
        self.assertEqual(code, 0)
        self.assertEqual(result["options"]["fontSizePt"], 7.5)
        for key in ["config", "report"]:
            content = Path(result["outputs"][key]).read_text()
            self.assertNotIn(str(ROOT), content)
            self.assertEqual(json.loads(content)["source"], "review-flow.drawio")

    def test_validator_rejects_broken_connect_and_master(self):
        self.run_cli()
        for before, after in [('ToSheet="20"', 'ToSheet="9999"'), ('Master="5"', 'Master="9999"')]:
            target = self.corrupt(lambda name, text: text.replace(before, after) if name == "visio/pages/page1.xml" else text)
            self.assertFalse(checker.validate(target)["ok"])

    def test_validator_rejects_broken_relationship_and_missing_phrase(self):
        _, result = self.run_cli()
        target = self.corrupt(lambda name, text: text.replace('Target="pages/pages.xml"', 'Target="pages/missing.xml"') if name == "visio/_rels/document.xml.rels" else text)
        self.assertFalse(checker.validate(target)["ok"])
        self.assertFalse(checker.validate(result["outputs"]["vsdx"], ["this text never existed"])["ok"])

    def test_validator_handles_non_zip_and_missing_file(self):
        invalid = Path(self.tmp.name) / "invalid.vsdx"
        invalid.write_text("not a zip")
        self.assertFalse(checker.validate(invalid)["ok"])
        self.assertFalse(checker.validate(Path(self.tmp.name) / "missing.vsdx")["ok"])

    def test_public_skeleton_has_no_reference_shapes_or_stock_icons(self):
        self.run_cli()
        with zipfile.ZipFile(str(self.base) + ".vsdx") as archive:
            for name in archive.namelist():
                text = archive.read(name).decode("utf-8")
                self.assertNotIn("<Icon>", text)
                self.assertNotIn("myTemplate_", text)
                self.assertNotIn("golden_", text)
            masters = ET.fromstring(archive.read("visio/masters/masters.xml"))
            self.assertEqual({m.get("ID") for m in masters}, {"2", "4", "5", "6", "7"})
        document = (ROOT / "js/vsdx-skeleton.js").read_text()
        self.assertLess(len(document), 30000)


if __name__ == "__main__":
    unittest.main()
