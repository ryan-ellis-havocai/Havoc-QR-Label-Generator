"""Core label-rendering logic shared by the CLI (generate_labels.py) and
the web GUI (server.py).

All dimensions/config live in a plain dict so the web API can accept it as
JSON. See DEFAULTS for the full set of keys.
"""

import io
import os
import zipfile

import qrcode
from PIL import Image, ImageDraw, ImageFont

# String names accepted from JSON for QR error-correction level
ERROR_CORRECT_LEVELS = {
    "L": qrcode.constants.ERROR_CORRECT_L,
    "M": qrcode.constants.ERROR_CORRECT_M,
    "Q": qrcode.constants.ERROR_CORRECT_Q,
    "H": qrcode.constants.ERROR_CORRECT_H,
}

DEFAULTS = {
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
    "header_gap": -12,     # added after header before number
    "number_gap": 56,      # added after number before QR
    "footer_gap": 10,      # added after QR before footer blurbs
    "blurb_gap": 12,       # added between footer blurbs
    "footer_padding": 0,   # footer blurb offset from the QR's left edge (px)
}


def merged_config(overrides=None):
    """DEFAULTS merged with overrides; unknown keys are ignored."""
    cfg = dict(DEFAULTS)
    for key, value in (overrides or {}).items():
        if key in cfg:
            cfg[key] = value
    return cfg


def plate_size_px(cfg):
    w = int((cfg["plate_width_mm"] / 25.4) * cfg["dpi"])
    h = int((cfg["plate_height_mm"] / 25.4) * cfg["dpi"])
    return w, h


def label_url(cfg, i):
    return cfg["url_template"].format(prefix=cfg["label_prefix"].lower(), i=i)


def label_name(cfg, i):
    return f"{cfg['label_prefix'].lower()}{i}"


def _text_size(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=0)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def render_plate(cfg, i):
    """Render a single label plate. Returns an RGB or RGBA PIL Image
    (RGBA when corners are rounded — outside the radius is transparent)."""
    plate_w_px, plate_h_px = plate_size_px(cfg)

    font_small = ImageFont.truetype(cfg["font_path"], int(cfg["font_size_small"]))
    font_large = ImageFont.truetype(cfg["font_path"], int(cfg["font_size_large"]))
    font_tiny = ImageFont.truetype(cfg["font_path"], int(cfg["font_size_tiny"]))

    url = label_url(cfg, i)

    # --- QR CODE (no anti-aliasing) ---
    qr = qrcode.QRCode(
        version=int(cfg["qr_version"]) or None,   # 0 -> auto
        error_correction=ERROR_CORRECT_LEVELS[cfg["qr_error_correct"]],
        box_size=int(cfg["qr_box_size"]),
        border=int(cfg["qr_border"]),
    )
    qr.add_data(url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    qr_target_height = int(plate_h_px * cfg["qr_height_fraction"])
    qr_img = qr_img.resize((qr_target_height, qr_target_height), Image.NEAREST)

    # --- PLATE CANVAS ---
    plate = Image.new("RGB", (plate_w_px, plate_h_px), "white")
    draw = ImageDraw.Draw(plate)

    header_text = cfg["label_prefix"]
    number_text = str(i)

    h_w, h_h = _text_size(draw, header_text, font_small)
    n_w, n_h = _text_size(draw, number_text, font_large)

    y = 0

    # Header
    draw.text(
        ((plate_w_px - h_w) // 2, y),
        header_text,
        fill="black",
        font=font_small,
    )
    y += h_h + int(cfg["header_gap"])

    # Large number
    draw.text(
        ((plate_w_px - n_w) // 2, y),
        number_text,
        fill="black",
        font=font_large,
    )
    y += n_h + int(cfg["number_gap"])

    # QR centered
    qr_x = (plate_w_px - qr_img.width) // 2
    plate.paste(qr_img, (qr_x, y))
    y += qr_img.height + int(cfg["footer_gap"])

    # Footer blurbs, left-aligned to the QR's left edge
    for blurb in cfg["footer_lines"]:
        _, b_h = _text_size(draw, blurb, font_tiny)
        draw.text(
            (qr_x + int(cfg["footer_padding"]), y),
            blurb,
            fill="black",
            font=font_tiny,
        )
        y += b_h + int(cfg["blurb_gap"])

    # Round the corners (transparent outside the rounded rectangle)
    corner_radius_px = int((cfg["corner_radius_mm"] / 25.4) * cfg["dpi"])
    if corner_radius_px > 0:
        mask = Image.new("L", (plate_w_px, plate_h_px), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, plate_w_px - 1, plate_h_px - 1),
            radius=corner_radius_px,
            fill=255,
        )
        plate = plate.convert("RGBA")
        plate.putalpha(mask)

    return plate


def label_numbers(cfg):
    return range(int(cfg["number_start"]), int(cfg["number_end"]) + 1)


def flatten_for_pdf(plate):
    """Flatten transparency onto white and convert to palette mode so
    Pillow's PDF encoder stores it losslessly (ASCIIHexDecode) instead of
    needing the JPEG encoder."""
    if plate.mode == "RGBA":
        page = Image.new("RGB", plate.size, "white")
        page.paste(plate, mask=plate.split()[3])
    else:
        page = plate.convert("RGB")
    return page.convert("P", palette=Image.ADAPTIVE, colors=256)


def png_bytes(plate, dpi):
    buf = io.BytesIO()
    plate.save(buf, format="PNG", dpi=(dpi, dpi))
    return buf.getvalue()


def pdf_bytes(cfg):
    """Multi-page PDF, one label per page, pages sized to the physical
    plate dimensions via DPI resolution metadata."""
    pages = [flatten_for_pdf(render_plate(cfg, i)) for i in label_numbers(cfg)]
    buf = io.BytesIO()
    pages[0].save(
        buf,
        format="PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=cfg["dpi"],
    )
    return buf.getvalue()


def zip_bytes(cfg):
    """ZIP archive of one PNG per label."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i in label_numbers(cfg):
            plate = render_plate(cfg, i)
            zf.writestr(f"{label_name(cfg, i)}.png", png_bytes(plate, cfg["dpi"]))
    return buf.getvalue()


def list_fonts(directory="."):
    """Available .ttf/.otf files in the project directory."""
    return sorted(
        f for f in os.listdir(directory)
        if f.lower().endswith((".ttf", ".otf"))
    )
