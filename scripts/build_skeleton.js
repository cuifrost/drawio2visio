#!/usr/bin/env node
/**
 * Project-authored minimal VSDX parts.
 * No customer documents, Office stock icons or extracted proprietary stencils.
 * Format reference: https://learn.microsoft.com/en-us/office/client-developer/visio/visio-file-format-reference
 */
const fs = require("node:fs");
const path = require("node:path");
const V = "http://schemas.microsoft.com/office/visio/2012/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const cell = (name, value, formula) => `<Cell N="${name}" V="${value}"${formula ? ' F="' + formula + '"' : ""}/>`;
const point = (index, kind, x, y) => `<Row IX="${index}" T="${kind}">${cell("X", x, "Width*" + x)}${cell("Y", y, "Height*" + y)}</Row>`;
const textStyle = '<Section N="Character"><Row IX="0">' + cell("Font", "Themed", "THEMEVAL()") + cell("AsianFont", "Themed", "THEMEVAL()") + cell("Size", 8/72) + cell("Color", "#000000") + '</Row></Section><Section N="Paragraph"><Row IX="0">' + cell("HorzAlign", 1) + '</Row></Section>';

function master(kind) {
  const connector = kind === "connector";
  const width = connector ? 1 : 2.2, height = connector ? 0 : 0.394;
  let cells = cell("PinX", width/2, connector ? "GUARD((BeginX+EndX)/2)" : undefined)
    + cell("PinY", height/2, connector ? "GUARD((BeginY+EndY)/2)" : undefined)
    + cell("Width", width, connector ? "GUARD(EndX-BeginX)" : undefined)
    + cell("Height", height, connector ? "GUARD(EndY-BeginY)" : undefined)
    + cell("LocPinX",width/2,"Width*0.5") + cell("LocPinY",height/2,"Height*0.5")
    + cell("LineWeight",0.5/72) + cell("LineColor","#000000") + cell("LinePattern",1)
    + cell("FillForegnd","#ffffff") + cell("FillPattern",connector ? 0 : 1)
    + cell("TxtPinX",width/2,"Width*0.5") + cell("TxtPinY",height/2,"Height*0.5")
    + cell("TxtWidth",connector ? 0.5556 : width,connector ? "MAX(TEXTWIDTH(TheText),5*Char.Size)" : "Width")
    + cell("TxtHeight",0.2,connector ? "TEXTHEIGHT(TheText,TxtWidth)" : "Height")
    + cell("TxtLocPinX",connector ? 0.2778 : width/2,"TxtWidth*0.5")
    + cell("TxtLocPinY",0.1,"TxtHeight*0.5") + cell("VerticalAlign",1);
  let geometry;
  if (connector) {
    cells += cell("BeginX",0) + cell("BeginY",0) + cell("EndX",1) + cell("EndY",0)
      + cell("BegTrigger",0) + cell("EndTrigger",0) + cell("WalkPreference",0)
      + cell("ObjType",2) + cell("GlueType",2) + cell("EndArrow",4) + cell("EndArrowSize",2)
      + cell("ShapeRouteStyle",6) + cell("ConFixedCode",6) + cell("DynFeedback",2);
    geometry = '<Row IX="1" T="MoveTo">' + cell("X",0) + cell("Y",0) + '</Row><Row IX="2" T="LineTo">' + cell("X",width,"Width") + cell("Y",height,"Height") + '</Row>';
  } else if (kind === "decision") {
    geometry = point(1,"MoveTo",0,0.5) + point(2,"LineTo",0.5,1) + point(3,"LineTo",1,0.5) + point(4,"LineTo",0.5,0) + point(5,"LineTo",0,0.5);
  } else {
    geometry = point(1,"MoveTo",0,0) + point(2,"LineTo",1,0) + point(3,"LineTo",1,1) + point(4,"LineTo",0,1) + point(5,"LineTo",0,0);
    if (kind === "startEnd") cells += cell("Rounding",height/2,"Height*0.5");
  }
  return declaration + `<MasterContents xmlns="${V}"><Shapes><Shape ID="1" Type="Shape" LineStyle="6" FillStyle="6" TextStyle="7">` + cells + textStyle + '<Section N="Geometry" IX="0">' + cell("NoFill",connector ? 1 : 0) + cell("NoLine",0) + geometry + '</Section></Shape></Shapes></MasterContents>';
}

function theme() {
  const colors = { dk1:"142238",lt1:"FFFFFF",dk2:"334155",lt2:"F3F6FB",accent1:"2966CE",accent2:"287D65",accent3:"7352A0",accent4:"BA782B",accent5:"B54758",accent6:"447D8A",hlink:"2966CE",folHlink:"7352A0" };
  const scheme = Object.entries(colors).map(([name,value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`).join("");
  const font = '<a:latin typeface="Calibri"/><a:ea typeface="SimSun"/><a:cs typeface="Arial"/>';
  const fills = Array.from({length:3},()=>'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>').join("");
  const lines = [6350,12700,19050].map(width=>`<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`).join("");
  const effects = Array.from({length:3},()=>'<a:effectStyle><a:effectLst/></a:effectStyle>').join("");
  return declaration + `<a:theme xmlns:a="${A}" name="Drawio2Visio"><a:themeElements><a:clrScheme name="Drawio2Visio">${scheme}</a:clrScheme><a:fontScheme name="Drawio2Visio"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="Drawio2Visio"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${lines}</a:lnStyleLst><a:effectStyleLst>${effects}</a:effectStyleLst><a:bgFillStyleLst>${fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

const definitions = [
  [2,"Dynamic connector","Dynamic connector"],[4,"Start/End","开始/结束"],
  [5,"Process","流程"],[6,"Dynamic connector","动态连接线"],[7,"Decision","判定"],
];
const styles = [0,4,6,7].map(id=>`<StyleSheet ID="${id}" NameU="Drawio2Visio ${id}" Name="Drawio2Visio ${id}">${cell("LineColor","#000000")}${cell("FillForegnd","#ffffff")}${cell("FillPattern",1)}${cell("LinePattern",1)}${cell("LineWeight",0.5/72)}${textStyle}</StyleSheet>`).join("");
const skeleton = {
  theme1: theme(),
  windows: declaration + `<Windows xmlns="${V}" ClientWidth="1200" ClientHeight="800"><Window ID="0" WindowType="Drawing" Page="0" ViewScale="0.8"/></Windows>`,
  validation: declaration + `<Validation xmlns="${V}"/>`,
  core: declaration + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator/></cp:coreProperties>',
  app: declaration + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Drawio2Visio</Application></Properties>',
  master_connector: master("connector"),master_startend:master("startEnd"),
  master_process:master("process"),master_dynconn:master("connector"),master_decision:master("decision"),
  masters: declaration + `<Masters xmlns="${V}" xmlns:r="${R}">` + definitions.map(([id,nameU,name],index)=>`<Master ID="${id}" NameU="${nameU}" Name="${name}" IconUpdate="1"><Rel r:id="rId${index+1}"/></Master>`).join("") + '</Masters>',
  colors: '<ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#ffffff"/>',
  facenames: '<FaceName NameU="Calibri"/><FaceName NameU="SimSun"/><FaceName NameU="Arial"/>',
  stylesheets: styles,
};
const output = '// Generated by scripts/build_skeleton.js. Project-authored; MIT license.\n(function(global) { global.VsdxSkeleton = ' + JSON.stringify(skeleton,null,2) + '; })(typeof window !== "undefined" ? window : globalThis);\n';
fs.writeFileSync(path.join(__dirname,"../js/vsdx-skeleton.js"),output);
console.log("Generated project-authored VSDX skeleton.");
