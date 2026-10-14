/**
 * Minimal ZIP writer (STORE method) for .vsdx / package export.
 * No external deps — works offline in modern browsers.
 */
(function (global) {
  const encoder = new TextEncoder();

  function crc32(buf) {
    if (!crc32.table) {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      crc32.table = t;
    }
    const table = crc32.table;
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
      c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
    }
    return (c ^ -1) >>> 0;
  }

  function dosDateTime(date) {
    const d = date || new Date();
    const year = Math.max(1980, d.getFullYear());
    const dosTime =
      (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate =
      ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { dosTime, dosDate };
  }

  /**
   * @param {{name: string, data: string|Uint8Array}[]} files
   * @returns {Uint8Array}
   */
  function createZip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const { dosTime, dosDate } = dosDateTime();

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data =
        typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);

      // Local file header
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // UTF-8 flag
      lv.setUint16(8, 0, true); // store
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      parts.push(local, data);

      // Central directory entry
      const centralEntry = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralEntry.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centralEntry.set(nameBytes, 46);
      central.push(centralEntry);

      offset += local.length + data.length;
    }

    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + centralSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    for (const part of parts) {
      out.set(part, p);
      p += part.length;
    }
    for (const c of central) {
      out.set(c, p);
      p += c.length;
    }
    out.set(end, p);
    return out;
  }

  function downloadBlob(bytes, filename, mime) {
    const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  global.ZipKit = { createZip, downloadBlob, crc32, encoder };
})(window);
