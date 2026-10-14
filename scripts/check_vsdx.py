#!/usr/bin/env python3
"""Validate VSDX structure, master bindings, text and glued connector references."""
from __future__ import annotations

import argparse
import json
import posixpath
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

V = "http://schemas.microsoft.com/office/visio/2012/main"
R = "http://schemas.openxmlformats.org/package/2006/relationships"
REQUIRED = [
    "[Content_Types].xml", "_rels/.rels", "visio/document.xml",
    "visio/_rels/document.xml.rels", "visio/masters/masters.xml",
    "visio/masters/_rels/masters.xml.rels", "visio/pages/pages.xml",
    "visio/pages/_rels/pages.xml.rels", "visio/pages/page1.xml",
    "visio/theme/theme1.xml", "visio/windows.xml",
]


def validate(path: str | Path, expected: list[str] | None = None) -> dict:
    issues, notes, texts = [], [], []
    counts = {"pages": 0, "shapes": 0, "connectors": 0, "connects": 0}
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            issues.extend(f"缺少包成员: {name}" for name in REQUIRED if name not in names)
            if archive.testzip():
                issues.append("ZIP CRC 校验失败")
            roots = {}
            for name in sorted(names):
                if name.endswith((".xml", ".rels")):
                    try:
                        roots[name] = ET.fromstring(archive.read(name))
                    except ET.ParseError as error:
                        issues.append(f"XML 无效: {name}: {error}")
            for name, root in roots.items():
                if not name.endswith(".rels"):
                    continue
                parent = "" if name == "_rels/.rels" else posixpath.dirname(posixpath.dirname(name))
                rel_ids = set()
                for rel in root:
                    rid = rel.get("Id")
                    if rid in rel_ids:
                        issues.append(f"重复 relationship ID: {name}: {rid}")
                    rel_ids.add(rid)
                    if rel.get("TargetMode") == "External":
                        continue
                    target = posixpath.normpath(posixpath.join(parent, rel.get("Target", "")))
                    if target.startswith("/"):
                        target = target[1:]
                    if target not in names:
                        issues.append(f"relationship 目标不存在: {name} → {target}")
            master_root = roots.get("visio/masters/masters.xml")
            masters = set() if master_root is None else {m.get("ID") for m in master_root.findall(f"{{{V}}}Master")}
            for name, root in roots.items():
                if not re.fullmatch(r"visio/pages/page\d+\.xml", name):
                    continue
                counts["pages"] += 1
                if root.tag != f"{{{V}}}PageContents":
                    issues.append(f"Visio 页面 namespace 无效: {name}")
                shapes = root.findall(f".//{{{V}}}Shape")
                shape_ids = [s.get("ID") for s in shapes]
                if len(set(shape_ids)) != len(shape_ids):
                    issues.append(f"重复 Shape ID: {name}")
                id_set = set(shape_ids)
                counts["shapes"] += len(shapes)
                connectors = []
                for shape in shapes:
                    sid = shape.get("ID")
                    if shape.get("Master") and shape.get("Master") not in masters:
                        issues.append(f"悬空 Master: {name}: {sid}")
                    cells = {c.get("N"): c for c in shape.findall(f"{{{V}}}Cell")}
                    text = shape.find(f"{{{V}}}Text")
                    if text is not None:
                        value = "".join(text.itertext())
                        texts.append(value)
                        if value and text.find(f"{{{V}}}cp") is None:
                            issues.append(f"文字缺少字符段: {name}: {sid}")
                        if value and "TxtPinX" not in cells and shape.get("Master") != "6":
                            issues.append(f"文字缺少锚点: {name}: {sid}")
                    if "BeginX" in cells or "EndX" in cells:
                        connectors.append(sid)
                        counts["connectors"] += 1
                        for cell_name in ["BeginX", "BeginY", "EndX", "EndY"]:
                            if cell_name not in cells:
                                issues.append(f"连线缺少 {cell_name}: {name}: {sid}")
                    elif shape.get("Master") != "6" and "FillForegnd" not in cells:
                        issues.append(f"形状缺少填色: {name}: {sid}")
                    for cell in shape.findall(f".//{{{V}}}Cell"):
                        for ref in re.findall(r"Sheet\.(\d+)!", cell.get("F", "")):
                            if ref not in id_set:
                                issues.append(f"Sheet.N 悬空引用: {name}: {ref}")
                connects = root.findall(f".//{{{V}}}Connect")
                counts["connects"] += len(connects)
                endpoints = {}
                for connect in connects:
                    source, target = connect.get("FromSheet"), connect.get("ToSheet")
                    if source not in id_set or target not in id_set:
                        issues.append(f"Connect 指向缺失形状: {name}: {source} → {target}")
                    endpoints.setdefault(source, set()).add(connect.get("FromCell"))
                for sid in connectors:
                    if not {"BeginX", "EndX"}.issubset(endpoints.get(sid, set())):
                        issues.append(f"连线缺少两端吸附: {name}: {sid}")
            if counts["pages"] == 0:
                issues.append("没有可解析的 Visio 页面")
            joined = "\n".join(texts)
            for phrase in expected or []:
                if phrase not in joined:
                    issues.append(f"输出文字缺失: {phrase}")
            notes.append("ZIP/XML、relationship、Master、Sheet 引用与连接端点已检查")
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        issues.append(str(error))
    return {"ok": not issues, "counts": counts, "issues": issues, "notes": notes}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--expect", action="append", default=[], help="Require text in the generated shapes")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    result = validate(args.path, args.expect)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"== {args.path} ==")
        print(f"  {result['counts']}")
        for issue in result["issues"]:
            print(f"  ✗ {issue}")
        print("  ✓ 结构检查通过；视觉效果仍需在 Visio 检查" if result["ok"] else "  ✗ 结构检查失败")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
