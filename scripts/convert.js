#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { DrawioParser, VisioBuilder, Converter } = require("./runtime");

const HELP = `Drawio2Visio — local, editable flowchart conversion
Usage: node scripts/convert.js INPUT.drawio [-o OUTPUT_PREFIX] [options]
  --preset beauty|compact   Standardized flowchart sizes (default: beauty)
  --profile FILE.json       Custom profile with a presets object
  --set KEY=NUMBER          processWidth/Height, decisionWidth/Height,
                            startEndWidth/Height (inches), fontSizePt, forceSize=0|1
  --page NUMBER|NAME        Select one page of a multi-page input (1-based)
  --strict                  Reject compatibility warnings before writing files
  --report-only             Inspect input without writing converted files
  --json                    Machine-readable result, including errors and report
  --help                    Show this help
Outputs: .vsdx, .vdx, -visio.svg, -config.json, -report.json
`;

function parseArgs(argv) {
  const args = { sets: {}, preset: "beauty" };
  const flags = { "--json": "json", "--strict": "strict", "--report-only": "reportOnly", "--help": "help", "-h": "help" };
  const values = { "-o": "output", "--preset": "preset", "--profile": "profile", "--page": "page" };
  const keys = new Set(["forceSize", "processWidth", "processHeight", "decisionWidth", "decisionHeight", "startEndWidth", "startEndHeight", "fontSizePt"]);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (flags[token]) args[flags[token]] = true;
    else if (values[token]) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(token + " 缺少值");
      args[values[token]] = argv[++i];
    } else if (token === "--set") {
      const match = /^([^=]+)=(.+)$/.exec(argv[++i] || "");
      if (!match || !keys.has(match[1])) throw new Error("未知 --set 参数；请查看 --help（不支持自动重排间距）。");
      const number = Number(match[2]);
      if (!Number.isFinite(number) || (match[1] === "forceSize" && ![0, 1].includes(number))) throw new Error("无效参数：" + match[0]);
      args.sets[match[1]] = number;
    } else if (!token.startsWith("-") && !args.input) args.input = token;
    else throw new Error("未知参数：" + token);
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return; }
  if (!args.input) throw new Error(HELP);
  const input = path.resolve(args.input);
  const base = args.output || path.join(__dirname, "..", "outputs", path.basename(input).replace(/\.(drawio|xml)$/i, ""));
  const profile = JSON.parse(fs.readFileSync(args.profile || path.join(__dirname, "..", "templates", "user-style-profile.json"), "utf8"));
  const options = Converter.resolveOptions(args.preset, args.sets, profile);
  const graph = Converter.selectPage(await DrawioParser.parseDrawio(fs.readFileSync(input, "utf8")), args.page);
  const payload = Converter.prepare(graph, options, { sourceName: path.basename(input) });
  payload.base = path.basename(base);
  const report = payload.report;
  if (report.status === "error" || (args.strict && report.summary.warnings)) {
    const error = new Error(report.status === "error" ? "输入检查失败" : "严格模式拒绝兼容性警告；请检查 report.issues。");
    error.report = report;
    throw error;
  }
  const outputs = {};
  if (!args.reportOnly) {
    const files = {
      vsdx: [".vsdx", Buffer.from(VisioBuilder.buildVsdx(payload))],
      vdx: [".vdx", VisioBuilder.buildVdx(payload)],
      svg: ["-visio.svg", VisioBuilder.buildSvg(payload)],
      config: ["-config.json", VisioBuilder.buildConfig(payload)],
      report: ["-report.json", JSON.stringify(report, null, 2)],
    };
    fs.mkdirSync(path.dirname(base), { recursive: true });
    for (const [name, [suffix, data]] of Object.entries(files)) {
      fs.writeFileSync(base + suffix, data);
      outputs[name] = base + suffix;
    }
  }
  const types = {};
  for (const node of payload.nodes) types[node.type] = (types[node.type] || 0) + 1;
  const result = { ok: true, input, outputs, stats: { nodes: payload.nodes.length, edges: payload.edges.length, types }, options, preset: args.preset, report };
  if (args.json || args.reportOnly) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("转换：" + result.stats.nodes + " 节点 / " + result.stats.edges + " 连线；兼容性提示 " + report.summary.warnings + " 项");
    for (const issue of report.issues.filter((i) => i.severity !== "info")) console.error(issue.code + ": " + issue.message + " [" + issue.ids.join(", ") + "]");
    console.log("输出：" + outputs.vsdx + "\n报告：" + outputs.report);
  }
}

main(process.argv.slice(2)).catch((error) => {
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ok: false, error: error.message, report: error.report || null }, null, 2));
  else console.error(error.message);
  process.exitCode = 1;
});
