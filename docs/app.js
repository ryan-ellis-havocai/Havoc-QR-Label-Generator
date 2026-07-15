/* Drone label generator — app wiring.
 *
 * Spacing model: everything that affects appearance is a PROPORTION of
 * the plate, never raw pixels — so a label looks identical at any DPI or
 * physical size. Font sizes and vertical gaps are a percent of plate
 * height; horizontal offsets are a percent of plate width. DPI only sets
 * the output resolution; plate size and corner radius are physical
 * (inches, to match label-stock conventions).
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
  plate_width_in: 1.5,
  plate_height_in: 2,
  dpi: 240,
  corner_radius_in: 0.06,

  // Typography — font sizes as a percent of plate HEIGHT
  font_family: "RobotoMono-SemiBold",
  font_small_pct: 10,
  font_large_pct: 28.33,
  font_tiny_pct: 5.42,

  // Footer blurbs (one per line)
  footer_lines: ["HW: Gen2-VERT-A"],

  // QR code
  qr_version: 2, // 0 = auto
  qr_error_correct: "M",
  qr_border: 0, // quiet-zone modules
  qr_height_fraction: 0.5,

  // Layout spacing as proportions of the plate. Vertical gaps are a
  // percent of plate HEIGHT; horizontal offsets are a percent of WIDTH.
  top_pad_pct: 4,         // % H, margin above the header (top of plate)
  header_gap_pct: -2.5,   // % H, after header, before number (may be negative)
  number_gap_pct: 11.67,  // % H, after number, before QR
  footer_gap_pct: 2.08,   // % H, after QR, before footer lines
  blurb_gap_pct: 2.5,     // % H, between footer lines
  footer_pad_pct: 0,      // % W, footer offset from the QR's left edge
  inner_pad_pct: 4.44,    // % W, padding for the horizontal-tag layout

  // QR-only layout
  show_caption: true,
};

const MAX_LABELS = 500;
const MAX_PREVIEWS = 60;

const FONTS = [
  { family: "RobotoMono-SemiBold", file: "fonts/RobotoMono-SemiBold.ttf", label: "Roboto Mono SemiBold (mono)" },
  { family: "JetBrainsMono-Bold", file: "fonts/JetBrainsMono-Bold.woff2", label: "JetBrains Mono Bold (mono)" },
  { family: "AgencyFB-Bold", file: "fonts/AGENCYB.TTF", label: "Agency FB Bold (condensed)" },
  { family: "Oswald-Bold", file: "fonts/Oswald-Bold.woff2", label: "Oswald Bold (condensed)" },
  { family: "BarlowCondensed-Bold", file: "fonts/BarlowCondensed-Bold.woff2", label: "Barlow Condensed Bold" },
  { family: "ArchivoBlack", file: "fonts/ArchivoBlack.woff2", label: "Archivo Black (heavy)" },
  { family: "Inter-Bold", file: "fonts/Inter-Bold.woff2", label: "Inter Bold (sans)" },
];

/* Presets: one-click bundles of dimensions, layout, and tuned spacing for
 * common thermal-label stock. Applying a preset = DEFAULTS + overrides;
 * everything stays editable afterwards. */
const PRESETS = {
  "badge-1p5x2": {
    label: '1.5 × 2 in — Vertical badge (portrait)',
    overrides: {}, // the app defaults ARE this preset
  },
  "shipping-6x4": {
    label: '6 × 4 in — Shipping label (landscape)',
    overrides: {
      layout: "horizontal-tag",
      plate_width_in: 6, plate_height_in: 4, corner_radius_in: 0.1,
      qr_height_fraction: 0.62,
      font_small_pct: 9, font_large_pct: 26, font_tiny_pct: 6,
      header_gap_pct: 1, blurb_gap_pct: 2.5, inner_pad_pct: 4,
    },
  },
  "tag-2p25x1p25": {
    label: '2.25 × 1.25 in — Thermal tag (landscape)',
    overrides: {
      layout: "horizontal-tag",
      plate_width_in: 2.25, plate_height_in: 1.25, corner_radius_in: 0.06,
      qr_height_fraction: 0.78,
      font_small_pct: 11, font_large_pct: 30, font_tiny_pct: 8,
      header_gap_pct: 1, blurb_gap_pct: 2, inner_pad_pct: 3,
    },
  },
  "tag-2x1": {
    label: '2 × 1 in — Small asset tag (landscape)',
    overrides: {
      layout: "horizontal-tag",
      plate_width_in: 2, plate_height_in: 1, corner_radius_in: 0.05,
      qr_height_fraction: 0.8,
      font_small_pct: 12, font_large_pct: 32, font_tiny_pct: 9,
      header_gap_pct: 1, blurb_gap_pct: 2, inner_pad_pct: 3,
    },
  },
  "badge-3x2": {
    label: '3 × 2 in — Vertical badge (large)',
    overrides: {
      layout: "vertical-badge",
      plate_width_in: 3, plate_height_in: 2, corner_radius_in: 0.08,
      qr_height_fraction: 0.45,
      font_small_pct: 9, font_large_pct: 24, font_tiny_pct: 5.5,
      top_pad_pct: 3, header_gap_pct: -1, number_gap_pct: 4,
      footer_gap_pct: 2, blurb_gap_pct: 2,
    },
  },
  "qr-1x1": {
    label: '1 × 1 in — QR sticker',
    overrides: {
      layout: "qr-only",
      plate_width_in: 1, plate_height_in: 1, corner_radius_in: 0.05,
      qr_height_fraction: 0.72,
      font_tiny_pct: 7, footer_gap_pct: 2.5,
      show_caption: true,
    },
  },
};

// ================================================================
// Render helpers (the `L` toolbox passed to layouts)
// ================================================================

const L = {
  plateSize(cfg) {
    return {
      w: Math.round(cfg.plate_width_in * cfg.dpi),
      h: Math.round(cfg.plate_height_in * cfg.dpi),
    };
  },

  // Convert a percent of plate height / width into pixels.
  pctH(cfg, pct) {
    return (pct / 100) * this.plateSize(cfg).h;
  },

  pctW(cfg, pct) {
    return (pct / 100) * this.plateSize(cfg).w;
  },

  font(cfg, size) {
    const px = this.pctH(cfg, cfg[`font_${size}_pct`]);
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

  const radiusPx = cfg.corner_radius_in * cfg.dpi;
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
  const widthMm = cfg.plate_width_in * 25.4;
  const heightMm = cfg.plate_height_in * 25.4;

  if (items.length === 0) {
    statusLine.textContent = "No labels — check the number range.";
    return;
  }

  statusLine.textContent =
    `${items.length} label(s) · ${w}×${h} px · ` +
    `${cfg.plate_width_in.toFixed(2)}×${cfg.plate_height_in.toFixed(2)} in ` +
    `(${widthMm.toFixed(1)}×${heightMm.toFixed(1)} mm) @ ${cfg.dpi} DPI`;

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

  // Preset picker options
  const presetSel = document.getElementById("preset");
  for (const [key, preset] of Object.entries(PRESETS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = preset.label;
    presetSel.append(opt);
  }
  presetSel.addEventListener("change", () => {
    if (!presetSel.value) return;
    writeConfig({ ...DEFAULTS, ...PRESETS[presetSel.value].overrides });
    scheduleRender();
  });
  // Any manual edit means the form no longer reflects the preset verbatim
  form.addEventListener("input", (e) => {
    if (e.target !== presetSel) presetSel.value = "";
  });

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
    opt.textContent = f.label;
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
