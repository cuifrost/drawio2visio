/** Shared browser/Node conversion planning and compatibility diagnostics. */
(function (global) {
  const SIZE_KEYS = ["processWidth", "processHeight", "decisionWidth", "decisionHeight", "startEndWidth", "startEndHeight"];
  const DEFAULTS = {
    beauty: { processWidth: 2.2, processHeight: 0.394, decisionWidth: 2.13, decisionHeight: 0.47, startEndWidth: 1.26, startEndHeight: 0.394, fontSizePt: 8 },
    compact: { processWidth: 1.85, processHeight: 0.35, decisionWidth: 1.85, decisionHeight: 0.42, startEndWidth: 1.05, startEndHeight: 0.35, fontSizePt: 7.5 },
  };
  const PROFILE_KEYS = {
    processWidth: "process_width_in", processHeight: "process_height_in",
    decisionWidth: "decision_width_in", decisionHeight: "decision_height_in",
    startEndWidth: "start_end_width_in", startEndHeight: "start_end_height_in",
    fontSizePt: "font_size_pt",
  };

  function resolveOptions(presetName = "beauty", overrides = {}, profile = {}) {
    const preset = profile.presets?.[presetName] || DEFAULTS[presetName];
    if (!preset) throw new Error("未知预设：" + presetName + "（beauty / compact，或 profile 中定义的名称）");
    const opts = { ...DEFAULTS.beauty, forceSize: true, stripStyles: true };
    for (const [key, snake] of Object.entries(PROFILE_KEYS)) {
      opts[key] = preset[key] ?? preset[key === "fontSizePt" ? key : key + "In"] ?? preset[snake] ?? opts[key];
    }
    for (const key of [...SIZE_KEYS, "fontSizePt", "forceSize"]) {
      if (overrides[key] !== undefined) opts[key] = overrides[key];
    }
    for (const key of [...SIZE_KEYS, "fontSizePt"]) {
      if (!Number.isFinite(opts[key]) || opts[key] <= 0) throw new Error(key + " 必须是正数");
    }
    opts.forceSize = opts.forceSize !== false && opts.forceSize !== 0;
    return opts;
  }

  function selectPage(graph, selection) {
    let index = 0;
    if (selection !== undefined && selection !== "") {
      index = /^\d+$/.test(String(selection)) ? Number(selection) - 1 : graph.pages.indexOf(selection);
      if (index < 0 || index >= graph.pages.length) throw new Error("找不到页面：" + selection);
    } else if (graph.pages.length > 1) {
      throw new Error("输入包含 " + graph.pages.length + " 页，请通过 --page 页码/页名选择一页；浏览器中可切换页面。");
    }
    const name = graph.pages[index];
    const belongs = (item) => item.pageIndex === undefined ? (item.page === undefined || item.page === name) : item.pageIndex === index;
    return { ...graph, pages: [name], nodes: graph.nodes.filter(belongs), edges: graph.edges.filter(belongs), selectedPage: index + 1, sourcePages: graph.pages.length };
  }

  function prepare(graph, options, { sourceName = "input.drawio", masterConfig } = {}) {
    const opts = resolveOptions("beauty", options);
    const issues = [];
    const add = (severity, code, message, ids = []) => issues.push({ severity, code, message, ids });
    if (graph.pages.length !== 1) throw new Error("请先选择一页再转换");
    if (!graph.nodes.length) add("error", "EMPTY_PAGE", "选中页面没有可转换的图形。");
    const ids = new Set();
    for (const node of graph.nodes) {
      if (!node.id || ids.has(node.id)) add("error", "DUPLICATE_ID", "节点 ID 缺失或重复。", [node.id]);
      ids.add(node.id);
      if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) {
        add("error", "INVALID_GEOMETRY", "节点坐标必须有限，宽高必须大于 0。", [node.id]);
      }
    }
    const mapped = Mapper.mapNodes(graph.nodes, masterConfig);
    for (const node of mapped) {
      const sm = node.styleMap || {};
      if (node.type === "unknown" || ["data", "database", "document", "preparation", "manual"].includes(node.type)) {
        add("warning", "SHAPE_SIMPLIFIED", "此类形状会简化为流程矩形。", [node.id]);
      }
      if (ids.has(node.parent) || node.relative) add("warning", "NESTED_GEOMETRY", "嵌套/相对坐标不会还原为 Visio 分组，请先展开或拆组。", [node.id]);
      if (sm.image || sm.shape === "image") add("warning", "IMAGE_OMITTED", "图片不会嵌入；只保留占位形状和文字。", [node.id]);
      if (sm.rotation && Number(sm.rotation) !== 0) add("warning", "ROTATION_RESET", "旋转角度会归零。", [node.id]);
      if (sm.swimlane || sm.shape === "swimlane") add("warning", "SWIMLANE_SIMPLIFIED", "泳道不会保留泳道语义。", [node.id]);
    }
    const unresolved = graph.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
    if (unresolved.length) add("warning", "EDGE_OMITTED", "缺少有效源/目标节点的连线不会导出。", unresolved.map((e) => e.id));
    const routed = graph.edges.filter((e) => e.points?.length || e.styleMap?.curved === "1");
    if (routed.length) add("warning", "ROUTE_REBUILT", "原始折点/曲线会交给 Visio 动态连接线重新布线。", routed.map((e) => e.id));
    const arrows = graph.edges.filter((e) => e.styleMap?.endArrow === "none" || (e.styleMap?.startArrow && e.styleMap.startArrow !== "none"));
    if (arrows.length) add("warning", "ARROW_STANDARDIZED", "双向或无箭头连线会统一为单向结束箭头。", arrows.map((e) => e.id));
    add("info", "STYLE_STANDARDIZED", "采用黑白流程图样式、统一字号和主题字体；原始颜色/富文本格式不保留。");

    const nodes = Mapper.normalizeGeometry(mapped, { ...opts, pxPerInch: 96 });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.visioX - n.widthIn / 2);
      minY = Math.min(minY, n.visioY - n.heightIn / 2);
      maxX = Math.max(maxX, n.visioX + n.widthIn / 2);
      maxY = Math.max(maxY, n.visioY + n.heightIn / 2);
    }
    const margin = 0.5;
    for (const n of nodes) {
      n.visioX += margin - minX;
      n.visioY += margin - minY;
      const usableWidth = n.widthIn * 72 * (n.type === "decision" ? 0.833 : 1) - 8;
      const usableHeight = n.heightIn * 72 * (n.type === "decision" ? 0.75 : 1) - 8;
      const lines = String(n.text).split("\n").reduce((count, line) => {
        const ems = Array.from(line).reduce((sum, ch) => sum + (/[^\x00-\x7f]/.test(ch) ? 1 : 0.55), 0);
        return count + Math.max(1, Math.ceil(ems * opts.fontSizePt / Math.max(1, usableWidth)));
      }, 0);
      if (n.text && lines * opts.fontSizePt * 1.2 > usableHeight) add("warning", "TEXT_MAY_OVERFLOW", "按中文/拉丁字宽估算，文字可能超出形状；建议增大宽高或减小字号。", [n.id]);
    }
    const sorted = nodes.filter((n) => n.type !== "label").slice().sort((a, b) => (a.visioX - a.widthIn / 2) - (b.visioX - b.widthIn / 2));
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.visioX - b.widthIn / 2 >= a.visioX + a.widthIn / 2) break;
        if (Math.abs(a.visioY - b.visioY) < (a.heightIn + b.heightIn) / 2 - 1e-4) add("warning", "SHAPES_OVERLAP", "转换后的形状边界框相交，请检查布局。", [a.id, b.id]);
      }
    }
    const edges = Mapper.mapEdges(graph.edges, nodes).filter((e) => e.resolved);
    const masters = Mapper.collectMasters(nodes, masterConfig).map((m) => ({ ...m, type: nodes.find((n) => n.masterName === m.name)?.type || "connector" }));
    const report = {
      schemaVersion: "1.0", source: String(sourceName).split(/[\\/]/).pop(),
      selectedPage: graph.selectedPage || 1, pageName: graph.pages[0], sourcePages: graph.sourcePages || 1,
      status: issues.some((i) => i.severity === "error") ? "error" : issues.some((i) => i.severity === "warning") ? "review" : "ready",
      summary: { nodesInput: graph.nodes.length, nodesExported: nodes.length, edgesInput: graph.edges.length, edgesExported: edges.length, warnings: issues.filter((i) => i.severity === "warning").length },
      options: opts, issues,
      shapes: nodes.map((n) => ({ id: n.id, inputType: n.type, outputType: ["startEnd", "terminator", "decision", "label"].includes(n.type) ? n.type : "process", master: n.masterName, widthIn: n.widthIn, heightIn: n.heightIn })),
    };
    return {
      nodes, edges, masters, report, options: opts, sourceName: report.source,
      pageName: graph.pages[0], pageWidthIn: nodes.length ? maxX - minX + margin * 2 : 1,
      pageHeightIn: nodes.length ? maxY - minY + margin * 2 : 1,
    };
  }
  global.Converter = { resolveOptions, selectPage, prepare };
})(typeof window !== "undefined" ? window : globalThis);
