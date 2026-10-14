/**
 * Shape type detection & Visio Master mapping engine.
 */
(function (global) {
  /** Defaults follow user style profile (templates/user-style-profile.json). */
  const DEFAULT_MASTERS = {
    startEnd: "开始/结束",
    process: "流程",
    decision: "判定",
    data: "流程",
    document: "流程",
    terminator: "开始/结束",
    preparation: "流程",
    manual: "流程",
    database: "流程",
    unknown: "流程",
    connector: "动态连接线",
  };

  /**
   * Generic flowchart dimensions used by this project.
   * Sizes are BATCH-adjustable: one setting applies to all shapes of that type.
   * Process uses a single width (main/side dual-size collapsed per user request).
   */
  const STYLE_PROFILE = {
    processWidthIn: 2.20,
    processHeightIn: 0.394,
    decisionWidthIn: 2.13,
    decisionHeightIn: 0.47,
    startEndWidthIn: 1.26,
    startEndHeightIn: 0.394,
    verticalGapIn: 0.55,
    textSizePt: 8,
    lineColor: "#000000",
    fillLight: "#FEFFFF",
    endArrow: 4,
    endArrowSize: 2,
  };

  const TYPE_META = {
    label: { label: "文本标签", color: "other", defaultMaster: "" },
    startEnd: { label: "起止", color: "start", defaultMaster: "开始/结束" },
    process: { label: "流程", color: "process", defaultMaster: "流程" },
    decision: { label: "判定", color: "decision", defaultMaster: "判定" },
    data: { label: "数据", color: "data", defaultMaster: "流程" },
    document: { label: "文档", color: "data", defaultMaster: "流程" },
    database: { label: "存储", color: "data", defaultMaster: "流程" },
    manual: { label: "手动", color: "other", defaultMaster: "流程" },
    preparation: { label: "准备", color: "other", defaultMaster: "流程" },
    terminator: { label: "端子", color: "start", defaultMaster: "开始/结束" },
    unknown: { label: "其他", color: "other", defaultMaster: "流程" },
  };

  /**
   * Heuristic type detection from draw.io style + geometry.
   */
  function detectType(node) {
    const s = (node.style || "").toLowerCase();
    const sm = node.styleMap || {};
    const shape = (sm.shape || "").toLowerCase();
    const w = node.width || 80;
    const h = node.height || 40;
    const aspect = h > 0 ? w / h : 2;

    if (sm.text === "1" || shape === "text") return "label";

    // Explicit shape keywords (draw.io may use bare style keys like `rhombus`)
    if (
      shape.includes("rhombus") ||
      shape.includes("diamond") ||
      s.includes("rhombus") ||
      s.includes("diamond")
    ) {
      return "decision";
    }
    if (shape.includes("cylinder") || shape.includes("database") || s.includes("cylinder")) {
      return "database";
    }
    if (
      shape.includes("parallelogram") ||
      shape.includes("trapezoid") ||
      s.includes("parallelogram") ||
      s.includes("trapezoid")
    ) {
      return "data";
    }
    if (shape.includes("document") || shape.includes("note") || s.includes("shape=document")) {
      return "document";
    }
    if (shape.includes("hexagon")) return "preparation";
    if (shape.includes("doublecircle") || shape.includes("circle") || shape.includes("ellipse") || sm.ellipse === "1") {
      // circle often start/end or connector
      if (w <= 50 && h <= 50) return "terminator";
      return "startEnd";
    }
    if (shape.includes("step") || shape.includes("process")) return "process";
    if (shape.includes("mxgraph.flowchart") || s.includes("flowchart")) {
      if (s.includes("decision") || s.includes("rhombus")) return "decision";
      if (s.includes("terminator") || s.includes("start")) return "startEnd";
      if (s.includes("data")) return "data";
      if (s.includes("document")) return "document";
    }

    // Rounded capsule → start/end
    const rounded = sm.rounded === "1" || sm.rounded === "true" || /rounded=1/.test(s);
    const arcSize = parseFloat(sm.arcSize || "0");
    const isCapsule =
      rounded &&
      (aspect >= 1.8 || aspect <= 0.55 || arcSize >= Math.min(w, h) / 2 || /arcSize=\d{2,}/.test(s));

    if (isCapsule && aspect >= 1.6) return "startEnd";

    // Soft rounded rectangle often start/end even if shorter
    if (rounded && h <= 70 && w <= 160 && aspect >= 2.2) return "startEnd";

    // Rectangle-ish default
    if (sm.shape === "rect" || !shape || shape === "rectangle") {
      // Double border / stadium
      if (s.includes("shape=mxgraph.flowchart.terminator")) return "terminator";
      return "process";
    }

    // Swimlane / container
    if (sm.swimlane === "1" || s.includes("swimlane")) return "unknown";

    // Manual op
    if (shape.includes("manual") || s.includes("manual_input") || s.includes("manual_operation")) {
      return "manual";
    }

    return "unknown";
  }

  /**
   * Map nodes to masters using config.
   * @param {Array} nodes
   * @param {Object} masterConfig - { startEnd: 'Name', process: 'Name', ... }
   */
  function mapNodes(nodes, masterConfig) {
    const cfg = { ...DEFAULT_MASTERS, ...(masterConfig || {}) };
    return nodes.map((n) => {
      const type = detectType(n);
      const masterName = type === "label" ? "" : cfg[type] || cfg.unknown || cfg.process || "My_Process";
      return {
        ...n,
        type,
        typeLabel: (TYPE_META[type] || TYPE_META.unknown).label,
        typeColor: (TYPE_META[type] || TYPE_META.unknown).color,
        masterName,
        text: (n.text || "").trim(),
      };
    });
  }

  /**
   * Collect unique masters used.
   */
  function collectMasters(mappedNodes, masterConfig) {
    const cfg = { ...DEFAULT_MASTERS, ...(masterConfig || {}) };
    const counts = new Map();
    for (const n of mappedNodes) {
      if (n.type === "label") continue;
      counts.set(n.masterName, (counts.get(n.masterName) || 0) + 1);
    }
    // Always include connector master
    if (!counts.has(cfg.connector)) {
      counts.set(cfg.connector, 0);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }

  /**
   * Standardize geometry (Visio inches, optional forced size).
   * Draw.io: origin top-left, Y down, px.
   * Visio:   origin bottom-left, Y up, inches.
   */
  function normalizeGeometry(mappedNodes, options) {
    const opts = options || {};
    const pxPerInch = opts.pxPerInch || 96;
    const forceSize = opts.forceSize !== false;

    // Batch size knobs — one value per shape family
    const processW = opts.processWidth ?? opts.stdWidth ?? STYLE_PROFILE.processWidthIn;
    const processH = opts.processHeight ?? opts.stdHeight ?? STYLE_PROFILE.processHeightIn;
    const decisionW = opts.decisionWidth ?? STYLE_PROFILE.decisionWidthIn;
    const decisionH = opts.decisionHeight ?? STYLE_PROFILE.decisionHeightIn;
    const startEndW = opts.startEndWidth ?? STYLE_PROFILE.startEndWidthIn;
    const startEndH = opts.startEndHeight ?? STYLE_PROFILE.startEndHeightIn;

    // Compute draw.io bounding box for page height
    let maxX = 0;
    let maxY = 0;
    for (const n of mappedNodes) {
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const padPx = 40;
    const pageWidthIn = (maxX + padPx * 2) / pxPerInch;
    const pageHeightIn = (maxY + padPx * 2) / pxPerInch;
    const pageHeightPx = maxY + padPx * 2;

    return mappedNodes.map((n) => {
      const cxPx = n.x + n.width / 2;
      const cyPx = n.y + n.height / 2;

      let wInFinal;
      let hInFinal;
      if (forceSize && n.type !== "label") {
        if (n.type === "decision") {
          wInFinal = decisionW;
          hInFinal = decisionH;
        } else if (n.type === "startEnd" || n.type === "terminator") {
          wInFinal = startEndW;
          hInFinal = startEndH;
        } else {
          // Single uniform process size (no main/side split)
          wInFinal = processW;
          hInFinal = processH;
        }
      } else {
        wInFinal = n.width / pxPerInch;
        hInFinal = n.height / pxPerInch;
      }

      const visioX = cxPx / pxPerInch;
      const visioY = (pageHeightPx - cyPx) / pxPerInch;

      return {
        ...n,
        widthIn: round4(wInFinal),
        heightIn: round4(hInFinal),
        visioX: round4(visioX),
        visioY: round4(visioY),
      };
    });
  }

  function round4(v) {
    return Math.round(v * 10000) / 10000;
  }

  /**
   * Build connection list with resolved endpoints.
   */
  function mapEdges(edges, mappedNodes) {
    const byId = new Map(mappedNodes.map((n) => [n.id, n]));
    return edges
      .map((e) => {
        const src = e.source ? byId.get(e.source) : null;
        const tgt = e.target ? byId.get(e.target) : null;
        return {
          ...e,
          sourceNode: src || null,
          targetNode: tgt || null,
          resolved: Boolean(src && tgt),
        };
      })
      .filter((e) => e.resolved || e.source || e.target);
  }

  global.Mapper = {
    DEFAULT_MASTERS,
    STYLE_PROFILE,
    TYPE_META,
    detectType,
    mapNodes,
    collectMasters,
    normalizeGeometry,
    mapEdges,
  };
})(window);
