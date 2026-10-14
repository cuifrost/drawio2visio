"""基于 pywin32 的 Visio COM 文档装配引擎（需 Windows + Microsoft Visio）。"""
from __future__ import annotations

import json
from pathlib import Path

try:
    import win32com.client as win32
except ImportError:  # pragma: no cover
    win32 = None


def build_vsdx(
    graph,
    mapped,
    edges,
    config_path: str | Path,
    output_path: str | Path,
) -> Path:
    """调用本机 Visio COM，按自定义模具生成规范化 .vsdx。

    mapped: iterable of (node, master_name, cx, cy, w, h) — 见 mapper.normalize_geometry
    """
    if win32 is None:
        raise RuntimeError("pywin32 不可用：请在 Windows 且已安装 Visio 的环境中运行")

    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    stencil = config["stencil"]["path"]
    opts = config.get("options", {})

    app = win32.Dispatch("Visio.Application")
    app.Visible = False
    doc = app.Documents.Add("")
    page = app.ActivePage
    vis_stencil = app.Documents.OpenEx(str(Path(stencil).resolve()), 0)

    shapes_by_id: dict[str, object] = {}
    for node, master_name, cx, cy, w, h in mapped:
        master = vis_stencil.Masters.Item(master_name)
        shape = page.Drop(master, cx, cy)
        if opts.get("forceStandardSize", True) and node.shape_type != "decision":
            shape.Cells("Width").FormulaU = f"{w} in"
            shape.Cells("Height").FormulaU = f"{h} in"
        if node.text:
            shape.Text = node.text
        shapes_by_id[node.id] = shape

    if opts.get("dynamicConnector", True):
        for edge in edges:
            src = shapes_by_id.get(edge.source)
            tgt = shapes_by_id.get(edge.target)
            if src is None or tgt is None:
                continue
            conn = page.DrawLine(
                src.Cells("PinX").ResultIU,
                src.Cells("PinY").ResultIU,
                tgt.Cells("PinX").ResultIU,
                tgt.Cells("PinY").ResultIU,
            )
            try:
                conn.BeginConnect(src, 3)
                conn.EndConnect(tgt, 3)
            except Exception:
                # 旧版 Visio 可能不支持；保留几何连线
                pass
            if edge.text:
                conn.Text = edge.text

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.SaveAs(str(out.resolve()))
    doc.Close()
    app.Quit()
    return out
