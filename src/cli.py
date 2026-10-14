"""命令行入口：python -m src.cli input.drawio -o outputs/out.vsdx"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .mapper import map_nodes, normalize_geometry
from .parser import parse_drawio
from .visio_builder import build_vsdx


def main() -> None:
    ap = argparse.ArgumentParser(description="Draw.io → Visio 标准化转换")
    ap.add_argument("input", help=".drawio 文件路径")
    ap.add_argument("-o", "--output", default="outputs/output.vsdx")
    ap.add_argument("-c", "--config", default="config.json")
    args = ap.parse_args()

    graph = parse_drawio(args.input)
    mapped_pairs = map_nodes(graph)
    opts = json.loads(Path(args.config).read_text(encoding="utf-8")).get("options", {})
    normalized = normalize_geometry(
        mapped_pairs,
        px_per_inch=float(opts.get("pxPerInch", 96)),
        force_size=bool(opts.get("forceStandardSize", True)),
        std_width=float(opts.get("standardWidthIn", 1.5)),
        std_height=float(opts.get("standardHeightIn", 0.6)),
    )
    build_vsdx(graph, normalized, graph.edges, args.config, args.output)
    print(f"OK → {args.output}")


if __name__ == "__main__":
    main()
