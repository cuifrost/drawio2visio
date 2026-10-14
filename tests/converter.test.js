const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { DrawioParser, VisioBuilder, Converter } = require("../scripts/runtime");
const example = fs.readFileSync(path.join(__dirname, "../examples/review-flow.drawio"), "utf8");
const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="测试 &amp; 100%" vertex="1" parent="1"><mxGeometry x="-70" y="-30" width="16" height="12"/></mxCell></root></mxGraphModel>';

test("bare mxGraphModel and percent-encoded compressed drawio preserve text", async () => {
  const plain = await DrawioParser.parseDrawio(model);
  for (const source of [model, encodeURIComponent(model)]) {
    const payload = zlib.deflateRawSync(Buffer.from(source)).toString("base64");
    const compressed = await DrawioParser.parseDrawio('<mxfile><diagram>' + payload + '</diagram></mxfile>');
    assert.equal(compressed.nodes[0].text, plain.nodes[0].text);
    assert.equal(compressed.compressed, true);
  }
});

test("public fixture converts seven nodes and six glued edges without warnings", async () => {
  const graph = await DrawioParser.parseDrawio(example);
  const payload = Converter.prepare(graph, Converter.resolveOptions());
  assert.deepEqual(payload.report.summary, { nodesInput: 7, nodesExported: 7, edgesInput: 6, edgesExported: 6, warnings: 0 });
  assert.equal(payload.report.status, "ready");
  assert.equal(payload.nodes[0].type, "startEnd");
});

test("compact and custom snake/camel profiles actually alter options", () => {
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, "../templates/user-style-profile.json"), "utf8"));
  const compact = Converter.resolveOptions("compact", {}, profile);
  assert.deepEqual(Converter.resolveOptions(), Converter.resolveOptions("beauty", {}, profile));
  assert.equal(compact.processWidth, 1.85);
  assert.equal(compact.fontSizePt, 7.5);
  assert.equal(Converter.resolveOptions("paper", {}, { presets: { paper: { processWidth: 3, font_size_pt: 10 } } }).processWidth, 3);
  assert.equal(Converter.resolveOptions("paper", {}, { presets: { paper: { processWidthIn: 3, font_size_pt: 10 } } }).fontSizePt, 10);
  assert.throws(() => Converter.resolveOptions("unknown"));
  assert.throws(() => Converter.resolveOptions("beauty", { processWidth: -1 }));
});

test("natural size preserves tiny shapes and standardized size fits negative coordinates", async () => {
  const graph = await DrawioParser.parseDrawio(model);
  const natural = Converter.prepare(graph, { forceSize: false });
  assert.equal(natural.nodes[0].widthIn, 0.1667);
  assert.equal(natural.nodes[0].heightIn, 0.125);
  const payload = Converter.prepare(graph, { processWidth: 4 });
  for (const n of payload.nodes) {
    assert.ok(n.visioX - n.widthIn / 2 >= 0.4999);
    assert.ok(n.visioY - n.heightIn / 2 >= 0.4999);
    assert.ok(n.visioX + n.widthIn / 2 < payload.pageWidthIn);
  }
});

test("multiple pages with repeated IDs require explicit selection", async () => {
  const xml = '<mxfile><diagram name="first">' + model + '</diagram><diagram name="second">' + model.replace('测试', '第二页') + '</diagram></mxfile>';
  const graph = await DrawioParser.parseDrawio(xml);
  assert.throws(() => Converter.selectPage(graph), /--page/);
  const page = Converter.selectPage(graph, "second");
  assert.equal(page.nodes.length, 1);
  assert.equal(page.nodes[0].text, "第二页 & 100%");
  assert.equal(page.nodes[0].y, -30);
  assert.equal(page.selectedPage, 2);
  assert.throws(() => Converter.selectPage(graph, "3"));
});

test("UserObject wrappers and HTML labels preserve label, ID and lines", async () => {
  const graph = await DrawioParser.parseDrawio('<mxfile><diagram><mxGraphModel><root><UserObject id="wrapped" label="A&lt;br&gt;中文"><mxCell vertex="1" parent="1"><mxGeometry width="100" height="40"/></mxCell></UserObject></root></mxGraphModel></diagram></mxfile>');
  assert.equal(graph.nodes[0].id, "wrapped");
  assert.equal(graph.nodes[0].text, "A\n中文");
});

test("text labels retain their own dimensions and have no master", async () => {
  const graph = await DrawioParser.parseDrawio(model.replace('vertex="1"', 'style="text;" vertex="1"'));
  const payload = Converter.prepare(graph, { forceSize: true });
  assert.equal(payload.nodes[0].type, "label");
  assert.equal(payload.nodes[0].widthIn, 0.1667);
  assert.equal(payload.report.shapes[0].master, "");
});

test("simplified shapes, omitted edges, overlap and overflow appear in diagnostics", async () => {
  const graph = await DrawioParser.parseDrawio(fs.readFileSync(path.join(__dirname, "../examples/compatibility.drawio"), "utf8"));
  const payload = Converter.prepare(graph, { fontSizePt: 30, processWidth: 0.1 });
  const codes = payload.report.issues.map((i) => i.code);
  assert.ok(codes.includes("SHAPE_SIMPLIFIED"));
  assert.ok(codes.includes("EDGE_OMITTED"));
  assert.ok(codes.includes("TEXT_MAY_OVERFLOW"));
  assert.equal(payload.edges.length, 1);
  graph.nodes[1].x = graph.nodes[0].x;
  graph.nodes[1].y = graph.nodes[0].y;
  assert.ok(Converter.prepare(graph, {}).report.issues.some((i) => i.code === "SHAPES_OVERLAP"));
});

test("empty, duplicate and invalid geometry produce errors", async () => {
  const graph = await DrawioParser.parseDrawio(model);
  graph.nodes.push({ ...graph.nodes[0], width: 0 });
  const payload = Converter.prepare(graph, {});
  assert.equal(payload.report.status, "error");
  assert.ok(payload.report.issues.some((i) => i.code === "DUPLICATE_ID"));
  assert.ok(payload.report.issues.some((i) => i.code === "INVALID_GEOMETRY"));
  assert.equal(Converter.prepare({ pages: ["empty"], nodes: [], edges: [] }, {}).report.status, "error");
});

test("SVG uses the output dimensions and font, with no foreignObject", async () => {
  const graph = await DrawioParser.parseDrawio(example);
  const payload = Converter.prepare(graph, { fontSizePt: 10, decisionWidth: 3 });
  const svg = VisioBuilder.buildSvg(payload);
  assert.match(svg, /font-size="13\.333/);
  assert.ok(svg.includes(String(payload.pageWidthIn * 96)));
  assert.ok(!svg.includes("foreignObject"));
  assert.match(svg, /提交审核/);
});

test("shared config and report omit input directories", async () => {
  const payload = Converter.prepare(await DrawioParser.parseDrawio(example), {}, { sourceName: "C:\\Users\\person\\private\\test.drawio" });
  assert.equal(payload.report.source, "test.drawio");
  assert.equal(JSON.parse(VisioBuilder.buildConfig(payload)).source, "test.drawio");
  assert.ok(!JSON.stringify(payload.report).includes("Users"));
});
