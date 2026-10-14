"""Convert a public fixture in a temporary directory, then validate actual text."""
from pathlib import Path
import subprocess
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix="drawio2visio-smoke-") as folder:
    base = str(Path(folder) / "review")
    subprocess.run(["node", str(ROOT / "scripts/convert.js"), str(ROOT / "examples/review-flow.drawio"), "-o", base, "--strict"], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/check_vsdx.py"), base + ".vsdx", "--expect", "接收申请", "--expect", "提交审核"], check=True)
print("smoke OK")
