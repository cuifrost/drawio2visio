#!/usr/bin/env python3
"""ShapeSheet 级对照：手绘 VSDX vs 生成 VSDX。

用法:
  python3 scripts/compare_vsdx.py <hand.vsdx> <generated.vsdx>
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path


def page_xml(path: str) -> str:
    with zipfile.ZipFile(path) as z:
        return z.read("visio/pages/page1.xml").decode("utf-8", "replace")


def parse_shapes(xml: str):
    pat = re.compile(r"<Shape\b([^>]*)>(.*?)</Shape>", re.S)
    cell_re = re.compile(r"<Cell N=\"([^\"]+)\" V=\"([^\"]*)\"([^/]*)/>")
    cell_re2 = re.compile(r"<Cell N='([^']+)' V='([^']*)'([^/]*)/>")
    shapes = []
    for attrs, body in pat.findall(xml):
        cells = {}
        for n, v, rest in cell_re.findall(body) + cell_re2.findall(body):
            fm = re.search(r"F='([^']*)'|F=\"([^\"]*)\"", rest)
            f = (fm.group(1) or fm.group(2)) if fm else ""
            cells[n] = (v, f)
        name = (
            (re.search(r'NameU="([^"]*)"', attrs) or re.search(r"NameU='([^']*)'", attrs))
            or type("X", (), {"group": lambda *_: ""})()
        )
        name_u = name.group(1) if hasattr(name, "group") else ""
        master = (
            re.search(r'Master="(\d+)"', attrs) or re.search(r"Master='(\d+)'", attrs)
        )
        shapes.append({"name": name_u, "master": master.group(1) if master else "", "cells": cells})
    return shapes


def kind(f: str) -> str:
    if not f:
        return "V"
    if "Inh" in f:
        return "Inh"
    if "THEME" in f:
        return "theme"
    if "GUARD" in f:
        return "guard"
    if "PAR(PNT" in f or "WALKGLUE" in f:
        return "glue"
    if "Width" in f or "Height" in f or "Txt" in f:
        return "formula"
    return "other"


KEY = [
    "TxtPinX", "TxtPinY", "TxtWidth", "TxtHeight", "TxtLocPinX", "TxtLocPinY",
    "LeftMargin", "RightMargin", "TopMargin", "BottomMargin", "TextBkgnd",
    "LineWeight", "LineColor", "FillForegnd", "VerticalAlign", "Rounding",
    "ObjType", "GlueType", "ShapeRouteStyle", "BeginX", "EndX", "Height", "Width",
]


def pick(shapes, pred):
    for s in shapes:
        if pred(s):
            return s
    return None


def diff(title, a, b):
    print(f"\n=== {title} ===")
    if not a or not b:
        print("  missing shape class")
        return
    hard = 0
    for k in KEY:
        av, af = a["cells"].get(k, (None, None))
        bv, bf = b["cells"].get(k, (None, None))
        if av is None and bv is None:
            continue
        ka, kb = kind(af or ""), kind(bf or "")
        # Allow same formula kind even if cached V differs (size-dependent)
        equiv = {"Inh", "formula", "glue", "guard", "theme"}
        if ka == kb and ka in equiv:
            status = "OK"
        elif {ka, kb} <= {"Inh", "formula"} or {ka, kb} <= {"Inh", "glue"} or {ka, kb} <= {"formula", "glue"}:
            status = "EQUIV"  # 继承/公式/胶合：等价约束
        elif ka == kb and av == bv:
            status = "OK"
        elif (av or "").lower() == (bv or "").lower():
            status = "OK"
        elif k in ("Width", "Height", "BeginX", "EndX") and ka in ("V", "formula", "glue", "guard"):
            status = "LAYOUT"
        elif av == bv:
            status = "OK"
        else:
            status = "DIFF"
            hard += 1
        print(f"  {status:8} {k:16} hand=({str(av)[:16]}, {ka})  gen=({str(bv)[:16]}, {kb})")
    print(f"  → hard DIFF: {hard}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    hand = parse_shapes(page_xml(sys.argv[1]))
    gen = parse_shapes(page_xml(sys.argv[2]))
    print(f"hand shapes={len(hand)} gen shapes={len(gen)}")

    diff("PROCESS", pick(hand, lambda s: s["master"] == "5"), pick(gen, lambda s: "Process" in s["name"]))
    diff("DECISION", pick(hand, lambda s: s["master"] == "7"), pick(gen, lambda s: "Decision" in s["name"]))
    diff("START/END", pick(hand, lambda s: s["master"] == "4"), pick(gen, lambda s: "Start" in s["name"]))
    diff("CONNECTOR", pick(hand, lambda s: s["master"] in ("6", "2")), pick(gen, lambda s: s["master"] == "6"))


if __name__ == "__main__":
    main()
