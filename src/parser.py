"""Draw.io XML 解压、读取与拓扑解析。"""
from __future__ import annotations

import base64
import re
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET
from urllib.parse import unquote


@dataclass
class Bounds:
    x: float
    y: float
    width: float
    height: float


@dataclass
class DrawioNode:
    id: str
    text: str
    bounds: Bounds
    style: str = ""
    shape_type: str = "process"


@dataclass
class DrawioEdge:
    id: str
    source: str
    target: str
    text: str = ""


@dataclass
class DrawioGraph:
    nodes: list[DrawioNode] = field(default_factory=list)
    edges: list[DrawioEdge] = field(default_factory=list)
    pages: list[str] = field(default_factory=list)


def _decode_diagram_payload(payload: str) -> str:
    """解压 draw.io 的 Base64 + raw Deflate 压缩流。"""
    raw = base64.b64decode(re.sub(r"\s+", "", payload))
    payload = zlib.decompress(raw, -15).decode("utf-8")
    return unquote(payload) if payload.lstrip().startswith("%") else payload


def _parse_style(style: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in (style or "").split(";"):
        if not part:
            continue
        if "=" in part:
            k, v = part.split("=", 1)
            result[k.strip()] = v.strip()
        else:
            result[part.strip()] = "1"
    return result


def _cell_text(value: str) -> str:
    text = value or ""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return (
        text.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .strip()
    )


def parse_drawio(path: str | Path) -> DrawioGraph:
    """解析 .drawio 文件，返回节点与连接拓扑。"""
    tree = ET.parse(str(path))
    root = tree.getroot()
    graph = DrawioGraph()

    diagrams = list(root.iter("diagram"))
    if not diagrams and root.tag == "mxGraphModel":
        diagrams = [root]

    for diagram in diagrams:
        page_name = diagram.get("name") or f"Page-{len(graph.pages) + 1}"
        graph.pages.append(page_name)

        model = diagram.find("mxGraphModel")
        if model is None:
            text = (diagram.text or "").strip()
            if text:
                xml = _decode_diagram_payload(text)
                parsed = ET.fromstring(xml)
                model = parsed.find("mxGraphModel") if parsed.tag != "mxGraphModel" else parsed
        if model is None:
            continue

        for cell in model.iter("mxCell"):
            cid = cell.get("id")
            if not cid or cid in ("0", "1"):
                continue
            style = cell.get("style") or ""
            text = _cell_text(cell.get("value") or "")
            geo = cell.find("mxGeometry")

            if cell.get("vertex") == "1":
                bounds = Bounds(
                    x=float(geo.get("x", 0) if geo is not None else 0),
                    y=float(geo.get("y", 0) if geo is not None else 0),
                    width=float(geo.get("width", 80) if geo is not None else 80),
                    height=float(geo.get("height", 40) if geo is not None else 40),
                )
                graph.nodes.append(DrawioNode(id=cid, text=text, bounds=bounds, style=style))
            elif cell.get("edge") == "1":
                graph.edges.append(
                    DrawioEdge(
                        id=cid,
                        source=cell.get("source") or "",
                        target=cell.get("target") or "",
                        text=text,
                    )
                )
    return graph


__all__ = ["Bounds", "DrawioNode", "DrawioEdge", "DrawioGraph", "parse_drawio", "_parse_style"]
