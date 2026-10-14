/**
 * Drawio2Visio — main application controller
 */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    fileName: null,
    graph: null,
    mappedNodes: [],
    mappedEdges: [],
    masters: [],
    options: {
      forceSize: true,
      stripStyles: true,
      dynamicConn: true,
      scaleUnits: true,
      // Batch size knobs (uniform process size — no main/side split)
      processWidth: Mapper.STYLE_PROFILE.processWidthIn,
      processHeight: Mapper.STYLE_PROFILE.processHeightIn,
      decisionWidth: Mapper.STYLE_PROFILE.decisionWidthIn,
      decisionHeight: Mapper.STYLE_PROFILE.decisionHeightIn,
      startEndWidth: Mapper.STYLE_PROFILE.startEndWidthIn,
      startEndHeight: Mapper.STYLE_PROFILE.startEndHeightIn,
      verticalGap: Mapper.STYLE_PROFILE.verticalGapIn,
      fontSizePt: Mapper.STYLE_PROFILE.textSizePt,
    },
    masterConfig: { ...Mapper.DEFAULT_MASTERS },
    view: "preview",
  };

  // ---------- Logging / toast ----------
  function log(msg, level = "info") {
    const box = $("#log");
    const line = document.createElement("div");
    line.className = `log-line ${level}`;
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    line.textContent = `[${ts}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => (el.hidden = true), 220);
    }, 2400);
  }

  function setPipeline(step, mode = "active") {
    const steps = ["parse", "map", "normalize", "export"];
    const idx = steps.indexOf(step);
    $$(".pipe-step").forEach((el, i) => {
      el.classList.remove("active", "done");
      if (mode === "reset") return;
      if (i < idx || (mode === "done" && i <= idx)) el.classList.add("done");
      else if (i === idx) el.classList.add(mode === "done" ? "done" : "active");
    });
    if (mode === "all-done") {
      $$(".pipe-step").forEach((el) => {
        el.classList.remove("active");
        el.classList.add("done");
      });
    }
  }

  // ---------- Mapping UI ----------
  function renderMapList() {
    const list = $("#map-list");
    const types = Object.entries(Mapper.TYPE_META);
    list.innerHTML = types
      .map(([key, meta]) => {
        const value = state.masterConfig[key] || meta.defaultMaster;
        return `
        <div class="map-item" data-type="${key}">
          <span class="swatch" style="background: var(--${meta.color === "data" ? "data" : meta.color})"></span>
          <div class="map-label">
            <strong>${meta.label}</strong>
            <span>${key}</span>
          </div>
          <input type="text" value="${escapeHtml(value)}" data-type="${key}" spellcheck="false" readonly aria-label="内置母版" />
        </div>`;
      })
      .join("");

    list.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        state.masterConfig[input.dataset.type] = input.value.trim() || Mapper.DEFAULT_MASTERS[input.dataset.type];
        recompute(false);
      });
    });
  }

  function renderMasterList() {
    const ul = $("#master-list");
    if (!state.masters.length) {
      ul.innerHTML = `<li class="muted">载入文件后显示将写入的母版</li>`;
      return;
    }
    ul.innerHTML = state.masters
      .map(
        (m) =>
          `<li><span>${m.name}</span><span class="count">×${m.count}</span></li>`
      )
      .join("");
  }

  function renderMapTable() {
    const body = $("#map-table-body");
    if (!state.mappedNodes.length) {
      body.innerHTML = `<tr class="placeholder"><td colspan="6">尚未解析图形</td></tr>`;
      return;
    }
    body.innerHTML = state.mappedNodes
      .map((n) => {
        const w = n.widthIn ?? (n.width / 96).toFixed(2);
        const h = n.heightIn ?? (n.height / 96).toFixed(2);
        return `
        <tr>
          <td class="mono">${escapeHtml(n.id)}</td>
          <td>${escapeHtml(n.text || "—")}</td>
          <td><span class="type-chip ${n.typeColor}">${n.typeLabel}</span></td>
          <td class="mono">${escapeHtml(n.masterName)}</td>
          <td class="mono">${w} × ${h}</td>
          <td class="status-ok">${n.type === "label" ? "文本标签" : ["process", "decision", "startEnd", "terminator"].includes(n.type) ? "内置母版" : "简化为矩形"}</td>
        </tr>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- Preview SVG ----------
  function renderPreview() {
    const svg = $("#flow-svg");
    const empty = $("#empty-state");
    if (!state.payload?.nodes.length) {
      svg.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    const text = VisioBuilder.buildSvg(state.payload);
    const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    svg.setAttribute("viewBox", root.getAttribute("viewBox"));
    svg.style.background = "#fff";
    svg.innerHTML = root.innerHTML;
  }

  // ---------- Recompute pipeline ----------
  function recompute() {
    if (!state.graph) return;
    const selection = $("#page-select").value || "1";
    const graph = Converter.selectPage(state.graph, selection);
    state.payload = Converter.prepare(graph, state.options, { sourceName: state.fileName, masterConfig: state.masterConfig });
    state.mappedNodes = state.payload.nodes;
    state.mappedEdges = state.payload.edges;
    state.masters = state.payload.masters;
    const report = state.payload.report;
    $("#stat-shapes").textContent = String(state.mappedNodes.length);
    $("#stat-edges").textContent = String(state.mappedEdges.length);
    $("#stat-masters").textContent = String(state.masters.filter((m) => m.count > 0).length);
    $("#stat-styles").textContent = "标准化";
    const list = $("#compatibility-list");
    list.replaceChildren();
    for (const issue of report.issues.filter((i) => i.severity !== "info")) {
      const row = document.createElement("li");
      row.textContent = issue.message + (issue.ids.length ? "（" + issue.ids.join(", ") + "）" : "");
      list.appendChild(row);
    }
    $("#compatibility-status").textContent = report.status === "error" ? "无法转换" : report.summary.warnings ? report.summary.warnings + " 项待检查" : "可转换";
    $("#compatibility-status").className = "badge " + (report.status === "ready" ? "ok" : "warn");
    $("#compatibility-note").textContent = report.status === "ready" ? "检查通过。颜色和富文本格式会按标准流程图样式统一。" : "下列内容可能改变。可下载报告查看具体形状。";
    $("#btn-report").disabled = false;
    renderMapTable();
    renderMasterList();
    renderPreview();
    setPipeline("normalize", "done");
    $("#btn-export").disabled = report.status === "error" || ($("#opt-strict").checked && report.summary.warnings > 0);
  }

  // ---------- File loading ----------
  async function handleFile(file) {
    if (!file) return;
    setPipeline("reset");
    log(`载入文件：${file.name}（${formatBytes(file.size)}）`);
    $("#file-status").textContent = "解析中…";
    $("#file-status").className = "badge warn";

    try {
      const text = await file.text();
      const graph = await DrawioParser.parseDrawio(text);
      state.fileName = file.name;
      state.graph = graph;
      const pageSelect = $("#page-select");
      pageSelect.replaceChildren();
      graph.pages.forEach((name, i) => {
        const option = document.createElement("option");
        option.value = String(i + 1);
        option.textContent = `${i + 1}. ${name}`;
        pageSelect.appendChild(option);
      });
      $("#page-picker").hidden = graph.pages.length <= 1;
      state.mappedNodes = [];
      state.mappedEdges = [];

      setPipeline("parse", "done");
      $("#file-status").textContent = graph.compressed ? "已解压" : "已解析";
      $("#file-status").className = "badge ok";

      $("#file-meta").hidden = false;
      $("#meta-name").textContent = file.name;
      $("#meta-nodes").textContent = String(graph.nodes.length);
      $("#meta-edges").textContent = String(graph.edges.length);
      $("#meta-pages").textContent = String(graph.pages.length);

      $("#xml-view").textContent = DrawioParser.toNormalizedXml(graph);
      log(`解析完成：${graph.nodes.length} 节点 / ${graph.edges.length} 连接${graph.compressed ? "（Deflate 压缩流）" : ""}`, "ok");

      recompute(true);
      log(`映射完成：绑定 ${state.masters.filter((m) => m.count > 0).length} 个母版`, "ok");
      toast(`已载入 ${file.name}`);
    } catch (err) {
      state.graph = null;
      state.payload = null;
      state.mappedNodes = [];
      state.mappedEdges = [];
      state.masters = [];
      $("#btn-export").disabled = true;
      $("#btn-report").disabled = true;
      $("#file-meta").hidden = true;
      $("#page-picker").hidden = true;
      renderPreview();
      renderMapTable();
      renderMasterList();
      console.error(err);
      log(String(err.message || err), "err");
      $("#file-status").textContent = "解析失败";
      $("#file-status").className = "badge warn";
      toast("解析失败：" + (err.message || err));
      setPipeline("reset");
    }
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  // ---------- Sample ----------
  function sampleDrawioXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="Drawio2Visio" version="24.0.0">
  <diagram id="sample-1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="n1" value="开始" style="rounded=1;whiteSpace=wrap;html=1;arcSize=50;" vertex="1" parent="1">
          <mxGeometry x="360" y="40" width="140" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n2" value="接收订单" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="360" y="160" width="140" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="n3" value="库存充足？" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="365" y="280" width="130" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="n4" value="创建出库单" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="360" y="430" width="140" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="n5" value="通知补货" style="shape=parallelogram;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="580" y="295" width="140" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="n6" value="写入库存日志" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="140" y="295" width="120" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="n7" value="结束" style="rounded=1;whiteSpace=wrap;html=1;arcSize=50;" vertex="1" parent="1">
          <mxGeometry x="360" y="550" width="140" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="n1" target="n2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="n2" target="n3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e3" value="是" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="n3" target="n4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e4" value="否" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="n3" target="n5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e5" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="n3" target="n6">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e6" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="n4" target="n7">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e7" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;" edge="1" parent="1" source="n5" target="n7">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
  }

  async function loadSample() {
    const xml = sampleDrawioXml();
    const file = new File([xml], "order-flow-sample.drawio", { type: "application/xml" });
    await handleFile(file);
  }

  // ---------- Export ----------
  function currentExportFormat() {
    return $('input[name="export-format"]:checked')?.value || "vsdx";
  }

  function exportPayload() {
    const base = (state.fileName || "converted").replace(/\.(drawio|xml)$/i, "") || "converted";
    return { ...state.payload, base };
  }

  function typeFromMasterName(name) {
    const entry = Object.entries(state.masterConfig).find(([, v]) => v === name);
    return entry ? entry[0] : "process";
  }

  async function doExport() {
    if (!state.graph) {
      toast("请先载入 .drawio 文件");
      return;
    }
    if (state.payload.report.status === "error" || ($("#opt-strict").checked && state.payload.report.summary.warnings)) {
      toast("请先处理转换检查中的提示");
      return;
    }
    setPipeline("export", "active");
    const format = currentExportFormat();
    const payload = exportPayload();
    const { base } = payload;

    try {
      if (format === "vsdx") {
        const bytes = VisioBuilder.buildVsdx(payload);
        ZipKit.downloadBlob(bytes, `${base}.vsdx`, "application/vnd.ms-visio.drawing");
        log(`导出 ${base}.vsdx（Visio Open XML + 母版）`, "ok");
      } else if (format === "vdx") {
        const xml = VisioBuilder.buildVdx(payload);
        ZipKit.downloadBlob(new TextEncoder().encode(xml), `${base}.vdx`, "application/xml");
        log(`导出 ${base}.vdx（Visio XML Drawing）`, "ok");
      } else if (format === "svg") {
        const svg = VisioBuilder.buildSvg(payload);
        ZipKit.downloadBlob(new TextEncoder().encode(svg), `${base}-visio.svg`, "image/svg+xml");
        log(`导出 ${base}-visio.svg（无 foreignObject）`, "ok");
      } else if (format === "config") {
        const cfg = VisioBuilder.buildConfig(payload);
        ZipKit.downloadBlob(new TextEncoder().encode(cfg), "config.json", "application/json");
        log("导出 config.json（母版映射配置）", "ok");
      } else if (format === "python") {
        const bytes = VisioBuilder.buildPythonScaffold(payload);
        ZipKit.downloadBlob(bytes, "drawio-to-visio-converter.zip", "application/zip");
        log("导出 Python 工程脚手架（PRD 结构 + COM 构建器）", "ok");
      }
      setPipeline("export", "done");
      setPipeline("parse", "done");
      $$(".pipe-step").forEach((el) => {
        el.classList.add("done");
        el.classList.remove("active");
      });
      toast("导出完成");
    } catch (err) {
      console.error(err);
      log("导出失败：" + (err.message || err), "err");
      toast("导出失败");
    }
  }

  // ---------- Events ----------
  function bindEvents() {
    const dropzone = $("#dropzone");
    const fileInput = $("#file-input");

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) handleFile(f);
      fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
      });
    });
    dropzone.addEventListener("drop", (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    });

    // Options
    $("#opt-force-size").addEventListener("change", (e) => {
      state.options.forceSize = e.target.checked;
      recompute(true);
    });
    $("#opt-strip-styles").addEventListener("change", (e) => {
      state.options.stripStyles = e.target.checked;
      recompute(false);
      $("#stat-styles").textContent = state.options.stripStyles ? "开" : "关";
    });
    $("#opt-dynamic-conn").addEventListener("change", (e) => {
      state.options.dynamicConn = e.target.checked;
    });
    $("#opt-scale-units").addEventListener("change", (e) => {
      state.options.scaleUnits = e.target.checked;
    });

    // Batch size knobs — live update
    const sizeBindings = [
      ["size-process-w", "processWidth", 0.2, 8],
      ["size-process-h", "processHeight", 0.1, 3],
      ["size-decision-w", "decisionWidth", 0.3, 8],
      ["size-decision-h", "decisionHeight", 0.1, 3],
      ["size-start-w", "startEndWidth", 0.2, 6],
      ["size-start-h", "startEndHeight", 0.1, 2],
      ["size-gap", "verticalGap", 0.1, 3],
      ["size-font", "fontSizePt", 4, 24],
    ];
    for (const [id, key, min, max] of sizeBindings) {
      const el = $("#" + id);
      if (!el) continue;
      const apply = () => {
        const v = parseFloat(el.value);
        if (Number.isFinite(v)) state.options[key] = Math.min(max, Math.max(min, v));
        recompute(true);
      };
      el.addEventListener("input", () => {
        // debounce slightly for smooth typing
        clearTimeout(el._t);
        el._t = setTimeout(apply, 120);
      });
      el.addEventListener("change", apply);
    }

    $("#btn-reset-sizes")?.addEventListener("click", () => {
      const p = Mapper.STYLE_PROFILE;
      state.options.processWidth = p.processWidthIn;
      state.options.processHeight = p.processHeightIn;
      state.options.decisionWidth = p.decisionWidthIn;
      state.options.decisionHeight = p.decisionHeightIn;
      state.options.startEndWidth = p.startEndWidthIn;
      state.options.startEndHeight = p.startEndHeightIn;
      state.options.verticalGap = p.verticalGapIn;
      state.options.fontSizePt = p.textSizePt;
      const map = {
        "size-process-w": p.processWidthIn,
        "size-process-h": p.processHeightIn,
        "size-decision-w": p.decisionWidthIn,
        "size-decision-h": p.decisionHeightIn,
        "size-start-w": p.startEndWidthIn,
        "size-start-h": p.startEndHeightIn,
        "size-gap": p.verticalGapIn,
        "size-font": p.textSizePt,
      };
      for (const [id, val] of Object.entries(map)) {
        const el = $("#" + id);
        if (el) el.value = String(val);
      }
      recompute(true);
      log("尺寸已恢复为习惯值", "ok");
      toast("已恢复习惯值");
    });

    $("#std-width")?.addEventListener("change", (e) => {
      state.options.processWidth = Math.max(0.2, parseFloat(e.target.value) || 3.15);
      const el = $("#size-process-w");
      if (el) el.value = String(state.options.processWidth);
      recompute(true);
    });
    $("#std-height")?.addEventListener("change", (e) => {
      state.options.processHeight = Math.max(0.1, parseFloat(e.target.value) || 0.394);
      const el = $("#size-process-h");
      if (el) el.value = String(state.options.processHeight);
      recompute(true);
    });

    $("#btn-reset-map").addEventListener("click", () => {
      state.masterConfig = { ...Mapper.DEFAULT_MASTERS };
      renderMapList();
      recompute(true);
      log("映射规则已重置为默认", "warn");
    });

    $("#btn-load-sample").addEventListener("click", loadSample);
    $("#page-select").addEventListener("change", () => recompute());
    $("#opt-strict").addEventListener("change", () => recompute());
    $("#preset-select").addEventListener("change", (e) => {
      Object.assign(state.options, Converter.resolveOptions(e.target.value));
      const ids = { processWidth: "size-process-w", processHeight: "size-process-h", decisionWidth: "size-decision-w", decisionHeight: "size-decision-h", startEndWidth: "size-start-w", startEndHeight: "size-start-h", fontSizePt: "size-font" };
      for (const [key, id] of Object.entries(ids)) $("#" + id).value = state.options[key];
      recompute();
    });
    $("#btn-report").addEventListener("click", () => {
      const payload = exportPayload();
      ZipKit.downloadBlob(new TextEncoder().encode(JSON.stringify(payload.report, null, 2)), payload.base + "-report.json", "application/json");
    });
    $("#btn-export").addEventListener("click", doExport);
    $("#btn-clear-log").addEventListener("click", () => {
      $("#log").innerHTML = "";
    });

    // Tabs
    $$(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const view = btn.dataset.view;
        $$(".view").forEach((v) => v.classList.remove("active"));
        const el = $(`#view-${view}`);
        if (el) el.classList.add("active");
      });
    });

    // Format cards
    $$(".format-card").forEach((card) => {
      card.addEventListener("click", () => {
        $$(".format-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
    });
  }

  // ---------- Init ----------
  function init() {
    renderMapList();
    renderMasterList();
    renderMapTable();
    bindEvents();
    log("就绪。拖入 .drawio 文件或点击「载入示例」。");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
