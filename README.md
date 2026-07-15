# Havoc-QR-Label-Generator

A browser-based tool for generating printable QR identification plates for
drone assets. Each plate encodes the drone's local network address as a QR
code, so ground crew can pull up its web interface instantly with a phone
camera — no app required.

**Live app:** https://ryan-ellis-havocai.github.io/Havoc-QR-Label-Generator/

Everything runs client-side — QR encoding, label rendering, and PNG/ZIP/PDF
export all happen in the browser. Nothing is uploaded anywhere.

---

## What a plate encodes

A label is built from a fleet **prefix** and an asset **number** (e.g.
`locust-` + `602`). The QR code encodes a URL from a template — by default
`http://{prefix}{i}:8000/`, which resolves to `http://locust-602:8000/`. A
phone scan takes ground crew straight to that drone's onboard dashboard over
the local network.

---

## Features

- **Live preview** of every label in the batch — click any preview to download
  that single PNG.
- **Presets** for common thermal-label stock (1.5×2 in badge, 6×4 in shipping,
  2×1 in asset tag, 1×1 in QR sticker, …) — one click sets the size, layout,
  and tuned spacing; everything stays editable afterwards.
- **Multiple layouts:** *Vertical badge* (header / big number / QR / footer),
  *Horizontal tag* (QR left, text right), and *QR only*.
- **Seven bundled fonts** — mono, condensed, and heavy-display options suited
  to label printing.
- **Proportional design:** all spacing and font sizes are percentages of the
  plate, so a layout looks identical at any DPI or physical size. DPI only sets
  output resolution; plate size and corner radius are physical (inches).
- **Download PDF** — one label per page, each page sized to the exact physical
  dimensions for true-scale printing.
- **Download PNGs (ZIP)** — one PNG per label, with embedded DPI metadata so
  they print at physical size.
- **Copy share link** — encodes the current settings into the URL so a teammate
  opens the exact same configuration.

---

## Adding a new label layout

Layouts are self-contained entries in [`docs/layouts.js`](docs/layouts.js).
Add one object to the `LAYOUTS` registry with:

- `name` / `description` — shown in the layout picker,
- `uses` — the config keys the layout reads (the form hides the rest),
- `render(ctx, cfg, item, L)` — draws the label onto a canvas 2D context.

The canvas is pre-sized, clipped to the rounded rectangle, and filled white;
the layout only draws content. Use the `L` helper toolbox (`L.pctH` / `L.pctW`
for proportional spacing, `L.font`, `L.makeQR`, `L.drawQR`, etc.). No other
file needs to change.

---

## Running locally

Any static file server works — for example:

```bash
python -m http.server 8000 --directory docs
```

Then open http://localhost:8000/.

---

## Deployment (GitHub Pages)

The site is served from the [`docs/`](docs/) folder on the `main` branch
(*Settings → Pages → Deploy from a branch → `main` / `/docs`*). Any push to
`main` rebuilds and redeploys automatically within about a minute.

---

## Project structure

```
docs/
  index.html      # page + controls
  style.css       # styling
  app.js          # config model, canvas rendering, form/preview wiring
  layouts.js      # pluggable label-layout registry
  exporters.js    # PNG (with DPI), ZIP, and multi-page PDF writers
  vendor/         # qrcode-generator (vendored, MIT)
  fonts/          # bundled label fonts
```
