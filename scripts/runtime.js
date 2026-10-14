/** Load the same converter used by index.html, without a browser process. */
const { DOMParser } = require("@xmldom/xmldom");
const { inflateRawSync } = require("node:zlib");
globalThis.window = globalThis;
globalThis.DOMParser = DOMParser;
globalThis.inflateDrawioRaw = (bytes) => new Uint8Array(inflateRawSync(bytes));
for (const name of ["zip", "vsdx-skeleton", "drawio-parser", "mapper", "vsdx-builder", "converter"]) {
  require("../js/" + name + ".js");
}
module.exports = { DrawioParser: globalThis.DrawioParser, VisioBuilder: globalThis.VisioBuilder, Converter: globalThis.Converter };
