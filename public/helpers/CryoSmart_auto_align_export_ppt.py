# -*- coding: utf-8 -*-
"""
CryoSmart_align_optimize_export.py

一键完成：
  1. 自动对齐所有地图（候选测试、选最佳、继承变换）
  2. 基于当前基准视角，自动测试 5 个方向（基准、Y±90、X±90）选择最优视角
  3. 以该视角导出所有地图高清截图，裁剪白边并替换 PPT

运行环境：ChimeraX
"""

import csv
import json
import os
import re
import sys
import tempfile
import time
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
LEVEL_RATIO = 0.25
STEP = 1
FIT_SEARCH = 15
CORR_EPSILON = 0.0001

GENERATE_DEBUG_IMAGES = False
GENERATE_CXC = False

SNAPSHOT_WIDTH = 1600
SNAPSHOT_HEIGHT = 1200
GROUP_TRIM_PADDING_FRACTION = 0.035
WHITE_TRIM_DELTA = 8
MIN_TRIM_PADDING_PX = 60
EXTRA_WHITE_MARGIN_FRACTION = 0.05

SCORE_THUMB_SIZE = 220


# ==================== 通用工具函数 ====================
def q(path):
    return '"' + str(path).replace('"', '\\"') + '"'

def safe_name(value):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "item")).strip("_") or "item"

def volume_models(session):
    return [m for m in session.models.list() if m.__class__.__name__ == "Volume"]

def max_density(vol):
    try:
        return float(vol.data.full_matrix().max())
    except Exception:
        return 0.0

def position_text(model):
    try:
        return str(model.position)
    except Exception as exc:
        return f"position unavailable: {exc}"

def parse_job_num(uid):
    m = re.search(r"J(\d+)", str(uid or ""), re.I)
    return int(m.group(1)) if m else -1


# ==================== 对齐核心函数（完整） ====================
def parse_corr(text):
    if text is None:
        return None
    if isinstance(text, (int, float)):
        value = float(text)
        return value if -1.0 <= value <= 1.0 else None
    text = str(text)
    m = re.search(r"correlation\s*=?\s*([-+]?\d*\.?\d+)", text, re.I)
    if m:
        value = float(m.group(1))
        return value if -1.0 <= value <= 1.0 else None
    return None

def run_capture(session, cmd, command_log=None):
    if command_log is not None:
        command_log.append(cmd)
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".txt", delete=False) as tmp:
        log_path = tmp.name
    try:
        cxrun(session, "log clear")
        result = cxrun(session, cmd)
        cxrun(session, "log save " + q(log_path))
        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
            log_text = f.read()
        return result, log_text
    finally:
        if os.path.exists(log_path):
            os.unlink(log_path)

def measure_corr(session, vol_id, ref_id, command_log=None):
    cmd = f"measure correlation #{vol_id} inMap #{ref_id}"
    result, log_text = run_capture(session, cmd, command_log)
    corr = parse_corr(result)
    if corr is None:
        corr = parse_corr(log_text)
    return corr, str(result), log_text

def fit_corr(session, vol_id, ref_id, search=None, command_log=None):
    cmd = f"fit #{vol_id} in #{ref_id}"
    if search is not None:
        cmd += f" search {search}"
    result, log_text = run_capture(session, cmd, command_log)
    corr = parse_corr(result)
    if corr is None:
        corr = parse_corr(log_text)
    if corr is None:
        corr, _, _ = measure_corr(session, vol_id, ref_id, command_log)
    return corr, str(result), log_text

def open_volume(session, path, command_log=None):
    cmd = "open " + q(path)
    if command_log is not None:
        command_log.append(cmd)
    before = {m for m in session.models.list()}
    cxrun(session, cmd)
    after = [m for m in session.models.list() if m not in before]
    volumes = [m for m in after if m.__class__.__name__ == "Volume"]
    if not volumes:
        raise RuntimeError("Opened file is not a Volume: " + str(path))
    return volumes[-1]

def close_model(session, model, command_log=None):
    if not model:
        return
    cmd = f"close #{model.id_string}"
    if command_log is not None:
        command_log.append(cmd)
    try:
        cxrun(session, cmd)
    except Exception:
        pass

def set_volume_display(session, vol, ref_density, command_log=None):
    density = max_density(vol) or ref_density
    level = density * LEVEL_RATIO
    cmd = f"volume #{vol.id_string} level {level:.4f} step {STEP}"
    if command_log is not None:
        command_log.append(cmd)
    try:
        cxrun(session, cmd)
    except Exception:
        pass

def map_group_key(group):
    value = str(group or "volume")
    if value.lower() in ("volume", "map", "volume.map"):
        return "volume"
    value = re.sub(r"\.map$", "", value, flags=re.I)
    return safe_name(value)

def canonical_map_key(uid, group):
    return f"{safe_name(uid)}/{map_group_key(group)}"

def group_from_mrc_name(path):
    name = Path(path).name
    name = re.sub(r"\.mrc$", "", name, flags=re.I)
    name = re.sub(r"\.map$", "", name, flags=re.I)
    name = re.sub(r"^BJ\.[^.]+\.[^.]+\.", "", name)
    return map_group_key(name)

def find_lineage_json(folder):
    candidates = sorted(folder.glob("*_lineage.json"))
    if candidates:
        return candidates[0]
    candidates = sorted(folder.glob("*.json"))
    if not candidates:
        raise FileNotFoundError("No lineage JSON found in " + str(folder))
    return candidates[0]

def normal_map_assets(node):
    out = []
    for item in node.get("maps") or []:
        group = str(item.get("group") or "")
        if item.get("group_type") and item.get("group_type") != "volume":
            continue
        if "mask" in group.lower():
            continue
        url = item.get("download_url") or ""
        if item.get("result_name") == "map" or url.endswith(".map"):
            out.append(item)
    return out

def map_key_for_node_item(node, item):
    return canonical_map_key(node.get("uid"), item.get("group") or "volume")

def mrc_candidates_from_summary(folder, summary):
    candidates = {}
    project = summary.get("project_uid") or ""
    for node in summary.get("nodes") or []:
        uid = node.get("uid")
        if not uid:
            continue
        for item in normal_map_assets(node):
            group = item.get("group") or "volume"
            suffix = f"{group}.{item.get('result_name') or 'map'}"
            path = folder / "maps" / safe_name(uid) / f"BJ.{safe_name(project)}.{safe_name(uid)}.{safe_name(suffix)}.mrc"
            key = map_key_for_node_item(node, item)
            candidates[key] = {
                "key": key,
                "uid": uid,
                "job_type": node.get("job_type") or "",
                "group": group,
                "path": path,
                "is_final": uid == summary.get("start_uid"),
            }

    start_uid = summary.get("start_uid")
    for name in (summary.get("map_download_urls") or {}).keys():
        path = folder / "maps" / safe_name(start_uid) / f"BJ.{safe_name(project)}.{safe_name(start_uid)}.{safe_name(name)}.mrc"
        key = canonical_map_key(start_uid, name)
        candidates.setdefault(key, {
            "key": key,
            "uid": start_uid,
            "job_type": (summary.get("start_job") or {}).get("job_type") or "",
            "group": name,
            "path": path,
            "is_final": True,
        })

    maps_dir = folder / "maps"
    for path in sorted(maps_dir.glob("**/*")) if maps_dir.exists() else []:
        if path.is_file() and path.suffix.lower() in (".mrc", ".map"):
            m = re.search(r"\.(J\d+)\.", "." + path.name)
            uid = m.group(1) if m else path.parent.name
            group = group_from_mrc_name(path)
            key = canonical_map_key(uid, group)
            candidates.setdefault(key, {
                "key": key,
                "uid": uid,
                "job_type": "",
                "group": group,
                "path": path,
                "is_final": uid == start_uid,
            })

    unique = []
    seen_paths = set()
    for item in candidates.values():
        if not item["path"].exists():
            continue
        resolved = item["path"].resolve()
        if resolved in seen_paths:
            continue
        seen_paths.add(resolved)
        unique.append(item)
    return unique

def choose_reference(items, summary):
    start_uid = summary.get("start_uid")
    final_items = [item for item in items if item.get("uid") == start_uid]
    preferred = [item for item in final_items if item.get("key") == canonical_map_key(start_uid, "volume")]
    if preferred:
        return preferred[0]
    if final_items:
        return final_items[0]
    return sorted(items, key=lambda item: parse_job_num(item.get("uid")))[-1] if items else None

def class_index_from_group(group):
    m = re.search(r"(?:volume|particles)_class_(\d+)", str(group or ""), re.I)
    return int(m.group(1)) if m else None

def target_map_groups_for_edge(edge, target_node, item_by_key):
    target_uid = edge.get("target")
    source_group = map_group_key(edge.get("source_group"))
    source_class = class_index_from_group(source_group)
    target_groups = []
    if target_node:
        for map_item in normal_map_assets(target_node):
            group = map_group_key(map_item.get("group") or "volume")
            if group not in target_groups:
                target_groups.append(group)

    candidates = []
    if canonical_map_key(target_uid, source_group) in item_by_key:
        candidates.append(source_group)
    if source_class is not None:
        for group in target_groups:
            if class_index_from_group(group) == source_class and group not in candidates:
                candidates.append(group)
    if not candidates and "volume" in target_groups:
        candidates.append("volume")
    if not candidates and len(target_groups) == 1:
        candidates.append(target_groups[0])
    return [group for group in candidates if canonical_map_key(target_uid, group) in item_by_key]

def build_map_lineage(summary, items):
    item_by_key = {item["key"]: item for item in items}
    nodes_by_uid = {node.get("uid"): node for node in summary.get("nodes") or [] if node.get("uid")}
    edges = []
    seen = set()
    warnings = []

    for edge in summary.get("edges") or []:
        if edge.get("input_type") != "volume":
            continue
        source_uid = edge.get("source")
        target_uid = edge.get("target")
        source_group = map_group_key(edge.get("source_group"))
        source_key = canonical_map_key(source_uid, source_group)
        if source_key not in item_by_key:
            warnings.append(f"skip volume edge {source_uid}.{source_group} -> {target_uid}: source MRC missing")
            continue
        target_node = nodes_by_uid.get(target_uid)
        for target_group in target_map_groups_for_edge(edge, target_node, item_by_key):
            target_key = canonical_map_key(target_uid, target_group)
            edge_key = (source_key, target_key)
            if edge_key in seen:
                continue
            seen.add(edge_key)
            edges.append({
                "source": source_key,
                "target": target_key,
                "reason": f"{source_uid}.{source_group} -> {target_uid}.{target_group}",
            })

    incoming = {}
    outgoing = {}
    for edge in edges:
        outgoing.setdefault(edge["source"], []).append(edge["target"])
        incoming.setdefault(edge["target"], []).append(edge["source"])

    start_keys = [key for key in item_by_key if key not in incoming]
    if not start_keys:
        start_keys = sorted(item_by_key)
        warnings.append("No start map inferred; treating every downloaded map as a possible start.")

    chains = []

    def walk(start_key, current_key, path):
        children = sorted(outgoing.get(current_key) or [])
        if not children:
            chains.append({"start": start_key, "terminal": current_key, "keys": list(path)})
            return
        for child in children:
            if child in path:
                warnings.append(f"Cycle detected in map lineage: {' -> '.join(path + [child])}")
                continue
            walk(start_key, child, path + [child])

    for start_key in sorted(start_keys, key=lambda key: (parse_job_num(key), key)):
        walk(start_key, start_key, [start_key])
    if not chains:
        chains = [{"start": key, "terminal": key, "keys": [key]} for key in sorted(item_by_key)]

    return {
        "items": item_by_key,
        "edges": edges,
        "incoming": incoming,
        "outgoing": outgoing,
        "starts": sorted(start_keys, key=lambda key: (parse_job_num(key), key)),
        "chains": chains,
        "warnings": warnings,
    }

def chain_label(chain):
    return " -> ".join(chain.get("keys") or [])

def chain_for_key(lineage, key):
    containing = [chain for chain in lineage.get("chains") or [] if key in (chain.get("keys") or [])]
    if not containing:
        return None
    return sorted(containing, key=lambda chain: (-len(chain.get("keys") or []), chain_label(chain)))[0]

def lineage_terminal_results_for_key(lineage, terminal_results, key):
    chain = chain_for_key(lineage, key)
    if not chain:
        return None, None
    return chain, terminal_results.get(chain.get("terminal"))

def candidate_specs():
    return [
        {"name": "original", "kind": "original"},
        {"name": "rot_x_180", "kind": "rotate", "axis": "x", "angle": 180},
        {"name": "rot_y_180", "kind": "rotate", "axis": "y", "angle": 180},
        {"name": "rot_z_180", "kind": "rotate", "axis": "z", "angle": 180},
        {"name": "flip_z", "kind": "flip", "axis": "z"},
    ]

def test_candidate(session, item, reference, ref_vol, ref_density, spec):
    commands = []
    errors = []
    opened = []
    active = None
    try:
        vol = open_volume(session, item["path"], commands)
        opened.append(vol)
        vol.name = f"{item['key']}__{spec['name']}"
        set_volume_display(session, vol, ref_density, commands)
        active = vol

        if spec["kind"] == "rotate":
            cmd = f"turn {spec['axis']} {spec['angle']} models #{vol.id_string} center #{vol.id_string}"
            commands.append(cmd)
            cxrun(session, cmd)
            commands.append("wait 1")
            cxrun(session, "wait 1")
        elif spec["kind"] == "flip":
            flip_id = max([m.id[0] for m in session.models.list() if getattr(m, "id", None)] + [0]) + 1
            cmd = f"volume flip #{vol.id_string} axis {spec['axis']} modelId {flip_id}"
            commands.append(cmd)
            cxrun(session, cmd)
            flip_model = next((m for m in volume_models(session) if m.id[0] == flip_id), None)
            if flip_model is None:
                raise RuntimeError("flip model was not created")
            flip_model.name = f"{item['key']}__{spec['name']}"
            set_volume_display(session, flip_model, ref_density, commands)
            active = flip_model
            close_model(session, vol, commands)
            opened = [flip_model]

        pre_corr, pre_raw, pre_log = measure_corr(session, active.id_string, ref_vol.id_string, commands)
        fit1_corr, fit1_raw, fit1_log = fit_corr(session, active.id_string, ref_vol.id_string, search=None, command_log=commands)
        fit2_corr, fit2_raw, fit2_log = fit_corr(session, active.id_string, ref_vol.id_string, search=FIT_SEARCH, command_log=commands)

        score = fit2_corr if fit2_corr is not None else fit1_corr
        if score is None:
            score = pre_corr

        return {
            "candidate": spec["name"],
            "kind": spec["kind"],
            "model": active,
            "model_id": active.id_string,
            "score": score,
            "pre_corr": pre_corr,
            "fit_no_search_corr": fit1_corr,
            "fit_search_corr": fit2_corr,
            "position": position_text(active),
            "commands": commands,
            "errors": errors,
            "raw": {
                "pre": pre_raw,
                "fit_no_search": fit1_raw,
                "fit_search": fit2_raw,
                "pre_log": pre_log,
                "fit_no_search_log": fit1_log,
                "fit_search_log": fit2_log,
            },
            "opened_models": opened,
        }
    except Exception as exc:
        errors.append(str(exc))
        for model in opened:
            close_model(session, model, commands)
        return {
            "candidate": spec["name"],
            "kind": spec["kind"],
            "model": None,
            "model_id": "",
            "score": None,
            "pre_corr": None,
            "fit_no_search_corr": None,
            "fit_search_corr": None,
            "position": "",
            "commands": commands,
            "errors": errors,
            "raw": {},
            "opened_models": [],
        }

def choose_best(rows):
    valid = [row for row in rows if row.get("score") is not None and row.get("model") is not None]
    if not valid:
        return None
    return sorted(valid, key=lambda row: float(row["score"]), reverse=True)[0]

def write_candidate_cxc(cxc_dir, item, reference, rows):
    path = cxc_dir / (safe_name(item["key"].replace("/", "__")) + "_fit_candidates.cxc")
    lines = [
        "# CryoSmart fit candidate debug",
        f"# map: {item['key']}",
        f"# reference: {reference['key']}",
        "set bgColor white",
        "",
    ]
    for row in rows:
        lines.append(f"# Candidate: {row['candidate']}")
        for cmd in row.get("commands", []):
            lines.append(cmd)
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path

def write_debug_logs(out_dir, manifest, candidate_rows):
    tsv_path = out_dir / "fit_candidate_debug.tsv"
    columns = [
        "map_key", "candidate", "chosen", "model_id", "score",
        "pre_corr", "fit_no_search_corr", "fit_search_corr",
        "reference_key", "source_mrc", "reference_mrc", "position", "cxc_file", "errors",
    ]
    with tsv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, delimiter="\t")
        writer.writeheader()
        for row in candidate_rows:
            writer.writerow({col: row.get(col, "") for col in columns})

    txt_path = out_dir / "fit_candidate_debug.txt"
    lines = [
        "CryoSmart fit candidate debug",
        f"created_at: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"lineage_folder: {manifest.get('lineage_folder')}",
        f"reference: {manifest.get('reference_key')} -> {manifest.get('reference_path')}",
        "",
    ]
    current = None
    for row in candidate_rows:
        if row["map_key"] != current:
            current = row["map_key"]
            lines.append("")
            lines.append("=" * 80)
            lines.append(current)
            lines.append("=" * 80)
        mark = "CHOSEN" if row.get("chosen") else "test"
        lines.append(
            f"[{mark}] {row['candidate']} model={row.get('model_id')} "
            f"score={row.get('score')} pre={row.get('pre_corr')} "
            f"fit1={row.get('fit_no_search_corr')} fit_search={row.get('fit_search_corr')}"
        )
        if row.get("errors"):
            lines.append("  errors: " + row["errors"])
        lines.append("  position: " + str(row.get("position") or ""))
        if row.get("cxc_file"):
            lines.append("  cxc: " + row["cxc_file"])
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    manifest_path = out_dir / "fit_candidate_debug_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return txt_path, tsv_path, manifest_path


# ==================== 导出相关函数（来自第二个脚本） ====================
def find_volume_by_key(session, key, manifest):
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

def export_images_with_current_view(session, folder, manifest):
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

    for vol in all_vols:
        cxrun(session, f"show #{vol.id_string} models")
    cxrun(session, "wait 1")

    session.logger.info(f"开始导出 {len(matched)} 张图像，使用当前视角...")

    for key, model in matched.items():
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
        session.logger.info(f"  已保存: {png_path.name}")

    for vol in all_vols:
        cxrun(session, f"show #{vol.id_string} models")

    return manifest

def content_bbox(image):
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

def replace_ppt_media(session, folder, manifest):
    pptx = find_pptx(folder)
    if not pptx:
        session.logger.info("未找到 PPTX 文件，跳过替换")
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

    session.logger.info(f"PPT 已生成: {out_pptx}")
    return out_pptx


# ==================== 新增：90°视角自动优化函数（来自第三个脚本） ====================
def score_current_view(session):
    """截取当前视角缩略图，计算非白色像素比例作为评分（地图覆盖率）"""
    if np is None or Image is None:
        return 0.0
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        path = tmp.name
    try:
        cxrun(session, f"save {q(path)} width {SCORE_THUMB_SIZE} height {SCORE_THUMB_SIZE} supersample 1 transparentBackground false")
        img = Image.open(path).convert("RGB")
        arr = np.array(img)
        bg = np.all(arr > 240, axis=-1)
        score = float((arr.shape[0] * arr.shape[1] - np.sum(bg)) / (arr.shape[0] * arr.shape[1]))
        return score
    except Exception as e:
        session.logger.warning(f"视角评分失败: {e}")
        return 0.0
    finally:
        if os.path.exists(path):
            os.unlink(path)

def select_best_90_view(session, test_vol):
    """
    基于当前视角（需先手动调好基准），测试5个方向（基准、Y±90、X±90），
    选择地图占画面比例最大的方向，并应用该视角。
    """
    session.logger.info("===== 90° 视角自动优化 =====")

    # 保存当前视角为基准
    cxrun(session, "view name base_view")
    cxrun(session, "wait 1")

    # 只显示测试地图
    all_vols = volume_models(session)
    for vol in all_vols:
        if vol.id_string == test_vol.id_string:
            cxrun(session, f"show #{vol.id_string} models")
        else:
            cxrun(session, f"hide #{vol.id_string} models")
    cxrun(session, "wait 1")

    candidates = [
        ("base", 0, 0),
        ("y+90", 0, 90),
        ("y-90", 0, -90),
        ("x+90", 90, 0),
        ("x-90", -90, 0),
    ]

    best_score = -1.0
    best_desc = "base"
    best_rot = (0, 0)

    for desc, x_rot, y_rot in candidates:
        cxrun(session, "view base_view")
        cxrun(session, "wait 1")
        if x_rot != 0:
            cxrun(session, f"turn x {x_rot}")
        if y_rot != 0:
            cxrun(session, f"turn y {y_rot}")
        cxrun(session, "wait 1")
        score = score_current_view(session)
        session.logger.info(f"  {desc}: X={x_rot}°, Y={y_rot}°, Score={score:.4f}")
        if score > best_score:
            best_score = score
            best_desc = desc
            best_rot = (x_rot, y_rot)

    # 应用最佳视角
    session.logger.info(f"最佳视角: {best_desc} (X={best_rot[0]}°, Y={best_rot[1]}°), Score={best_score:.4f}")
    cxrun(session, "view base_view")
    cxrun(session, "wait 1")
    if best_rot[0] != 0:
        cxrun(session, f"turn x {best_rot[0]}")
    if best_rot[1] != 0:
        cxrun(session, f"turn y {best_rot[1]}")
    cxrun(session, "wait 1")

    # 恢复显示所有地图
    for vol in all_vols:
        cxrun(session, f"show #{vol.id_string} models")
    cxrun(session, "wait 1")

    return {"desc": best_desc, "x": best_rot[0], "y": best_rot[1], "score": best_score}


# ==================== 主流程 ====================
def main(session, lineage_folder=None):
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

    session.logger.info("===== CryoSmart 自动对齐 + 视角优化 + 导出 PPT =====")
    session.logger.info(f"工作目录: {folder}")

    # ---- 1. 加载谱系数据 ----
    summary_path = find_lineage_json(folder)
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    items = mrc_candidates_from_summary(folder, summary)
    if not items:
        raise RuntimeError("没有找到可用的 MRC 文件")
    reference = choose_reference(items, summary)
    if not reference:
        raise RuntimeError("无法确定参考地图")

    session.logger.info(f"参考地图: {reference['key']} -> {reference['path']}")

    # ---- 2. 构建 map 谱系 ----
    lineage = build_map_lineage(summary, items)
    manifest = {
        "lineage_folder": str(folder),
        "lineage_json": str(summary_path),
        "reference_key": reference["key"],
        "reference_path": str(reference["path"]),
        "fit_search": FIT_SEARCH,
        "map_lineage": {
            "starts": lineage["starts"],
            "edges": lineage["edges"],
            "chains": lineage["chains"],
            "warnings": lineage["warnings"],
        },
        "models": {},
        "terminal_results": {},
        "warnings": list(lineage["warnings"]),
    }

    # ---- 3. 打开参考地图 ----
    ref_commands = []
    ref_vol = open_volume(session, reference["path"], ref_commands)
    ref_vol.name = reference["key"]
    ref_density = max_density(ref_vol)
    set_volume_display(session, ref_vol, ref_density, ref_commands)
    manifest["models"][reference["key"]] = {
        "role": "reference",
        "model_id": ref_vol.id_string,
        "source_mrc": str(reference["path"]),
        "position": position_text(ref_vol),
        "commands": ref_commands,
    }

    loaded_by_key = {reference["key"]: {"model": ref_vol, **reference, "score": 1.0}}
    terminal_results = {reference["key"]: loaded_by_key[reference["key"]]}
    all_candidate_rows = []

    # ---- 4. 对每个终端地图测试候选 ----
    terminal_keys = sorted({chain["terminal"] for chain in lineage["chains"]})
    for terminal_key in terminal_keys:
        if terminal_key == reference["key"]:
            continue
        item = lineage["items"].get(terminal_key)
        if not item:
            continue
        session.logger.info(f"测试终端地图: {terminal_key}")

        candidate_rows = []
        for spec in candidate_specs():
            row = test_candidate(session, item, reference, ref_vol, ref_density, spec)
            candidate_rows.append(row)
            session.logger.info(
                f"  {spec['name']}: score={row.get('score')} "
                f"fit1={row.get('fit_no_search_corr')} fit_search={row.get('fit_search_corr')}"
            )

        best = choose_best(candidate_rows)
        if GENERATE_CXC:
            cxc_dir = folder / "debug_cxc"
            cxc_dir.mkdir(exist_ok=True)
            cxc_path = write_candidate_cxc(cxc_dir, item, reference, candidate_rows)
        else:
            cxc_path = None

        for row in candidate_rows:
            row["map_key"] = item["key"]
            row["chosen"] = bool(best and row is best)
            row["reference_key"] = reference["key"]
            row["source_mrc"] = str(item["path"])
            row["reference_mrc"] = str(reference["path"])
            row["cxc_file"] = str(cxc_path) if cxc_path else ""
            row["errors"] = "; ".join(row.get("errors") or [])
            all_candidate_rows.append(row)

        if best is None:
            manifest["warnings"].append(f"没有找到有效候选: {item['key']}")
            continue

        for row in candidate_rows:
            if row is best:
                continue
            for model in row.get("opened_models") or []:
                close_model(session, model)

        best_model = best["model"]
        best_model.name = item["key"] + "__BEST_" + best["candidate"]
        result = {
            **item,
            "model": best_model,
            "score": best["score"],
            "candidate": best["candidate"],
            "model_id": best_model.id_string,
            "position": position_text(best_model),
            "cxc_file": str(cxc_path) if cxc_path else "",
        }
        terminal_results[terminal_key] = result
        loaded_by_key[terminal_key] = result
        manifest["terminal_results"][terminal_key] = {
            "chosen_candidate": best["candidate"],
            "score": best["score"],
            "model_id": best_model.id_string,
            "source_mrc": str(item["path"]),
            "position": position_text(best_model),
        }
        manifest["models"][item["key"]] = {
            "role": "chain_terminal",
            "model_id": best_model.id_string,
            "chosen_candidate": best["candidate"],
            "score": best["score"],
            "source_mrc": str(item["path"]),
            "position": position_text(best_model),
        }
        session.logger.info(f"  选中 {terminal_key}: {best['candidate']} score={best['score']}")

    # ---- 5. 继承变换给链上非终端成员 ----
    for item in items:
        if item["key"] in loaded_by_key:
            continue
        chain, terminal_result = lineage_terminal_results_for_key(lineage, terminal_results, item["key"])
        if not terminal_result or not terminal_result.get("model"):
            manifest["warnings"].append(f"无法继承变换: {item['key']}（缺少终端结果）")
            continue
        commands = []
        try:
            vol = open_volume(session, item["path"], commands)
            vol.name = item["key"] + "__inherited"
            set_volume_display(session, vol, ref_density, commands)
            vol.position = terminal_result["model"].position
            loaded_by_key[item["key"]] = {**item, "model": vol}
            manifest["models"][item["key"]] = {
                "role": "chain_member_inherited",
                "model_id": vol.id_string,
                "source_mrc": str(item["path"]),
                "inherited_from_terminal": chain["terminal"] if chain else "",
                "terminal_candidate": terminal_result.get("candidate", ""),
                "terminal_score": terminal_result.get("score", ""),
                "position": position_text(vol),
                "commands": commands,
            }
        except Exception as exc:
            manifest["warnings"].append(f"继承失败 {item['key']}: {exc}")

    # ---- 6. （可选）生成调试日志 ----
    if GENERATE_DEBUG_IMAGES:
        out_dir = folder / "chimerax_fit_candidate_debug"
        out_dir.mkdir(exist_ok=True)
        write_debug_logs(out_dir, manifest, all_candidate_rows)

    # ---- 7. 显示所有模型，提示用户手动调整基准视角（非阻塞） ----
    for vol in volume_models(session):
        cxrun(session, f"show #{vol.id_string} models")
    cxrun(session, "set bgColor white")
    cxrun(session, "view pad 0.25")
    cxrun(session, "wait 1")

    session.logger.info("\n" + "=" * 60)
    session.logger.info("请手动旋转/缩放视角到您想要的基准方向（使地图居中且特征明显）。")
    session.logger.info("调整好后，脚本将自动测试 5 个方向（基准、Y±90、X±90）并选出最优视角。")
    session.logger.info("如果您已经调整好，脚本会立即开始优化；否则请先调整，然后继续运行。")
    session.logger.info("=" * 60 + "\n")

    # ---- 8. 执行 90° 视角自动优化（基于当前基准） ----
    best_view = select_best_90_view(session, ref_vol)
    manifest["best_90_view"] = best_view

    # ---- 9. 导出图像（使用优化后的视角） ----
    manifest = export_images_with_current_view(session, folder, manifest)

    # ---- 10. 替换 PPT ----
    out_pptx = replace_ppt_media(session, folder, manifest)

    # ---- 11. 保存 manifest ----
    manifest_path = folder / "chimerax_rendered_maps" / "rendered_map_manifest.json"
    manifest_path.parent.mkdir(exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    session.logger.info("===== 全部完成 =====")
    session.logger.info(f"最佳视角: {best_view['desc']} (X={best_view['x']}°, Y={best_view['y']}°)")
    session.logger.info(f"得分: {best_view['score']:.4f}")
    if out_pptx:
        session.logger.info(f"PPT 已生成: {out_pptx}")
    session.logger.info(f"渲染图片目录: {folder / 'chimerax_rendered_maps'}")
    session.logger.info(f"裁剪图片目录: {folder / 'chimerax_rendered_maps_trimmed'}")


# ==================== 入口 ====================
if "session" in globals():
    main(session)
else:
    print("请在 ChimeraX 中打开此脚本运行。")