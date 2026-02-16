from __future__ import annotations
import argparse
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

def load_img(p: Path) -> Image.Image:
    img = Image.open(p).convert("RGB")
    return img

def add_title(img: Image.Image, title: str) -> Image.Image:
    # simple header bar
    w, h = img.size
    bar_h = 40
    out = Image.new("RGB", (w, h + bar_h), (18, 18, 18))
    out.paste(img, (0, bar_h))
    draw = ImageDraw.Draw(out)
    draw.text((12, 10), title, fill=(240, 240, 240))
    return out

def grid_2x2(imgs, outpath: Path, title: str):
    # Standardize sizes
    imgs = [ImageOps.contain(im, (900, 700)) for im in imgs]

    # Make all same size by padding
    max_w = max(i.size[0] for i in imgs)
    max_h = max(i.size[1] for i in imgs)
    padded = []
    for im in imgs:
        canvas = Image.new("RGB", (max_w, max_h), (255, 255, 255))
        x = (max_w - im.size[0]) // 2
        y = (max_h - im.size[1]) // 2
        canvas.paste(im, (x, y))
        padded.append(canvas)

    # 2x2 layout
    out = Image.new("RGB", (max_w * 2, max_h * 2), (255, 255, 255))
    out.paste(padded[0], (0, 0))
    out.paste(padded[1], (max_w, 0))
    out.paste(padded[2], (0, max_h))
    out.paste(padded[3], (max_w, max_h))

    out = add_title(out, title)
    out.save(outpath, quality=95)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--figdir", default="data/processed/figures")
    args = ap.parse_args()

    base = Path(args.figdir)
    month_dirs = sorted([p for p in base.glob("month_*") if p.is_dir()])

    if not month_dirs:
        raise FileNotFoundError(f"No month_* folders found under {base}")

    for md in month_dirs:
        month = md.name.replace("month_", "")
        # required images (from visualize_month.py)
        actual = md / "actual_next_month.png"
        pred = md / "pred_ridge.png"
        err = md / "abs_error_ridge.png"
        overlap = md / "hotspot_overlap_ridge.png"

        missing = [str(p.name) for p in [actual, pred, err, overlap] if not p.exists()]
        if missing:
            print(f"[SKIP] {month} missing: {missing}")
            continue

        imgs = [load_img(actual), load_img(pred), load_img(err), load_img(overlap)]
        outpath = base / f"panel_{month}.png"
        grid_2x2(imgs, outpath, f"Visual Evaluation Panel — {month} (Ridge vs Actual)")
        print("[OK] Saved:", outpath)

if __name__ == "__main__":
    main()
