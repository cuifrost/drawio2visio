#!/usr/bin/env node
/** Rebuild README diagrams from the public fixture and the shared converter. */
const fs = require("node:fs");
const path = require("node:path");
const { DrawioParser, VisioBuilder, Converter } = require("./runtime");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "docs/assets");
const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const label = (x, y, text, size = 18, color = "#142238", weight = 400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(text)}</text>`;
const shell = (w, h, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Drawio2Visio documentation figure"><rect width="100%" height="100%" rx="20" fill="#F3F6FB"/><g font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif">${content}</g></svg>\n`;

function embed(svg, x, y, width, height, prefix) {
  return svg.replace(/<\?xml[^>]+>\s*/, "").replace(/<svg ([^>]+)>/, (_, attrs) =>
    '<svg ' + attrs.replace(/\bwidth="[^"]*"/, 'width="' + width + '"').replace(/\bheight="[^"]*"/, 'height="' + height + '"') + ' x="' + x + '" y="' + y + '">'
  ).replace(/id="arrow"/g, 'id="' + prefix + '-arrow"').replace(/url\(#arrow\)/g, 'url(#' + prefix + '-arrow)');
}

function sourcePreview(graph) {
  const x0 = Math.min(...graph.nodes.map((n) => n.x)) - 40;
  const y0 = Math.min(...graph.nodes.map((n) => n.y)) - 40;
  const w = Math.max(...graph.nodes.map((n) => n.x + n.width)) - x0 + 40;
  const h = Math.max(...graph.nodes.map((n) => n.y + n.height)) - y0 + 40;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let content = '<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#60728A"/></marker></defs>';
  for (const e of graph.edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2, tx = t.x + t.width / 2, ty = t.y + t.height / 2;
    const dx = tx - sx, dy = ty - sy, horizontal = Math.abs(dx) >= Math.abs(dy);
    const x1 = horizontal ? sx + Math.sign(dx) * s.width / 2 : sx;
    const x2 = horizontal ? tx - Math.sign(dx) * t.width / 2 : tx;
    const y1 = horizontal ? sy : sy + Math.sign(dy) * s.height / 2;
    const y2 = horizontal ? ty : ty - Math.sign(dy) * t.height / 2;
    content += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#60728A" marker-end="url(#arrow)"/>`;
    if (e.text) content += label((x1+x2)/2 + 8, (y1+y2)/2 - 7, e.text, 14, "#60728A");
  }
  for (const n of graph.nodes) {
    const style = n.styleMap, cx = n.x+n.width/2, cy = n.y+n.height/2;
    const paint = `fill="${style.fillColor}" stroke="${style.strokeColor}" stroke-width="1.5"`;
    if (style.rhombus) content += `<polygon points="${cx},${n.y} ${n.x+n.width},${cy} ${cx},${n.y+n.height} ${n.x},${cy}" ${paint}/>`;
    else content += `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${style.ellipse ? n.height/2 : 0}" ${paint}/>`;
    content += `<text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="${style.fontSize}" fill="#142238">${esc(n.text)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" height="${h}">${content}</svg>`;
}

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  const graph = await DrawioParser.parseDrawio(fs.readFileSync(path.join(root, "examples/review-flow.drawio"), "utf8"));
  const profile = JSON.parse(fs.readFileSync(path.join(root, "templates/user-style-profile.json"), "utf8"));
  const beauty = Converter.prepare(graph, Converter.resolveOptions("beauty", {}, profile));
  const compact = Converter.prepare(graph, Converter.resolveOptions("compact", {}, profile));
  let hero = label(48, 70, "Drawio2Visio", 40, "#142238", 700) + label(48, 111, "Editable flowcharts. Consistent sizes. Visible conversion trade-offs.", 21, "#60728A");
  const boxes = [
    [48, "01  INPUT", ".drawio / XML", "Local files · plain or compressed"],
    [492, "02  STANDARDIZE", "Native Visio shapes", "Presets · fonts · glued connectors"],
    [936, "03  DELIVER", ".vsdx + report", "Editable geometry · reviewable results"],
  ];
  for (const [x, title, text, sub] of boxes) hero += `<rect x="${x}" y="155" width="396" height="145" rx="12" fill="#fff" stroke="#D5DFEC"/>` + label(x+24,190,title,14,"#2966CE",700) + label(x+24,230,text,25,"#142238",700) + label(x+24,269,sub,16,"#60728A");
  hero += '<path d="M451 227h30m-8-6 8 6-8 6M895 227h30m-8-6 8 6-8 6" fill="none" stroke="#2966CE" stroke-width="2"/>';
  hero += label(48,345,"Browser + CLI   /   No conversion server   /   Strict compatibility checks",18,"#2966CE",600);
  fs.writeFileSync(path.join(dir,"overview.svg"),shell(1380,385,hero));
  let comparison = label(40,58,"One flowchart, two delivery profiles",30,"#142238",700) + label(40,91,"Generated from examples/review-flow.drawio. SVG previews, not Microsoft Visio screenshots.",16,"#60728A");
  const panes = [
    [32,"Source layout","Mixed widths, heights and font sizes",sourcePreview(graph),"source"],
    [490,"beauty · 8 pt","Process: 55.9 × 10.0 mm",VisioBuilder.buildSvg(beauty),"beauty"],
    [948,"compact · 7.5 pt","Process: 47.0 × 8.9 mm",VisioBuilder.buildSvg(compact),"compact"],
  ];
  for (const [x,title,sub,svg,prefix] of panes) {
    comparison += `<rect x="${x}" y="122" width="430" height="616" rx="12" fill="#fff" stroke="#D5DFEC"/>`;
    comparison += label(x+22,160,title,23,"#142238",700) + label(x+22,190,sub,15,"#60728A");
    comparison += embed(svg,x+16,214,398,482,prefix);
  }
  comparison += label(40,780,"Node positions and labels stay in the source order; dimensions and type styling follow the selected profile.",17,"#60728A");
  fs.writeFileSync(path.join(dir,"profiles.svg"),shell(1410,820,comparison));
  const problematic = await DrawioParser.parseDrawio(fs.readFileSync(path.join(root,"examples/compatibility.drawio"),"utf8"));
  const report = Converter.prepare(problematic,{}).report;
  let diagnostics = label(40,57,"Check before delivery",30,"#142238",700) + label(40,93,"Every warning points back to a source ID. Strict mode stops conversion before writing files.",18,"#60728A");
  diagnostics += '<rect x="40" y="128" width="650" height="273" rx="12" fill="#fff" stroke="#D5DFEC"/>';
  diagnostics += label(66,165,"compatibility.drawio",22,"#142238",700) + label(66,207,report.summary.nodesInput+" nodes → "+report.summary.nodesExported+" shapes",20) + label(66,246,report.summary.edgesInput+" edges → "+report.summary.edgesExported+" connector",20);
  report.issues.filter(i=>i.severity==="warning").forEach((i,index)=> {
    diagnostics += label(66,297+index*38,i.code+"  ["+i.ids.join(", ")+"]",17,"#92652A",600);
  });
  diagnostics += '<rect x="726" y="128" width="560" height="273" rx="12" fill="#142238"/>';
  diagnostics += label(754,170,"--report-only",22,"#fff",600) + label(754,208,"Inspect compatibility without exporting.",18,"#B7C7DE") + label(754,264,"--strict",22,"#fff",600) + label(754,302,"Any warning → non-zero exit; no new files.",18,"#B7C7DE") + label(754,367,"JSON report + source IDs + actual dimensions",17,"#82B4FF");
  fs.writeFileSync(path.join(dir,"diagnostics.svg"),shell(1326,435,diagnostics));
  console.log("Rebuilt overview.svg, profiles.svg and diagnostics.svg from public examples.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
