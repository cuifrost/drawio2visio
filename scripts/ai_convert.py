#!/usr/bin/env python3
"""AI/脚本一行调用：python3 scripts/ai_convert.py 图.drawio [-o out] [--width 2.2] [--font 8]"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser(description="Draw.io → Visio 转换")
    ap.add_argument("input", help="输入 .drawio")
    ap.add_argument("-o", "--out", default=None, help="输出前缀（默认 outputs/文件名）")
    ap.add_argument("--width", type=float, default=None, help="流程框宽 (in)")
    ap.add_argument("--height", type=float, default=None, help="流程框高 (in)")
    ap.add_argument("--font", type=float, default=None, help="字号 pt")
    ap.add_argument("--preset", default="beauty")
    ap.add_argument("--profile", default=None)
    ap.add_argument("--page", default=None)
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--report-only", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    inp = Path(args.input).resolve()
    if not inp.exists():
        print(json.dumps({"ok": False, "error": f"not found: {inp}"}, ensure_ascii=False))
        return 1
    out = str(Path(args.out).resolve()) if args.out else str(ROOT / "outputs" / inp.stem)

    node = os.environ.get("MIMO_NODE") or "node"
    cmd = [node, str(ROOT / "scripts" / "convert.js"), str(inp), "-o", out, "--json", "--preset", args.preset]
    if args.width is not None:
        cmd += ["--set", f"processWidth={args.width}"]
    if args.height is not None:
        cmd += ["--set", f"processHeight={args.height}"]
    if args.font is not None:
        cmd += ["--set", f"fontSizePt={args.font}"]
    for key in ["profile", "page"]:
        value = getattr(args, key)
        if value is not None:
            cmd += ["--" + key, str(Path(value).resolve()) if key == "profile" else value]
    for key in ["strict", "report_only"]:
        if getattr(args, key):
            cmd += ["--" + key.replace("_", "-")]

    env = dict(os.environ)
    nm = os.environ.get("MIMO_NODE_MODULES")
    # 项目本地 node_modules 优先；仅当本地缺依赖且外部路径存在时才注入 NODE_PATH
    if (
        nm
        and os.path.isdir(nm)
        and not (ROOT / "node_modules" / "@xmldom").is_dir()
    ):
        env["NODE_PATH"] = nm

    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", env=env, cwd=str(ROOT))
    if r.returncode != 0:
        try:
            failure = json.loads(r.stdout)
        except ValueError:
            failure = {"ok": False, "error": r.stderr or r.stdout}
        print(json.dumps(failure, ensure_ascii=False))
        return 1

    try:
        data = json.loads(r.stdout)
    except Exception:
        print(r.stdout)
        return 0

    if args.report_only:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    # check_vsdx
    py = os.environ.get("MIMO_PYTHON") or sys.executable
    chk = subprocess.run(
        [py, str(ROOT / "scripts" / "check_vsdx.py"), data["outputs"]["vsdx"]],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    data["check_ok"] = chk.returncode == 0
    data["check_log"] = chk.stdout.strip().splitlines()[-3:]
    if args.quiet:
        print(json.dumps({"ok": data["check_ok"], "vsdx": data["outputs"]["vsdx"], "check_ok": data["check_ok"], "report": data["outputs"]["report"], "warnings": data["report"]["summary"]["warnings"]}, ensure_ascii=False))
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0 if data["check_ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
