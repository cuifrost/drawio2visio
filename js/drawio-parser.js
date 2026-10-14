/**
 * Draw.io XML parser
 * Supports: plain mxGraphModel XML, base64+raw-deflate compressed <diagram> payloads.
 * DOM helper works with browsers and @xmldom/xmldom (getElementsByTagName fallback).
 */
(function (global) {
  const decoder = new TextDecoder("utf-8");

  /** First descendant by tag name (case-insensitive). */
  function firstTag(root, name) {
    if (!root) return null;
    if (root.querySelector) {
      return root.querySelector(name);
    }
    const list = root.getElementsByTagName(name);
    return list && list.length ? list[0] : null;
  }

  /** All descendants by tag name. */
  function allTags(root, name) {
    if (!root) return [];
    if (root.querySelectorAll) {
      return [...root.querySelectorAll(name)];
    }
    const list = root.getElementsByTagName(name);
    return list ? Array.from(list) : [];
  }

  function ownTag(el) {
    return (el && (el.localName || el.tagName || el.nodeName) || "").toLowerCase();
  }

  /** Inflate raw deflate (wbits = -15) or zlib (wbits = 15). */
  async function inflateMaybe(base64) {
    const binary = atob(base64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Node 18 does not support DecompressionStream("deflate-raw").
    // The CLI supplies zlib without adding a browser dependency.
    if (global.inflateDrawioRaw) {
      return global.inflateDrawioRaw(bytes);
    }

    if (typeof DecompressionStream !== "undefined") {
      for (const format of ["deflate-raw", "deflate", "gzip"]) {
        try {
          const ds = new DecompressionStream(format);
          const stream = new Blob([bytes]).stream().pipeThrough(ds);
          const buf = await new Response(stream).arrayBuffer();
          return new Uint8Array(buf);
        } catch (_) {
          /* try next */
        }
      }
    }
    return null;
  }

  function parseStyle(style) {
    const map = {};
    if (!style) return map;
    for (const part of String(style).split(";")) {
      if (!part) continue;
      const idx = part.indexOf("=");
      if (idx === -1) {
        map[part.trim()] = "1";
      } else {
        map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
      }
    }
    return map;
  }

  function parseGeometry(cell) {
    const geoEl = firstTag(cell, "mxGeometry");
    if (!geoEl) return { x: 0, y: 0, width: 80, height: 40 };
    return {
      x: parseFloat(geoEl.getAttribute("x") || "0"),
      y: parseFloat(geoEl.getAttribute("y") || "0"),
      width: parseFloat(geoEl.getAttribute("width") || "80"),
      height: parseFloat(geoEl.getAttribute("height") || "40"),
    };
  }

  function extractText(cell) {
    const wrapper = cell.parentNode;
    const val = cell.getAttribute("value") ||
      (wrapper && /^(object|userobject)$/.test(ownTag(wrapper))
        ? wrapper.getAttribute("label") || wrapper.getAttribute("value") : "") || "";
    if (val) {
      return val
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(div|p)>\s*<(div|p)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    }
    return "";
  }

  /**
   * Parse a .drawio / mxfile XML string into a normalized graph.
   * @returns {Promise<{pages: string[], nodes: Array, edges: Array, rawXml: string, compressed: boolean}>}
   */
  async function parseDrawio(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");

    // Detect parse errors (browser) or missing root (xmldom)
    const parseError = doc.querySelector
      ? doc.querySelector("parsererror")
      : firstTag(doc, "parsererror");
    if (parseError) {
      throw new Error("XML 解析失败：" + (parseError.textContent || "未知错误").slice(0, 120));
    }

    const root = doc.documentElement;
    if (!root || !["mxfile", "mxgraphmodel"].includes(ownTag(root))) {
      throw new Error("不是有效的 Draw.io（mxfile / mxGraphModel）文件");
    }

    let diagrams = allTags(root, "diagram");
    // Only top-level diagrams under mxfile (avoid nested noise)
    diagrams = diagrams.filter((d) => {
      let p = d.parentNode;
      while (p && p !== root) {
        if (ownTag(p) === "diagram") return false;
        p = p.parentNode;
      }
      return true;
    });

    if (!diagrams.length) {
      let model = firstTag(root, "mxGraphModel");
      if (!model && ownTag(root) === "mxgraphmodel") model = root;
      if (model) {
        const graph = parseModel(model, "Page-1");
        return {
          ...graph,
          rawXml: xmlText,
          restoredXml: xmlText,
          compressed: false,
          pages: ["Page-1"],
        };
      }
      throw new Error("未找到 diagram / mxGraphModel 节点");
    }

    const nodes = [];
    const edges = [];
    const pages = [];
    let compressed = false;
    const restoredModels = [];

    for (let i = 0; i < diagrams.length; i++) {
      const diagram = diagrams[i];
      const pageName = diagram.getAttribute("name") || `Page-${i + 1}`;
      pages.push(pageName);

      let modelXml = firstTag(diagram, "mxGraphModel");
      const textContent = (diagram.textContent || "").trim();

      if (!modelXml && textContent) {
        compressed = true;
        const inflated = await inflateMaybe(textContent);
        if (inflated) {
          const payload = decoder.decode(inflated);
          // diagrams.net compresses encodeURIComponent(XML), not just XML.
          const xml = payload.trimStart().startsWith("%") ? decodeURIComponent(payload) : payload;
          const d2 = parser.parseFromString(xml, "application/xml");
          modelXml = firstTag(d2, "mxGraphModel") || (ownTag(d2.documentElement) === "mxgraphmodel" ? d2.documentElement : null);
          restoredModels.push(xml);
        } else {
          const d2 = parser.parseFromString(textContent, "application/xml");
          modelXml = firstTag(d2, "mxGraphModel");
          if (modelXml) {
            restoredModels.push(textContent);
            compressed = false;
          }
        }
      }

      if (!modelXml) {
        throw new Error(
          `页面「${pageName}」无法解压或解析（浏览器需支持 DecompressionStream，或提供明文 XML）`
        );
      }

      const graph = parseModel(modelXml, pageName);
      for (const n of graph.nodes) {
        n.pageIndex = i;
        n.page = pageName;
        nodes.push(n);
      }
      for (const e of graph.edges) {
        e.pageIndex = i;
        e.page = pageName;
        edges.push(e);
      }
    }

    return {
      pages,
      nodes,
      edges,
      rawXml: xmlText,
      restoredXml: restoredModels.join("\n"),
      compressed,
    };
  }

  function parseModel(modelEl, pageName) {
    const cells = allTags(modelEl, "mxCell");
    const nodes = [];
    const edges = [];

    for (const cell of cells) {
      const wrapper = cell.parentNode;
      const id = cell.getAttribute("id") ||
        (wrapper && /^(object|userobject)$/.test(ownTag(wrapper)) ? wrapper.getAttribute("id") : null);
      const style = cell.getAttribute("style") || "";
      const value = cell.getAttribute("value") || "";
      const vertex = cell.getAttribute("vertex") === "1";
      const edge = cell.getAttribute("edge") === "1";
      const parent = cell.getAttribute("parent");
      if (id === "0" || id === "1") continue;

      const styleMap = parseStyle(style);
      const geo = parseGeometry(cell);
      const text = extractText(cell);

      if (vertex) {
        nodes.push({
          id,
          page: pageName,
          text,
          rawValue: value,
          style,
          styleMap,
          x: geo.x,
          y: geo.y,
          width: geo.width,
          height: geo.height,
          relative: firstTag(cell, "mxGeometry")?.getAttribute("relative") === "1",
          parent,
        });
      } else if (edge) {
        const geoEl = firstTag(cell, "mxGeometry");
        const points = [];
        let sourcePoint = null;
        let targetPoint = null;

        if (geoEl) {
          const pts = allTags(geoEl, "mxPoint");
          for (const pt of pts) {
            const as = pt.getAttribute("as") || "";
            const rec = {
              x: parseFloat(pt.getAttribute("x") || "0"),
              y: parseFloat(pt.getAttribute("y") || "0"),
              as: as || "waypoint",
            };
            if (as === "sourcePoint") sourcePoint = { x: rec.x, y: rec.y };
            else if (as === "targetPoint") targetPoint = { x: rec.x, y: rec.y };
            else points.push(rec);
          }
        }

        edges.push({
          id,
          page: pageName,
          text,
          style,
          styleMap,
          source: cell.getAttribute("source"),
          target: cell.getAttribute("target"),
          sourcePoint,
          targetPoint,
          points,
          parent,
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Build a structured "normalized XML" preview string.
   */
  function toNormalizedXml(graph) {
    const esc = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const lines = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<DrawioGraph source="drawio" pages="${graph.pages.length}">`);
    for (const page of graph.pages) {
      lines.push(`  <Page name="${esc(page)}">`);
    }
    lines.push(`    <Shapes>`);
    for (const n of graph.nodes) {
      lines.push(
        `      <Shape id="${esc(n.id)}" text="${esc(n.text)}" x="${n.x}" y="${n.y}" w="${n.width}" h="${n.height}">`
      );
      lines.push(`        <Style><![CDATA[${n.style}]]></Style>`);
      lines.push(`      </Shape>`);
    }
    lines.push(`    </Shapes>`);
    lines.push(`    <Connects>`);
    for (const e of graph.edges) {
      lines.push(
        `      <Connect id="${esc(e.id)}" from="${esc(e.source || "")}" to="${esc(e.target || "")}" text="${esc(e.text)}"/>`
      );
    }
    lines.push(`    </Connects>`);
    for (const page of graph.pages) {
      lines.push(`  </Page>`);
    }
    lines.push(`</DrawioGraph>`);
    return lines.join("\n");
  }

  global.DrawioParser = { parseDrawio, parseStyle, toNormalizedXml, parseModel };
})(typeof window !== "undefined" ? window : globalThis);
