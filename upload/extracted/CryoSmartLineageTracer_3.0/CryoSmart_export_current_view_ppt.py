# -*- coding: utf-8 -*-
"""
CryoSmart 仅导出 + PPT 替换（不改变视角）
前置条件：
  1. 已完成前两步（谱系解析 + 空间对齐），且当前 ChimeraX 会话中已打开所有对齐后的地图。
  2. 存在 chimerax_rendered_maps/rendered_map_manifest.json 文件。
  3. 您已经手动调整好 ChimeraX 中的视角，希望用这个视角截图。

功能：
  - 保持当前视角不变，依次显示每个地图并截图。
  - 自动裁剪白边并替换 PPT 中的图片。

运行：在 ChimeraX 中打开此脚本。
"""

import json
import os
import re
import sys
import zipfile
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:
    np = None
    Image = None

from chimerax.core.commands import run as cxrun


# ==================== 常量 ====================
SNAPSHOT_WIDTH = 1600
SNAPSHOT_HEIGHT = 1200
GROUP_TRIM_PADDING_FRACTION = 0.035
WHITE_TRIM_DELTA = 8
MIN_TRIM_PADDING_PX = 60
EXTRA_WHITE_MARGIN_FRACTION = 0.05


# ==================== 工具函数 ====================

def log(session, text):
    session.logger.info(str(text))

def warn(session, text):
    session.logger.warning(str(text))

def q(path):
    return '"' + str(path).replace('"', '\\"') + '"'

def safe_name(value):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "item")).strip("_") or "item"

def volume_models(session):
    return [m for m in session.models.list() if m.__class__.__name__ == "Volume"]

def find_volume_by_key(session, key, manifest):
    """根据 manifest 中的 key 查找当前会话中的 Volume 模型"""
    entry = manifest.get("models", {}).get(key)
    if not entry:
        return None
    wanted_id = str(entry.get("model_id") or "")
    wanted_name = str(entry.get("model_name") or "")
    wanted_path = str(entry.get("source_mrc") or "")
    for model in volume_models(session):
        if wanted_id and str(getattr(model, "id_string", "")) == wanted_id:
            return model
        if wanted_name and str(getattr(model, "name", "")) == wanted_name:
            return model
        if wanted_path:
            data_path = getattr(getattr(model, "data", None), "path", None)
            if data_path and str(Path(data_path).resolve()) == str(Path(wanted_path).resolve()):
                return model
    return None

def load_render_manifest(folder):
    manifest_path = folder / "chimerax_rendered_maps" / "rendered_map_manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError("No manifest found. Run step 1 & 2 first: " + str(manifest_path))
    return json.loads(manifest_path.read_text(encoding="utf-8"))

def write_render_manifest(folder, manifest):
    manifest_path = folder / "chimerax_rendered_maps" / "rendered_map_manifest.json"
    manifest_path.parent.mkdir(exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest_path


# ==================== 导出图像（使用当前视角） ====================

def export_images_with_current_view(session, folder, manifest):
    """使用当前摄像机视角，逐个显示地图并截图"""
    model_entries = manifest.get("models") or {}
    if not model_entries:
        raise RuntimeError("Manifest 中没有模型列表")

    output_dir = folder / "chimerax_rendered_maps"
    output_dir.mkdir(exist_ok=True)
    manifest.setdefault("images", {})
    manifest.setdefault("warnings", [])

    all_vols = volume_models(session)
    matched = {}

    for key, entry in model_entries.items():
        model = find_volume_by_key(session, key, manifest)
        if model is None:
            manifest["warnings"].append(f"找不到模型: {key}")
            continue
        matched[key] = model

    if not matched:
        raise RuntimeError("没有可用的 Volume 模型")

    # 用所有模型统一定一次画面范围，再逐张隐藏/显示导出，避免单张图各自缩放。
    for vol in all_vols:
        cxrun(session, f"show #{vol.id_string} models")
    #cxrun(session, "view orient")
    cxrun(session, "wait 1")

    log(session, f"开始导出 {len(matched)} 张图像，使用当前视角...")

    for key, model in matched.items():
        # 只显示当前模型，隐藏其他
        for vol in all_vols:
            if vol.id_string == model.id_string:
                cxrun(session, f"show #{vol.id_string} models")
            else:
                cxrun(session, f"hide #{vol.id_string} models")
        cxrun(session, "wait 1")

        png_name = safe_name(key.replace("/", "__")) + ".png"
        png_path = output_dir / png_name
        cxrun(session, f"save {q(png_path)} width {SNAPSHOT_WIDTH} height {SNAPSHOT_HEIGHT} supersample 3 transparentBackground false")

        entry = dict(model_entries.get(key) or {})
        manifest["images"][key] = {
            **entry,
            "png": str(png_path),
            "model_id_at_export": getattr(model, "id_string", None),
            "model_name_at_export": getattr(model, "name", None),
        }
        log(session, f"  已保存: {png_path.name}")

    # 恢复显示所有
    for vol in all_vols:
        cxrun(session, f"show #{vol.id_string} models")

    return manifest


# ==================== PPT 替换 ====================

def find_pptx(folder):
    candidates = [p for p in sorted(folder.glob("*picture_flow*.pptx")) if "_chimerax" not in p.stem]
    return candidates[0] if candidates else None

def ppt_key_candidates(key):
    parts = str(key or "").split("/", 1)
    if len(parts) != 2:
        return [key]
    uid, group = parts
    candidates = [key]
    legacy_group = "volume_preview" if group == "volume" else f"{group}_preview"
    candidates.append(f"{uid}/{legacy_group}")
    return list(dict.fromkeys(candidates))

def content_bbox(image):
    """返回图片中非白内容的 bbox。只用于找边界，不单独决定每张图的裁剪比例。"""
    arr = np.asarray(image.convert("RGBA"))
    alpha = arr[:, :, 3] > 10
    distance_from_white = np.max(255 - arr[:, :, :3].astype(np.int16), axis=2)
    nonwhite = alpha & (distance_from_white > WHITE_TRIM_DELTA)
    if not nonwhite.any():
        return None
    ys, xs = np.where(nonwhite)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

def expand_box_to_aspect(box, size, target_aspect):
    left, top, right, bottom = [float(v) for v in box]
    w, h = size
    box_w = right - left
    box_h = bottom - top
    if box_w <= 0 or box_h <= 0:
        return 0, 0, w, h
    current = box_w / box_h
    if abs(current - target_aspect) < 0.002:
        return int(round(left)), int(round(top)), int(round(right)), int(round(bottom))
    if current > target_aspect:
        needed_h = box_w / target_aspect
        extra = needed_h - box_h
        top -= extra / 2
        bottom += extra / 2
        if top < 0:
            bottom -= top
            top = 0
        if bottom > h:
            top -= bottom - h
            bottom = h
        top = max(0, top)
    else:
        needed_w = box_h * target_aspect
        extra = needed_w - box_w
        left -= extra / 2
        right += extra / 2
        if left < 0:
            right -= left
            left = 0
        if right > w:
            left -= right - w
            right = w
        left = max(0, left)
    return int(round(max(0, left))), int(round(max(0, top))), int(round(min(w, right))), int(round(min(h, bottom)))

def common_trim_box(entries):
    """按四个方向的最小白边统一裁剪，并额外保留 5% 画面，避免裁掉边缘密度。"""
    margins = []
    image_size = None
    for _, data in entries:
        src = Path(data.get("png") or "")
        if not src.exists():
            continue
        image = Image.open(src).convert("RGBA")
        image_size = image.size
        box = content_bbox(image)
        if box:
            left, top, right, bottom = box
            w, h = image.size
            margins.append((left, top, w - right, h - bottom))
    if not margins or not image_size:
        return None
    w, h = image_size
    min_left = min(item[0] for item in margins)
    min_top = min(item[1] for item in margins)
    min_right = min(item[2] for item in margins)
    min_bottom = min(item[3] for item in margins)
    keep_x = max(MIN_TRIM_PADDING_PX, int(round(w * EXTRA_WHITE_MARGIN_FRACTION)))
    keep_y = max(MIN_TRIM_PADDING_PX, int(round(h * EXTRA_WHITE_MARGIN_FRACTION)))
    crop_left = max(0, min_left - keep_x)
    crop_top = max(0, min_top - keep_y)
    crop_right = max(0, min_right - keep_x)
    crop_bottom = max(0, min_bottom - keep_y)
    box = (crop_left, crop_top, w - crop_right, h - crop_bottom)
    return expand_box_to_aspect(box, image_size, w / h)

def prepare_trimmed_images(folder, manifest):
    """统一裁剪白边，生成用于 PPT 的图片。"""
    trimmed = {}
    out_dir = folder / "chimerax_rendered_maps_trimmed"
    if Image is None or np is None:
        return trimmed
    entries = list((manifest.get("images") or {}).items())
    trim_box = common_trim_box(entries)
    if not trim_box:
        return trimmed
    manifest["common_trim_box"] = list(trim_box)
    for key, data in entries:
        src = Path(data.get("png") or "")
        if not src.exists():
            continue
        image = Image.open(src).convert("RGBA")
        cropped = image.crop(trim_box)
        white = Image.new("RGB", cropped.size, "white")
        white.paste(cropped, mask=cropped.split()[3])
        dst = out_dir / (safe_name(key.replace("/", "__")) + ".png")
        dst.parent.mkdir(parents=True, exist_ok=True)
        white.save(dst)
        data["ppt_png"] = str(dst)
        trimmed[key] = {"path": dst, "trim_box": list(trim_box)}
    return trimmed

def replace_ppt_media(session, folder, manifest):
    pptx = find_pptx(folder)
    if not pptx:
        log(session, "未找到 PPTX 文件，跳过替换")
        return None
    out_pptx = pptx.with_name(pptx.stem + "_chimerax.pptx")
    replacements = {}
    prepare_trimmed_images(folder, manifest)

    with zipfile.ZipFile(pptx, "r") as src:
        names = set(src.namelist())
        for slide_name in sorted(n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)):
            rels_name = "ppt/slides/_rels/" + Path(slide_name).name + ".rels"
            if rels_name not in names:
                continue
            slide_xml = src.read(slide_name).decode("utf-8", errors="ignore")
            rels_xml = src.read(rels_name).decode("utf-8", errors="ignore")
            rel_targets = {
                m.group(1): m.group(2)
                for m in re.finditer(r'<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"', rels_xml)
            }
            for pic_match in re.finditer(r"<p:pic\b.*?</p:pic>", slide_xml, re.S):
                pic_xml = pic_match.group(0)
                name_match = re.search(r'<p:cNvPr[^>]+name="CryoSmartImage:([^"]+)"', pic_xml)
                if not name_match:
                    continue
                key = name_match.group(1).replace("&amp;", "&").replace("&quot;", '"')
                image_key = next((c for c in ppt_key_candidates(key) if c in manifest.get("images", {})), None)
                if not image_key:
                    continue
                embed_match = re.search(r'<a:blip[^>]+r:embed="([^"]+)"', pic_xml)
                if not embed_match:
                    continue
                target = rel_targets.get(embed_match.group(1))
                if not target:
                    continue
                media_name = str((Path(slide_name).parent / target).as_posix())
                media_name = str(Path(media_name).as_posix())
                while "/../" in media_name:
                    media_name = re.sub(r"[^/]+/\.\./", "", media_name, count=1)
                if not media_name.startswith("ppt/media/"):
                    media_name = "ppt/media/" + Path(target).name
                png_path = Path(manifest["images"][image_key].get("ppt_png") or manifest["images"][image_key].get("png") or "")
                if png_path.exists():
                    replacements[media_name] = png_path.read_bytes()

        with zipfile.ZipFile(out_pptx, "w", zipfile.ZIP_DEFLATED) as dst:
            for item in src.infolist():
                data = replacements.get(item.filename)
                if data is None:
                    data = src.read(item.filename)
                dst.writestr(item, data)

    log(session, f"PPT 已生成: {out_pptx}")
    return out_pptx


# ==================== 主流程 ====================

def main(session, lineage_folder=None):
    # 确定文件夹
    if lineage_folder is None:
        argv = list(sys.argv[1:])
        if argv and Path(argv[0]).expanduser().exists():
            lineage_folder = argv[0]
        else:
            script_path = Path(__file__).expanduser().resolve() if "__file__" in globals() else None
            lineage_folder = script_path.parent if script_path else os.getcwd()
    folder = Path(lineage_folder).expanduser().resolve()
    if folder.is_file():
        folder = folder.parent

    log(session, "===== 仅导出图像 + 替换 PPT（不改变视角） =====")
    log(session, f"工作目录: {folder}")

    # 1. 加载 manifest
    manifest = load_render_manifest(folder)

    # 2. 导出图像（使用当前视角）
    manifest = export_images_with_current_view(session, folder, manifest)

    # 3. 替换 PPT
    out_pptx = replace_ppt_media(session, folder, manifest)

    # 4. 保存 manifest
    write_render_manifest(folder, manifest)

    log(session, "===== 全部完成 =====")
    if out_pptx:
        log(session, f"PPT 已生成: {out_pptx}")
    log(session, f"渲染图片目录: {folder / 'chimerax_rendered_maps'}")
    log(session, f"裁剪图片目录: {folder / 'chimerax_rendered_maps_trimmed'}")


# ==================== 入口 ====================
if "session" in globals():
    main(session)
elif __name__ == "__main__":
    print("请在 ChimeraX 中打开此脚本运行。")
