/* Client-side file exporters: PNG (with physical-DPI metadata), ZIP
 * (store method), and multi-page PDF — all dependency-free.
 *
 * PNG: canvas.toBlob() emits no resolution info, so we splice a pHYs
 * chunk in after IHDR so printers/editors see the true physical size.
 *
 * PDF: hand-rolled writer. Each label becomes one page whose MediaBox
 * matches the physical plate size; the page image is stored losslessly
 * (FlateDecode via CompressionStream, raw fallback where unsupported).
 */

"use strict";

const TE = new TextEncoder();

// ---------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, seed = 0xffffffff) {
  let c = seed;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return c;
}

function crc32Final(bytes) {
  return (crc32(bytes) ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------- PNG pHYs chunk

/** Insert a pHYs chunk (physical resolution) into a PNG right after IHDR. */
function pngWithDpi(pngBuffer, dpi) {
  const src = new Uint8Array(pngBuffer);
  const ppm = Math.round(dpi / 0.0254); // pixels per metre

  // pHYs chunk: length(4) + "pHYs" + x-ppm(4) + y-ppm(4) + unit(1) + crc(4)
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set(TE.encode("pHYs"), 4);
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32Final(chunk.subarray(4, 17)));

  // PNG layout: 8-byte signature, then IHDR (4 len + 4 type + 13 data + 4 crc)
  const insertAt = 8 + 4 + 4 + 13 + 4;
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(src.subarray(insertAt), insertAt + chunk.length);
  return out;
}

// ------------------------------------------------------------ ZIP (store)

/** Build a ZIP (no compression — PNGs are already compressed).
 *  entries: [{ name: string, data: Uint8Array }] */
function zipStore(entries) {
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = TE.encode(name);
    const crc = crc32Final(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);        // version needed
    dv.setUint16(8, 0, true);         // method: store
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const cdir = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdir.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);   // local header offset
    cdir.set(nameBytes, 46);
    central.push(cdir);

    parts.push(local, data);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

// ------------------------------------------------------------------ PDF

async function zlibDeflate(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extract RGB pixel bytes from a canvas, flattened onto white. */
function canvasRgbBytes(canvas) {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const fctx = flat.getContext("2d");
  fctx.fillStyle = "#fff";
  fctx.fillRect(0, 0, flat.width, flat.height);
  fctx.drawImage(canvas, 0, 0);

  const rgba = fctx.getImageData(0, 0, flat.width, flat.height).data;
  const rgb = new Uint8Array(flat.width * flat.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}

/** Multi-page PDF: one canvas per page, page size = pixels / dpi. */
async function buildPdf(canvases, dpi) {
  const chunks = [];
  let length = 0;
  const offsets = [0]; // object number -> byte offset (index 0 unused)

  const push = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushText = (s) => push(TE.encode(s));
  const beginObj = () => {
    offsets.push(length);
    return offsets.length - 1; // object number just started
  };

  pushText("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  const n = canvases.length;
  // Object numbering: 1 catalog, 2 pages, then per page k (0-based):
  // page = 3+3k, contents = 4+3k, image = 5+3k
  const pageRefs = Array.from({ length: n }, (_, k) => `${3 + 3 * k} 0 R`);

  beginObj();
  pushText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObj();
  pushText(
    `2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${n} >>\nendobj\n`
  );

  for (let k = 0; k < n; k++) {
    const canvas = canvases[k];
    const wPt = (canvas.width * 72) / dpi;
    const hPt = (canvas.height * 72) / dpi;
    const pageNum = 3 + 3 * k;
    const contentsNum = 4 + 3 * k;
    const imageNum = 5 + 3 * k;

    beginObj();
    pushText(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${wPt.toFixed(3)} ${hPt.toFixed(3)}] ` +
        `/Resources << /XObject << /Im0 ${imageNum} 0 R >> >> ` +
        `/Contents ${contentsNum} 0 R >>\nendobj\n`
    );

    const content = TE.encode(
      `q ${wPt.toFixed(3)} 0 0 ${hPt.toFixed(3)} 0 0 cm /Im0 Do Q`
    );
    beginObj();
    pushText(`${contentsNum} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    push(content);
    pushText("\nendstream\nendobj\n");

    const rgb = canvasRgbBytes(canvas);
    const deflated = await zlibDeflate(rgb);
    const data = deflated || rgb;
    const filter = deflated ? "/Filter /FlateDecode " : "";
    beginObj();
    pushText(
      `${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image ` +
        `/Width ${canvas.width} /Height ${canvas.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ${filter}` +
        `/Length ${data.length} >>\nstream\n`
    );
    push(data);
    pushText("\nendstream\nendobj\n");
  }

  const objCount = offsets.length; // includes the free object 0
  const xrefStart = length;
  let xref = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (let i = 1; i < objCount; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objCount} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  pushText(xref);

  return new Blob(chunks, { type: "application/pdf" });
}

// ------------------------------------------------------------ download

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
