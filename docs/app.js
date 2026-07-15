/* Drone label generator — app wiring.
 *
 * Config keys mirror label_core.py DEFAULTS (same names, same semantics)
 * plus web-only keys: layout, font_family, number_pad, inner_pad,
 * show_caption.
 */

"use strict";

const DEFAULTS = {
  layout: "vertical-badge",

  // Identity
  label_prefix: "locust-",
  number_start: 601,
  number_end: 612,
  number_pad: 0, // zero-pad width; 0 = none
  url_template: "http://{prefix}{i}:8000/",

  // Plate (physical label) dimensions
  plate_width_mm: 38.1,
  plate_height_mm: 50.8,
  dpi: 240,
  corner_radius_mm: 1.5,

  // Typography
  font_family: "RobotoMono-SemiBold",
  font_size_small: 48,
  font_size_large: 136,
  font_size_tiny: 26,

  // Footer blurbs (one per line)
  footer_lines: ["HW: Gen2-VERT-A"],

  // QR code
  qr_version: 2, // 0 = auto
  qr_error_correct: "M",
  qr_border: 0, // quiet-zone modules
  qr_height_fraction: 0.5,

  // Layout tweaks (px at render DPI)
  header_gap: -12,
  number_gap: 56,
  footer_gap: 10,
  blurb_gap: 12,
  footer_padding: 0,
  inner_pad: 16,

  // QR-only layout
  show_caption: true,
};

const MAX_LABELS = 500;
const MAX_PREVIEWS = 60;

const FONTS = [
  { family: "RobotoMono-SemiBold", file: "fonts/RobotoMono-SemiBold.ttf" },
  { family: "AgencyFB-Bold", file: "fonts/AGENCYB.TTF" },
];

// ================================================================
// Render helpers (the `L` toolbox passed to layouts)
// ================================================================

const L = {
  plateSize(cfg) {
    return {
      w: Math.round((cfg.plate_width_mm / 25.4) * cfg.dpi),
      h: Math.round((cfg.plate_height_mm / 25.4) * cfg.dpi),
    };
  },

  font(cfg, size) {
    const px = cfg[`font_size_${size}`];
    return `${px}px "${cfg.font_family}"`;
  },

  measure(ctx, text, font) {
    ctx.font = font;
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent || 0;
    const desc = m.actualBoundingBoxDescent || 0;
    return { w: m.width, asc, desc, h: asc + desc };
  },

  drawTextTop(ctx, text, x, yTop, font) {
    ctx.font = font;
    ctx.fillStyle = "#000";
    ctx.textBaseline = "alphabetic";
    const asc = ctx.measureText(text).actualBoundingBoxAscent || 0;
    ctx.fillText(text, x, yTop + asc);
  },

  makeQR(cfg, text) {
    // qrcode-generator: typeNumber 0 = auto-fit
    const qr = qrcode(cfg.qr_version, cfg.qr_error_correct);
    qr.addData(text);
    qr.make();
    return { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
  },

  qrSizeFor(qr, targetPx, border) {
    const total = qr.count + 2 * border;
    const modulePx = Math.max(1, Math.floor(targetPx / total));
    return { modulePx, sizePx: modulePx * total };
  },

  drawQR(ctx, qr, x, y, modulePx, border) {
    const total = qr.count + 2 * border;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, total * modulePx, total * modulePx);
    ctx.fillStyle = "#000";
    for (let r = 0; r < qr.count; r++) {
      for (let c = 0; c < qr.count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            x + (c + border) * modulePx,
            y + (r + border) * modulePx,
            modulePx,
            modulePx
          );
        }
      }
    }
  },
};

// ================================================================
// Label rendering
// ================================================================

function labelItems(cfg) {
  const items = [];
  const start = Math.trunc(cfg.number_start);
  const end = Math.trunc(cfg.number_end);
  for (let i = start; i <= end && items.length < MAX_LABELS; i++) {
    const numText =
      cfg.number_pad > 0
        ? String(i).padStart(cfg.number_pad, "0")
        : String(i);
    const prefixLower = cfg.label_prefix.toLowerCase();
    items.push({
      number: i,
      numText,
      prefix: cfg.label_prefix,
      name: `${prefixLower}${numText}`,
      url: cfg.url_template
        .replaceAll("{prefix}", prefixLower)
        .replaceAll("{i}", numText),
    });
  }
  return items;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Render one label to a full-resolution canvas. */
function renderLabel(cfg, item) {
  const layout = LAYOUTS[cfg.layout];
  const { w, h } = L.plateSize(cfg);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const radiusPx = (cfg.corner_radius_mm / 25.4) * cfg.dpi;
  ctx.save();
  roundedRectPath(ctx, 0, 0, w, h, radiusPx);
  ctx.clip();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  layout.render(ctx, cfg, item, L);
  ctx.restore();

  return canvas;
}

// ================================================================
// Form binding
// ================================================================

const form = document.getElementById("controls");

function fieldEl(key) {
  return form.querySelector(`[name="${key}"]`);
}

function readConfig() {
  const cfg = {};
  for (const key of Object.keys(DEFAULTS)) {
    const el = fieldEl(key);
    if (!el) {
      cfg[key] = DEFAULTS[key];
      continue;
    }
    const def = DEFAULTS[key];
    if (typeof def === "boolean") {
      cfg[key] = el.checked;
    } else if (typeof def === "number") {
      const v = parseFloat(el.value);
      cfg[key] = Number.isFinite(v) ? v : def;
    } else if (Array.isArray(def)) {
      cfg[key] = el.value.split("\n").map((s) => s.trimEnd());
    } else {
      cfg[key] = el.value;
    }
  }
  return cfg;
}

function writeConfig(cfg) {
  for (const key of Object.keys(DEFAULTS)) {
    const el = fieldEl(key);
    if (!el) continue;
    const val = cfg[key] ?? DEFAULTS[key];
    if (typeof DEFAULTS[key] === "boolean") el.checked = !!val;
    else if (Array.isArray(DEFAULTS[key])) el.value = val.join("\n");
    else el.value = val;
  }
}

function applyLayoutVisibility(cfg) {
  const uses = new Set(LAYOUTS[cfg.layout].uses);
  form.querySelectorAll("[data-key]").forEach((row) => {
    row.hidden = !uses.has(row.dataset.key);
  });
  document.getElementById("layout-description").textContent =
    LAYOUTS[cfg.layout].description;
}

// ================================================================
// Share links + persistence
// ================================================================

function configToHash(cfg) {
  const diff = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (JSON.stringify(cfg[key]) !== JSON.stringify(DEFAULTS[key])) {
      diff[key] = cfg[key];
    }
  }
  if (Object.keys(diff).length === 0) return "";
  return btoa(unescape(encodeURIComponent(JSON.stringify(diff))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function configFromHash(hash) {
  if (!hash) return null;
  try {
    const b64 = hash.replaceAll("-", "+").replaceAll("_", "/");
    const diff = JSON.parse(decodeURIComponent(escape(atob(b64))));
    const cfg = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (key in diff) cfg[key] = diff[key];
    }
    return cfg;
  } catch {
    return null;
  }
}

function loadInitialConfig() {
  const fromUrl = configFromHash(location.hash.slice(1));
  if (fromUrl) return fromUrl;
  try {
    const saved = JSON.parse(localStorage.getItem("label-config"));
    if (saved && typeof saved === "object") {
      const cfg = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS)) {
        if (key in saved) cfg[key] = saved[key];
      }
      return cfg;
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULTS };
}

// ================================================================
// Preview + status
// ================================================================

const previewGrid = document.getElementById("preview-grid");
const statusLine = document.getElementById("status-line");
const errorBox = document.getElementById("error-box");

let renderTimer = null;

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreviews, 150);
}

async function renderPreviews() {
  const cfg = readConfig();
  applyLayoutVisibility(cfg);
  localStorage.setItem("label-config", JSON.stringify(cfg));

  errorBox.hidden = true;
  previewGrid.replaceChildren();

  const items = labelItems(cfg);
  const { w, h } = L.plateSize(cfg);
  const widthIn = cfg.plate_width_mm / 25.4;
  const heightIn = cfg.plate_height_mm / 25.4;

  if (items.length === 0) {
    statusLine.textContent = "No labels — check the number range.";
    return;
  }

  statusLine.textContent =
    `${items.length} label(s) · ${w}×${h} px · ` +
    `${cfg.plate_width_mm.toFixed(1)}×${cfg.plate_height_mm.toFixed(1)} mm ` +
    `(${widthIn.toFixed(2)}×${heightIn.toFixed(2)} in) @ ${cfg.dpi} DPI`;

  try {
    await Promise.all(
      FONTS.map((f) => document.fonts.load(`16px "${f.family}"`))
    );

    const shown = items.slice(0, MAX_PREVIEWS);
    for (const item of shown) {
      const canvas = renderLabel(cfg, item);
      const card = document.createElement("figure");
      card.className = "preview-card";
      card.title = `${item.url}\nClick to download PNG`;
      canvas.addEventListener("click", () => downloadOnePng(cfg, item));
      const caption = document.createElement("figcaption");
      caption.textContent = item.name;
      card.append(canvas, caption);
      previewGrid.append(card);
    }
    if (items.length > shown.length) {
      const more = document.createElement("p");
      more.className = "muted";
      more.textContent =
        `Previewing first ${shown.length} of ${items.length} labels ` +
        `(all are included in downloads).`;
      previewGrid.append(more);
    }
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  errorBox.hidden = false;
  let msg = String(err && err.message ? err.message : err);
  if (/overflow/i.test(msg)) {
    msg +=
      " — the URL doesn't fit in the selected QR version. " +
      "Set QR version to 0 (auto) or pick a higher version.";
  }
  errorBox.textContent = msg;
  statusLine.textContent = "Render failed.";
}

// ================================================================
// Downloads
// ================================================================

function canvasPngBytes(canvas, dpi) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("PNG encode failed"));
      resolve(pngWithDpi(await blob.arrayBuffer(), dpi));
    }, "image/png");
  });
}

async function downloadOnePng(cfg, item) {
  try {
    const bytes = await canvasPngBytes(renderLabel(cfg, item), cfg.dpi);
    downloadBlob(new Blob([bytes], { type: "image/png" }), `${item.name}.png`);
  } catch (err) {
    showError(err);
  }
}

function batchName(cfg, ext) {
  const p = cfg.label_prefix.toLowerCase().replace(/[^a-z0-9_-]+/g, "");
  return `${p}${cfg.number_start}-${cfg.number_end}-labels.${ext}`;
}

async function downloadZip() {
  const cfg = readConfig();
  try {
    const entries = [];
    for (const item of labelItems(cfg)) {
      const bytes = await canvasPngBytes(renderLabel(cfg, item), cfg.dpi);
      entries.push({ name: `${item.name}.png`, data: bytes });
    }
    downloadBlob(zipStore(entries), batchName(cfg, "zip"));
  } catch (err) {
    showError(err);
  }
}

async function downloadPdf() {
  const cfg = readConfig();
  try {
    const canvases = labelItems(cfg).map((item) => renderLabel(cfg, item));
    downloadBlob(await buildPdf(canvases, cfg.dpi), batchName(cfg, "pdf"));
  } catch (err) {
    showError(err);
  }
}

async function copyShareLink() {
  const cfg = readConfig();
  const url =
    location.origin + location.pathname + "#" + configToHash(cfg);
  history.replaceState(null, "", url);
  await navigator.clipboard.writeText(url);
  const btn = document.getElementById("btn-share");
  const old = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = old), 1500);
}

// ================================================================
// Init
// ================================================================

function init() {
  // Register fonts for canvas use
  for (const f of FONTS) {
    const face = new FontFace(f.family, `url(${f.file})`);
    face.load().then((loaded) => document.fonts.add(loaded));
  }

  // Layout picker options
  const layoutSel = fieldEl("layout");
  for (const [key, layout] of Object.entries(LAYOUTS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = layout.name;
    layoutSel.append(opt);
  }

  // Font picker options
  const fontSel = fieldEl("font_family");
  for (const f of FONTS) {
    const opt = document.createElement("option");
    opt.value = f.family;
    opt.textContent = f.family;
    fontSel.append(opt);
  }

  writeConfig(loadInitialConfig());
  form.addEventListener("input", scheduleRender);

  document.getElementById("btn-zip").addEventListener("click", downloadZip);
  document.getElementById("btn-pdf").addEventListener("click", downloadPdf);
  document.getElementById("btn-share").addEventListener("click", copyShareLink);
  document.getElementById("btn-reset").addEventListener("click", () => {
    writeConfig({ ...DEFAULTS });
    history.replaceState(null, "", location.pathname);
    scheduleRender();
  });

  renderPreviews();
}

init();
