"""形状类型识别与 Master 映射规则。"""
from __future__ import annotations

from .parser import DrawioGraph, DrawioNode

DEFAULT_MASTERS: dict[str, str] = {
    "startEnd": "开始/结束",
    "process": "流程",
    "decision": "判定",
    "data": "流程",
    "database": "流程",
    "document": "流程",
    "manual": "流程",
    "preparation": "流程",
    "terminator": "开始/结束",
    "unknown": "流程",
    "connector": "动态连接线",
}

# Default drawing habits; customize them in the style profile for your project.
# Batch-editable knobs: one size per shape family (process is uniform).
STYLE_PROFILE = {
    "process_width_in": 3.1496,
    "process_height_in": 0.3937,
    "decision_width_in": 2.7559,
    "decision_height_in": 0.3937,
    "start_end_width_in": 1.378,
    "start_end_height_in": 0.3937,
    "vertical_gap_in": 0.7087,
    "text_size_pt": 8,
    "line_color": "#000000",
    "fill_light": "#FEFFFF",
    "end_arrow": 4,
    "end_arrow_size": 2,
}


def detect_type(node: DrawioNode) -> str:
    """启发式识别 Draw.io 节点类型。"""
    style = (node.style or "").lower()
    sm: dict[str, str] = {}
    for part in style.split(";"):
        if not part:
            continue
        if "=" in part:
            k, v = part.split("=", 1)
            sm[k.strip()] = v.strip()
        else:
            sm[part.strip()] = "1"

    shape = sm.get("shape", "").lower()
    if "rhombus" in shape or "diamond" in shape or "rhombus" in style or "diamond" in style:
        return "decision"
    if "cylinder" in shape or "database" in shape or "cylinder" in style:
        return "database"
    if "parallelogram" in shape or "trapezoid" in shape or "parallelogram" in style:
        return "data"
    if "document" in shape or "note" in shape:
        return "document"
    if "hexagon" in shape:
        return "preparation"
    if any(k in shape for k in ("doublecircle", "circle", "ellipse")):
        return "terminator" if node.bounds.width <= 50 and node.bounds.height <= 50 else "startEnd"

    rounded = sm.get("rounded") in ("1", "true") or "rounded=1" in style
    aspect = node.bounds.width / max(node.bounds.height, 1.0)
    arc = float(sm.get("arcSize", "0") or 0)
    is_capsule = rounded and (aspect >= 1.8 or aspect <= 0.55 or arc >= min(node.bounds.width, node.bounds.height) / 2)
    if is_capsule and aspect >= 1.6:
        return "startEnd"
    if rounded and node.bounds.height <= 70 and node.bounds.width <= 160 and aspect >= 2.2:
        return "startEnd"
    return "process"


def map_nodes(graph: DrawioGraph, masters: dict[str, str] | None = None):
    """将节点映射为 (node, master_name) 列表。"""
    cfg = {**DEFAULT_MASTERS, **(masters or {})}
    mapped = []
    for n in graph.nodes:
        n.shape_type = detect_type(n)
        master_name = cfg.get(n.shape_type, cfg["process"])
        mapped.append((n, master_name))
    return mapped


def normalize_geometry(mapped, *, px_per_inch: float = 96.0, force_size: bool = True,
                      process_width: float | None = None, process_height: float | None = None,
                      decision_width: float | None = None, decision_height: float | None = None,
                      start_end_width: float | None = None, start_end_height: float | None = None,
                      std_width: float | None = None, std_height: float | None = None):
    """坐标与尺寸归一化：Draw.io px（左上原点）→ Visio in（左下原点）。

    流程框统一一种规格；判定、起止可单独批量设置。
    """
    pw = process_width or std_width or STYLE_PROFILE["process_width_in"]
    ph = process_height or std_height or STYLE_PROFILE["process_height_in"]
    dw = decision_width or STYLE_PROFILE["decision_width_in"]
    dh = decision_height or STYLE_PROFILE["decision_height_in"]
    sw = start_end_width or STYLE_PROFILE["start_end_width_in"]
    sh = start_end_height or STYLE_PROFILE["start_end_height_in"]

    max_y = max((n.bounds.y + n.bounds.height) for n, _ in mapped) if mapped else 0
    page_h_px = max_y + 80

    result = []
    for n, master in mapped:
        cx = (n.bounds.x + n.bounds.width / 2) / px_per_inch
        cy = (page_h_px - (n.bounds.y + n.bounds.height / 2)) / px_per_inch
        if force_size:
            if n.shape_type == "decision":
                w, h = dw, dh
            elif n.shape_type in ("startEnd", "terminator"):
                w, h = sw, sh
            else:
                w, h = pw, ph
        else:
            w = n.bounds.width / px_per_inch
            h = n.bounds.height / px_per_inch
        result.append((n, master, cx, cy, w, h))
    return result


__all__ = ["DEFAULT_MASTERS", "detect_type", "map_nodes", "normalize_geometry"]
