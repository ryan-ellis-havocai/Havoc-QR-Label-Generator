import os

import label_core

# ============================================================
# CONFIG — edit these values (see label_core.DEFAULTS for docs)
# ============================================================

CONFIG = {
    # Label prefix and number range (inclusive)
    "label_prefix": "locust-",   # single source of truth for header + hostname
    "number_start": 601,
    "number_end": 612,

    # URL template — {prefix} is lowercased, {i} is the current number
    "url_template": "http://{prefix}{i}:8000/",

    # Plate (physical label) dimensions
    "plate_width_mm": 1.5 * 25.4,
    "plate_height_mm": 2 * 25.4,
    "dpi": 240,
    "corner_radius_mm": 1.5,   # 0 = square corners

    # Font file + sizes
    "font_path": "RobotoMono-SemiBold.ttf",
    "font_size_small": 48,    # header text
    "font_size_large": 136,   # big number
    "font_size_tiny": 26,     # footer blurbs

    # Footer blurbs (rendered below the QR code, one per line)
    "footer_lines": ["HW: Gen2-VERT-A", ""],

    # QR code settings
    "qr_version": 2,           # 0 = auto
    "qr_error_correct": "M",   # L / M / Q / H
    "qr_box_size": 12,
    "qr_border": 0,
    "qr_height_fraction": 0.5,   # QR height as a fraction of plate height

    # Layout tweaks (vertical spacing, in px)
    "header_gap": -12,
    "number_gap": 56,
    "footer_gap": 10,
    "blurb_gap": 12,
    "footer_padding": 0,
}

# Output settings
OUTPUT_DIR = "output"
SAVE_PNG = False              # write one PNG per label
SAVE_PDF = True               # also write a multi-page PDF (one label per page)
PDF_PATH = "labels.pdf"       # PDF filename (inside OUTPUT_DIR)

# ============================================================
# SCRIPT
# ============================================================

if __name__ == "__main__":
    cfg = label_core.merged_config(CONFIG)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    plate_w_px, plate_h_px = label_core.plate_size_px(cfg)

    if SAVE_PNG:
        for i in label_core.label_numbers(cfg):
            plate = label_core.render_plate(cfg, i)
            filename = os.path.join(OUTPUT_DIR, f"{label_core.label_name(cfg, i)}.png")
            plate.save(filename, dpi=(cfg["dpi"], cfg["dpi"]))
            print(
                f"Created {filename} ({plate_w_px}x{plate_h_px}px) "
                f"-> {label_core.label_url(cfg, i)}"
            )

    if SAVE_PDF:
        pdf_path = os.path.join(OUTPUT_DIR, PDF_PATH)
        with open(pdf_path, "wb") as f:
            f.write(label_core.pdf_bytes(cfg))
        n_pages = len(label_core.label_numbers(cfg))
        page_in = (plate_w_px / cfg["dpi"], plate_h_px / cfg["dpi"])
        print(
            f"Created {pdf_path} ({n_pages} page(s), "
            f"{page_in[0]:.2f}x{page_in[1]:.2f} in each)"
        )
