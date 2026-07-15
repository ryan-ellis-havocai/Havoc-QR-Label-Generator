/* Label layout registry.
 *
 * Each layout is an entry in LAYOUTS:
 *   name        — shown in the layout picker
 *   description — one-line hint shown under the picker
 *   uses        — config keys this layout reads; the form hides the rest
 *   render(ctx, cfg, item, L) — draw the label onto a canvas 2d context.
 *
 * The canvas is already sized to the full plate (cfg-derived pixels),
 * clipped to the rounded rectangle, and filled white. Layouts only draw
 * content.
 *
 * `item` describes the label being drawn:
 *   { number, numText, name, url, prefix }
 *
 * `L` is a helper toolbox (see render helpers in app.js):
 *   L.font(cfg, 'small'|'large'|'tiny')  -> canvas font string
 *   L.measure(ctx, text, font)          -> {w, asc, desc, h}
 *   L.drawTextTop(ctx, text, x, yTop, font)  (x = left edge, yTop = top edge)
 *   L.makeQR(cfg, text)                 -> {count, isDark(r,c)}
 *   L.qrSizeFor(qr, targetPx, border)   -> {modulePx, sizePx}
 *   L.drawQR(ctx, qr, x, y, modulePx, border)
 *   L.plateSize(cfg)                    -> {w, h}
 *
 * To add a new layout: add an entry here, list the config keys it uses,
 * and implement render(). No other file needs to change.
 */

"use strict";

const SHARED_KEYS = [
  "label_prefix", "number_start", "number_end", "number_pad", "url_template",
  "plate_width_mm", "plate_height_mm", "dpi", "corner_radius_mm",
  "font_family",
  "qr_version", "qr_error_correct", "qr_border", "qr_height_fraction",
];

const LAYOUTS = {

  // ------------------------------------------------------------------
  // Classic vertical badge — direct port of generate_labels.py:
  // header / big number / QR / footer lines.
  // ------------------------------------------------------------------
  "vertical-badge": {
    name: "Vertical badge",
    description: "Header, big number, QR code, footer lines (classic plate).",
    uses: [
      ...SHARED_KEYS,
      "font_size_small", "font_size_large", "font_size_tiny",
      "footer_lines",
      "header_gap", "number_gap", "footer_gap", "blurb_gap", "footer_padding",
    ],
    render(ctx, cfg, item, L) {
      const { w: plateW, h: plateH } = L.plateSize(cfg);
      const fSmall = L.font(cfg, "small");
      const fLarge = L.font(cfg, "large");
      const fTiny = L.font(cfg, "tiny");

      let y = 0;

      // Header (prefix, rendered as-is)
      const hm = L.measure(ctx, item.prefix, fSmall);
      L.drawTextTop(ctx, item.prefix, (plateW - hm.w) / 2, y, fSmall);
      y += hm.h + cfg.header_gap;

      // Large number
      const nm = L.measure(ctx, item.numText, fLarge);
      L.drawTextTop(ctx, item.numText, (plateW - nm.w) / 2, y, fLarge);
      y += nm.h + cfg.number_gap;

      // QR centered
      const qr = L.makeQR(cfg, item.url);
      const target = Math.round(plateH * cfg.qr_height_fraction);
      const { modulePx, sizePx } = L.qrSizeFor(qr, target, cfg.qr_border);
      const qrX = Math.round((plateW - sizePx) / 2);
      L.drawQR(ctx, qr, qrX, y, modulePx, cfg.qr_border);
      y += sizePx + cfg.footer_gap;

      // Footer blurbs, left-aligned to the QR's left edge
      for (const blurb of cfg.footer_lines) {
        const bm = L.measure(ctx, blurb, fTiny);
        L.drawTextTop(ctx, blurb, qrX + cfg.footer_padding, y, fTiny);
        y += bm.h + cfg.blurb_gap;
      }
    },
  },

  // ------------------------------------------------------------------
  // Horizontal tag — QR on the left, text stacked on the right.
  // Suited to wide, short labels (e.g. asset tags on arms/rails).
  // ------------------------------------------------------------------
  "horizontal-tag": {
    name: "Horizontal tag",
    description: "QR on the left, prefix + number + footer stacked on the right.",
    uses: [
      ...SHARED_KEYS,
      "font_size_small", "font_size_large", "font_size_tiny",
      "footer_lines",
      "header_gap", "blurb_gap", "inner_pad",
    ],
    render(ctx, cfg, item, L) {
      const { w: plateW, h: plateH } = L.plateSize(cfg);
      const pad = cfg.inner_pad;
      const fSmall = L.font(cfg, "small");
      const fLarge = L.font(cfg, "large");
      const fTiny = L.font(cfg, "tiny");

      // QR fills a fraction of the plate height, vertically centered at left
      const qr = L.makeQR(cfg, item.url);
      const target = Math.round(plateH * cfg.qr_height_fraction);
      const { modulePx, sizePx } = L.qrSizeFor(qr, target, cfg.qr_border);
      const qrY = Math.round((plateH - sizePx) / 2);
      L.drawQR(ctx, qr, pad, qrY, modulePx, cfg.qr_border);

      // Text block: prefix / number / footer lines, vertically centered
      const textX = pad + sizePx + pad;
      const hm = L.measure(ctx, item.prefix, fSmall);
      const nm = L.measure(ctx, item.numText, fLarge);
      const footer = cfg.footer_lines.filter((s) => s.length > 0);
      const footerMs = footer.map((s) => L.measure(ctx, s, fTiny));

      let blockH = hm.h + cfg.header_gap + nm.h;
      for (const m of footerMs) blockH += cfg.blurb_gap + m.h;

      let y = Math.round((plateH - blockH) / 2);
      L.drawTextTop(ctx, item.prefix, textX, y, fSmall);
      y += hm.h + cfg.header_gap;
      L.drawTextTop(ctx, item.numText, textX, y, fLarge);
      y += nm.h;
      footer.forEach((line, k) => {
        y += cfg.blurb_gap;
        L.drawTextTop(ctx, line, textX, y, fTiny);
        y += footerMs[k].h;
      });
    },
  },

  // ------------------------------------------------------------------
  // QR only — just the code, with an optional tiny caption underneath.
  // For minimal stickers where the asset ID lives elsewhere.
  // ------------------------------------------------------------------
  "qr-only": {
    name: "QR only",
    description: "Just the QR code, with an optional tiny ID caption below.",
    uses: [
      ...SHARED_KEYS,
      "font_size_tiny", "show_caption", "footer_gap",
    ],
    render(ctx, cfg, item, L) {
      const { w: plateW, h: plateH } = L.plateSize(cfg);
      const fTiny = L.font(cfg, "tiny");

      const qr = L.makeQR(cfg, item.url);
      const target = Math.round(plateH * cfg.qr_height_fraction);
      const { modulePx, sizePx } = L.qrSizeFor(qr, target, cfg.qr_border);

      const caption = cfg.show_caption ? item.name : "";
      const cm = caption ? L.measure(ctx, caption, fTiny) : { w: 0, h: 0 };
      const gap = caption ? cfg.footer_gap : 0;

      const blockH = sizePx + gap + cm.h;
      const qrX = Math.round((plateW - sizePx) / 2);
      let y = Math.round((plateH - blockH) / 2);

      L.drawQR(ctx, qr, qrX, y, modulePx, cfg.qr_border);
      if (caption) {
        y += sizePx + gap;
        L.drawTextTop(ctx, caption, (plateW - cm.w) / 2, y, fTiny);
      }
    },
  },
};
