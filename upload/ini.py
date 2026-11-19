# -*- coding: utf-8 -*-
# ini.py - ChimeraX 实用工具集（整合版，已修复跨模型链标识符问题）

import os
import sys
import re
import tempfile
import itertools
import shutil
from collections import deque, defaultdict
from datetime import datetime
from math import gcd
import numpy as np
from io import StringIO


# ChimeraX 核心导入
from chimerax.core.commands import run as cxrun
from chimerax.atomic import AtomicStructure, selected_residues


# ========================= 1. 模型检查 =========================
def inspect_models(session, tag="", save_file=False):
    """
    检查当前会话中的模型并返回统计信息，可选择是否保存到 txt。

    参数:
        session: ChimeraX 会话对象
        tag: 可选标记字符串
        save_file: 是否保存统计信息到文件（默认 False）

    返回字典:
        {
            'total_models': int,
            'atom_models': int,
            'regular_volumes': int,
            'locres_volumes': int,
            'surface_models': int,
            'pseudobonds_models': int,
            'other_models': int,
            'tag': str
        }
    """
    stats = {
        'total_models': 0,
        'atom_models': 0,
        'regular_volumes': 0,
        'locres_volumes': 0,
        'surface_models': 0,
        'pseudobonds_models': 0,
        'other_models': 0,
        'tag': tag
    }

    atom_models_details = []
    regular_volumes_details = []
    locres_volumes_details = []
    virtual_models_details = []

    for model in session.models.list():
        model_id = getattr(model, 'id_string', None)
        if not model_id:
            model_id = getattr(model, 'name', '未命名')
        model_name = getattr(model, 'name', '未命名')

        if hasattr(model, 'atoms') or (hasattr(model, '__class__') and model.__class__.__name__ == "AtomicStructure"):
            model_type = "原子模型 (PDB)"
            stats['atom_models'] += 1
            stats['total_models'] += 1
            atom_models_details.append(f"{model_id}: {model_name} [{model_type}]")
        elif hasattr(model, '__class__') and model.__class__.__name__ == "Volume":
            if "locres" in model_name.lower() or "locres" in getattr(model, "path", "").lower():
                model_type = "Volume (Local Resolution)"
                stats['locres_volumes'] += 1
                stats['total_models'] += 1
                locres_volumes_details.append(f"{model_id}: {model_name} [{model_type}]")
            else:
                model_type = "Volume (普通)"
                stats['regular_volumes'] += 1
                stats['total_models'] += 1
                regular_volumes_details.append(f"{model_id}: {model_name} [{model_type}]")
        else:
            cls_name = getattr(model, '__class__', None)
            cls_name_str = cls_name.__name__ if cls_name else ""
            if cls_name_str.lower() == "surface":
                model_type = "Surface 模型"
                stats['surface_models'] += 1
            elif cls_name_str.lower() == "pseudobonds":
                model_type = "PseudoBonds 模型"
                stats['pseudobonds_models'] += 1
            else:
                model_type = "其他/虚模型"
                stats['other_models'] += 1
            virtual_models_details.append(f"{model_id}: {model_name} [{model_type}]")

    model_details = atom_models_details + regular_volumes_details + locres_volumes_details + virtual_models_details

    if save_file:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"model_stats_{timestamp}.txt"
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
        except NameError:
            script_dir = os.getcwd()
        filepath = os.path.join(script_dir, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"模型统计信息 ({tag})\n")
            f.write(f"时间: {timestamp}\n")
            f.write(f"总模型数: {stats['total_models']}\n")
            f.write(f"原子模型数: {stats['atom_models']}\n")
            f.write(f"普通 Volume 图数: {stats['regular_volumes']}\n")
            f.write(f"Local Resolution 图数: {stats['locres_volumes']}\n")
            f.write(f"Surface 模型数: {stats['surface_models']}\n")
            f.write(f"PseudoBonds 模型数: {stats['pseudobonds_models']}\n")
            f.write(f"其他/虚模型数: {stats['other_models']}\n")
            f.write("\n详细模型列表:\n")
            for detail in model_details:
                f.write(detail + "\n")

        print(f"统计信息已保存到 {filepath}")
    else:
        # 不保存文件，仅打印简略信息
        print(f"模型统计信息 ({tag}) 已收集，未保存文件。")
        print(f"原子模型数: {stats['atom_models']}, 普通Volume: {stats['regular_volumes']}, LocalRes: {stats['locres_volumes']}")

    return stats


# ========================= 2. 调色板 =========================
def generate_all_palette_schemes(num_groups=7):
    """
    为所有内置调色板生成颜色方案。
    返回结构：调色板 -> 类别(base/darker/lighter) -> 颜色(8) -> 通道修饰组(7)
    """
    palettes = {
        'scientific': [
            (35, 118, 182), (43, 160, 43), (252, 128, 9), (214, 39, 36),
            (231, 118, 192), (148, 103, 186), (142, 128, 73), (128, 128, 128)
        ],
        'elegant': [
            (255, 157, 149), (255, 140, 32), (255, 190, 124), (223, 223, 141),
            (157, 223, 141), (63, 199, 199), (161, 139, 199), (247, 139, 37)
        ],
        'neutral': [
            (43, 174, 158), (101, 162, 210), (212, 217, 138), (114, 178, 133),
            (190, 191, 180), (245, 142, 135), (235, 139, 57), (227, 125, 70)
        ],
        'pastel': [
            (97, 161, 207), (141, 182, 223), (255, 223, 144), (113, 207, 190),
            (175, 155, 214), (123, 198, 223), (247, 172, 95), (238, 127, 98)
        ],
        'vibrant': [
            (247, 141, 133), (255, 215, 199), (72, 182, 207), (182, 223, 215),
            (133, 166, 175), (141, 157, 199), (137, 201, 199), (255, 199, 37)
        ],
        'soft': [
            (217, 95, 95), (239, 175, 168), (247, 207, 107), (255, 223, 141),
            (123, 181, 222), (140, 205, 239), (168, 139, 187), (200, 155, 200)
        ]
    }

    def rgb_to_hex(rgb):
        return f'#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}'

    def adjust_channel(rgb, factor, channel):
        r, g, b = rgb
        if channel == 'R':
            r = r + (255 - r) * (factor - 1) if factor > 1 else r - r * (1 - factor)
            r = max(0, min(255, int(r)))
        elif channel == 'G':
            g = g + (255 - g) * (factor - 1) if factor > 1 else g - g * (1 - factor)
            g = max(0, min(255, int(g)))
        elif channel == 'B':
            b = b + (255 - b) * (factor - 1) if factor > 1 else b - b * (1 - factor)
            b = max(0, min(255, int(b)))
        return (r, g, b)

    def adjust_brightness(rgb, factor):
        r = min(255, max(0, int(rgb[0] * factor)))
        g = min(255, max(0, int(rgb[1] * factor)))
        b = min(255, max(0, int(rgb[2] * factor)))
        return (r, g, b)

    all_schemes = {}
    for palette_name, palette_colors in palettes.items():
        # 通道修饰参数
        group_params = []
        for group_idx in range(num_groups):
            if group_idx == 0:       factor, channel = 0.7, 'R'
            elif group_idx == 1:     factor, channel = 1.3, 'R'
            elif group_idx == 2:     factor, channel = 0.7, 'G'
            elif group_idx == 3:     factor, channel = 1.3, 'G'
            elif group_idx == 4:     factor, channel = 0.7, 'B'
            elif group_idx == 5:     factor, channel = 1.3, 'B'
            else:                    factor, channel = 1.0, None
            group_params.append((factor, channel))

        # 基础矩阵 (颜色数 x groups)
        base_matrix_rgb = []
        for orig_color in palette_colors:
            row = []
            for factor, ch in group_params:
                if ch:
                    adjusted = adjust_channel(orig_color, factor, ch)
                else:
                    adjusted = orig_color
                row.append(adjusted)
            base_matrix_rgb.append(row)

        darker_matrix_rgb = [[adjust_brightness(c, 0.5) for c in row] for row in base_matrix_rgb]
        lighter_matrix_rgb = [[adjust_brightness(c, 2.0) for c in row] for row in base_matrix_rgb]

        base_hex = [[rgb_to_hex(c) for c in row] for row in base_matrix_rgb]
        darker_hex = [[rgb_to_hex(c) for c in row] for row in darker_matrix_rgb]
        lighter_hex = [[rgb_to_hex(c) for c in row] for row in lighter_matrix_rgb]

        all_schemes[palette_name] = {
            'base': base_hex,
            'darker': darker_hex,
            'lighter': lighter_hex
        }

    print(f"✅ 已为 {len(palettes)} 种调色板生成颜色方案 (每个原始颜色拥有 {num_groups} 个通道修饰变体)。")
    return all_schemes


# ========================= 3. 会话与视图保存 =========================
def save_session_and_views(session, base_name="output",
                           save_session=False,
                           save_images=False,
                           three_views=False,
                           focus_model=None,
                           output_dir=None,
                           output_subdir=None):
    """
    保存当前会话和/或视图图片（全部可选，默认均不保存）。
    三视图模式下：若某个视图留白不足，则在该视图上额外 pad 0.25 后重新保存全部三视图一次。
    """
    import os
    from datetime import datetime
    from chimerax.core.commands import run as cxrun
    from PIL import Image
    import numpy as np
    import traceback

    # 简单日志函数
    def log(msg, level="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"[{timestamp}] [{level}] [save_session_and_views] {msg}")

    log("函数开始执行")
    log(f"参数: base_name={base_name}, save_session={save_session}, save_images={save_images}, three_views={three_views}, focus_model={focus_model}, output_dir={output_dir}, output_subdir={output_subdir}")

    # ----- 确定输出目录 -----
    if output_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        subdir = output_subdir if output_subdir is not None else "picture_output"
        output_dir = os.path.join(script_dir, subdir)
        log(f"未指定output_dir，自动生成目录: {output_dir}")
    else:
        log(f"使用指定output_dir: {output_dir}")
    os.makedirs(output_dir, exist_ok=True)
    log(f"输出目录已确保存在: {output_dir}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_session = None
    saved_images = []

    # ----- 辅助检测函数：判断图片边缘是否全为背景（有留白）-----
    def has_margin(image_path, edge_ratio=0.1, bg_threshold=250):
        """检测四周边缘 edge_ratio 比例区域是否全为背景色（True=有留白）"""
        try:
            log(f"检测图片边缘留白: {image_path}, edge_ratio={edge_ratio}, bg_threshold={bg_threshold}", "DEBUG")
            img = Image.open(image_path).convert('RGB')
            arr = np.array(img)
            h, w, _ = arr.shape
            edge_h = max(1, int(h * edge_ratio))
            edge_w = max(1, int(w * edge_ratio))
            top = arr[:edge_h, :]
            bottom = arr[-edge_h:, :]
            left = arr[:, :edge_w]
            right = arr[:, -edge_w:]

            # 判断区域是否为背景（所有通道 > bg_threshold）
            is_bg = lambda region: np.all(region > bg_threshold, axis=-1)

            # 分别检查四个边缘
            for name, region in [("top", top), ("bottom", bottom), ("left", left), ("right", right)]:
                bg = np.all(is_bg(region))
                log(f"  边缘 {name}: 全背景={bg}", "DEBUG")
                if not bg:
                    log(f"  留白不足：{name} 边缘存在非背景像素", "DEBUG")
                    return False
            log(f"  所有边缘均为背景（有留白）", "DEBUG")
            return True
        except Exception as e:
            log(f"检测图片失败: {e}\n{traceback.format_exc()}", "ERROR")
            # 出错时默认认为无留白，避免误判
            return False

    # ----- 聚焦模型（确保可见）-----
    if focus_model is not None and save_images:
        if hasattr(focus_model, 'id_string'):
            model_spec = f"#{focus_model.id_string}"
        else:
            model_spec = str(focus_model)
        log(f"聚焦模型: {model_spec}")
        try:
            cxrun(session, f"show {model_spec} models")
            cxrun(session, f"view {model_spec}")
            cxrun(session, f"view {model_spec} pad 0.25")
            log(f"聚焦模型完成，已执行 view {model_spec} pad 0.25")
        except Exception as e:
            log(f"聚焦模型失败: {e}\n{traceback.format_exc()}", "ERROR")
            print(f"⚠️ 聚焦模型 {model_spec} 失败: {e}")
    else:
        if focus_model is None:
            log("未提供focus_model，跳过聚焦")
        elif not save_images:
            log("save_images=False，跳过聚焦")

    # ----- 保存会话文件 -----
    if save_session:
        session_file = f"{base_name}_session_{timestamp}.cxs"
        session_path = os.path.join(output_dir, session_file)
        log(f"保存会话文件: {session_path}")
        cxrun(session, f"save {session_path}")
        saved_session = session_path
        print(f"✅ 会话文件已保存: {session_file}")
        log(f"会话文件保存成功")
    else:
        log("save_session=False，跳过会话保存")

    # ----- 保存图片 -----
    if save_images:
        width, height, supersample = 3000, 2000, 3
        log(f"图片保存参数: width={width}, height={height}, supersample={supersample}")
        if not three_views:
            log("单视图模式")
            filename = f"{base_name}_view_{timestamp}.tif"
            filepath = os.path.join(output_dir, filename)
            log(f"保存单视图: {filepath}")
            cxrun(session, f"save {filepath} width {width} height {height} supersample {supersample}")
            saved_images.append(filename)
            print(f"  ✅ 当前视图图片: {filename}")
            log("单视图保存完成")
        else:
            log("三视图模式开始")
            views_order = ['xy_view', 'yz_view', 'xz_view']
            turns = ['', 'turn y 90; turn z 270', 'turn y 90']

            def save_three_views():
                """保存三视图到 output_dir，返回文件路径列表"""
                log("开始保存三视图...")
                paths = []
                for idx, (view_name, turn_cmd) in enumerate(zip(views_order, turns)):
                    log(f"保存视图 {view_name} (步骤 {idx+1}/3)")
                    if turn_cmd:
                        log(f"  执行旋转命令: {turn_cmd}")
                        cxrun(session, turn_cmd)
                    log(f"  设置视图名称: view name {view_name}")
                    cxrun(session, f"view name {view_name}")
                    filename = f"{base_name}_{view_name}_{timestamp}.tif"
                    filepath = os.path.join(output_dir, filename)
                    log(f"  保存图片: {filepath}")
                    cxrun(session, f"save {filepath} width {width} height {height} supersample {supersample}")
                    paths.append(filepath)
                    log(f"  保存完成: {filename}")
                # 恢复原始视角
                log("恢复原始视角")
                cxrun(session, "turn x -90; turn y -90; view xy_view")
                if focus_model is not None:
                    log(f"重新聚焦模型: view {model_spec}")
                    cxrun(session, f"view {model_spec}")
                log("三视图保存流程结束")
                return paths

            # 第一次保存
            log("=== 第一次三视图保存 ===")
            file_paths = save_three_views()
            log("开始检测第一次保存的三视图留白情况")
            margin_results = [has_margin(p) for p in file_paths]
            log(f"留白检测结果: {dict(zip(views_order, margin_results))}")

            if all(margin_results):
                log("所有视图留白足够，保留文件")
                for p in file_paths:
                    saved_images.append(os.path.basename(p))
                    print(f"  ✅ {os.path.basename(p)} (留白足够)")
            else:
                # 存在留白不足的视图
                fail_idx = next(i for i, ok in enumerate(margin_results) if not ok)
                fail_view = views_order[fail_idx]
                log(f"留白不足的视图: {fail_view} (索引 {fail_idx})")
                print(f"⚠️ 视图 {fail_view} 边缘无足够留白，将在此视图上增加 pad 0.25 后重新保存三视图")
                # 删除本次生成的所有图片
                log("删除第一次保存的所有图片")
                for p in file_paths:
                    if os.path.exists(p):
                        os.remove(p)
                        log(f"  删除文件: {p}")
                    else:
                        log(f"  文件不存在，跳过: {p}")
                # 恢复原始视角
                log("恢复原始视角（准备补救）")
                cxrun(session, "turn x -90; turn y -90; view xy_view")
                if focus_model is not None:
                    log(f"重新聚焦模型: view {model_spec}")
                    cxrun(session, f"view {model_spec}")
                # 旋转到失败的视图
                log(f"旋转到失败视图 {fail_view}")
                if fail_view == 'xy_view':
                    log("  fail_view = xy_view，无需旋转")
                    pass
                elif fail_view == 'yz_view':
                    cmd = "turn y 90; turn z 270"
                    log(f"  执行: {cmd}")
                    cxrun(session, cmd)
                elif fail_view == 'xz_view':
                    cmd = "turn y 90"
                    log(f"  执行: {cmd}")
                    cxrun(session, cmd)
                # 在该视图上执行 pad 0.25（相机进一步拉远）
                pad_cmd = f"view {model_spec} pad 0.25"
                log(f"在视图 {fail_view} 上执行 pad: {pad_cmd}")
                cxrun(session, pad_cmd)
                # 重新保存三视图（不再检测，肯定成功）
                log("=== 第二次三视图保存（补救） ===")
                new_paths = save_three_views()
                log("第二次保存完成，直接接受结果")
                for p in new_paths:
                    saved_images.append(os.path.basename(p))
                    print(f"  ✅ {os.path.basename(p)} (重新保存)")
    else:
        log("save_images=False，跳过图片保存")

    if saved_session or saved_images:
        print(f"📁 文件保存至: {output_dir}")
        log(f"最终保存: session={saved_session}, images={saved_images}")
    else:
        print("⚠️ 未选择保存任何内容。")
        log("未保存任何内容")

    log("函数执行完毕")
    return {
        'session': saved_session,
        'images': saved_images
    }



# ========================= 4. 链层次与同源组核心函数 =========================
def compute_chain_hierarchy(session, model):
    """
    基于 interfaces 命令计算链的层次等级 (BFS from core chains)。
    返回: (hierarchy, core_chains, adjacency, interface_areas)
        hierarchy: {chain: level}
        core_chains: list
        adjacency: {chain: set(neighbors)}
        interface_areas: {(c1,c2): area}
    """
    # 获取所有链
    chains = set()
    for atom in model.atoms:
        cid = getattr(atom.residue, 'chain_id', None)
        if cid:
            chains.add(cid.strip())
    chain_ids = sorted(chains)
    if not chain_ids:
        return {}, [], {}, {}

    model_spec = f"#{model.id_string}"
    interfaces_text = ""
    try:
        with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp:
            log_path = tmp.name
        cxrun(session, "log clear")
        cxrun(session, f"interfaces {model_spec}")
        cxrun(session, f"log save {log_path}")
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        os.unlink(log_path)
        for line in content.splitlines():
            if 'buried areas' in line.lower():
                interfaces_text = line
                break
    except Exception as e:
        session.logger.warning(f"捕获 interfaces 输出失败: {e}")

    adjacency = {cid: set() for cid in chain_ids}
    interface_areas = {}
    if interfaces_text:
        if ':' in interfaces_text:
            pairs_text = interfaces_text.split(':', 1)[1].strip()
        else:
            pairs_text = interfaces_text.strip()
        pairs = pairs_text.split(',')
        pattern = re.compile(r'([A-Za-z0-9]+)\s+([A-Za-z0-9]+)\s+(\d+)')
        for pair in pairs:
            pair = pair.strip()
            match = pattern.search(pair)
            if match:
                c1, c2, area = match.group(1), match.group(2), int(match.group(3))
                if c1 in chain_ids and c2 in chain_ids:
                    key = tuple(sorted((c1, c2)))
                    interface_areas[key] = area
                    adjacency[c1].add(c2)
                    adjacency[c2].add(c1)

    # 核心链 (度数最大)
    core_chains = []
    if adjacency:
        max_deg = max(len(neigh) for neigh in adjacency.values())
        core_chains = [c for c, neigh in adjacency.items() if len(neigh) == max_deg]

    # BFS 层次
    hierarchy = {}
    visited = set()
    q = deque()
    for core in core_chains:
        q.append((core, 0))
        visited.add(core)
        hierarchy[core] = 0
    while q:
        curr, lev = q.popleft()
        for nb in adjacency.get(curr, []):
            if nb not in visited:
                visited.add(nb)
                hierarchy[nb] = lev + 1
                q.append((nb, lev + 1))
    max_lev = max(hierarchy.values()) if hierarchy else 0
    for c in chain_ids:
        if c not in hierarchy:
            hierarchy[c] = max_lev + 1

    return hierarchy, core_chains, adjacency, interface_areas


def compute_identity_groups(session, model, cross_model=False, all_models=None):
    """
    识别同源链（序列完全相同的链）。
    参数:
        session: ChimeraX 会话对象
        model: 原子模型 (AtomicStructure)，若 cross_model=True 则忽略该参数
        cross_model: 是否进行跨模型同源识别（默认 False）
        all_models: 当 cross_model=True 时，可指定要分析的模型列表，若为 None 则自动收集所有原子模型
    返回:
        dict: {代表链标识(格式: "#模型ID/链ID"): [成员链标识列表]}
    """
    if not cross_model:
        # 单模型模式
        chains = set()
        for atom in model.atoms:
            cid = getattr(atom.residue, 'chain_id', None)
            if cid:
                chains.add(cid.strip())
        chain_ids = sorted(chains)
        if not chain_ids:
            return {}

        identity_groups = defaultdict(list)
        for chain in chain_ids:
            spec = f"#{model.id_string}/{chain}"
            cxrun(session, f"select //identity==\"{spec}\"")
            info_text = ""
            try:
                with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp:
                    log_path = tmp.name
                cxrun(session, "log clear")
                cxrun(session, "info chains sel")
                cxrun(session, f"log save {log_path}")
                with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                    info_text = f.read()
                os.unlink(log_path)
            except Exception as e:
                session.logger.warning(f"info chains 失败: {e}")
            cxrun(session, "select clear")

            identical = set()
            for line in info_text.splitlines():
                match = re.search(r'chain id\s+(?:#\d+)?/?([A-Za-z0-9]+)\s+chain_id\s+([A-Za-z0-9]+)', line)
                if match:
                    chain_in_line = match.group(1)
                    if chain_in_line in chain_ids:
                        identical.add(chain_in_line)
            if identical:
                rep = min(identical)
                identity_groups[rep].extend(list(identical))

        # 合并重叠组
        final_groups = {}
        assigned = set()
        for rep, members in identity_groups.items():
            if rep not in assigned:
                all_members = set(members)
                for other_rep, other_members in identity_groups.items():
                    if other_rep != rep and not set(other_members).isdisjoint(all_members):
                        all_members.update(other_members)
                        assigned.add(other_rep)
                final_groups[rep] = sorted(all_members)
                assigned.add(rep)
        return final_groups

    else:
        # 跨模型模式：对所有指定的原子模型执行全局同源识别
        if all_models is None:
            all_models = [m for m in session.models.list() if isinstance(m, AtomicStructure)]
        if not all_models:
            return {}
        # 构建全局链标识列表: "#模型ID/链ID"
        global_chain_ids = []
        for mdl in all_models:
            model_id = mdl.id_string
            for atom in mdl.atoms:
                cid = getattr(atom.residue, 'chain_id', None)
                if cid:
                    global_chain_ids.append(f"#{model_id}/{cid.strip()}")
        global_chain_ids = sorted(set(global_chain_ids))
        if not global_chain_ids:
            return {}

        identity_groups = defaultdict(list)
        for full_id in global_chain_ids:
            # full_id 格式如 "#1/A"
            cxrun(session, f"select //identity==\"{full_id}\"")
            info_text = ""
            try:
                with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp:
                    log_path = tmp.name
                cxrun(session, "log clear")
                cxrun(session, "info chains sel")
                cxrun(session, f"log save {log_path}")
                with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                    info_text = f.read()
                os.unlink(log_path)
            except Exception as e:
                session.logger.warning(f"info chains 失败: {e}")
            cxrun(session, "select clear")

            matched = set()
            for line in info_text.splitlines():
                # 匹配 "chain id #1/A chain_id A" 或 "chain id /A chain_id A"
                match = re.search(r'chain id\s+((?:#\d+)?/?[A-Za-z0-9]+)\s+chain_id\s+([A-Za-z0-9]+)', line)
                if match:
                    chain_spec = match.group(1)  # 如 "#1/A" 或 "/A"
                    if chain_spec.startswith('/'):
                        # 对于 "/A" 形式，需要补充模型信息：从当前查询的 full_id 中提取模型
                        # 更安全：在输出行中查找模型编号
                        model_match = re.search(r'#(\d+)/', line)
                        if model_match:
                            mdl_id = model_match.group(1)
                            chain_id = match.group(2)
                            matched.add(f"#{mdl_id}/{chain_id}")
                        else:
                            # 如果无法获取模型，则假设与当前 full_id 相同模型（保守）
                            # 提取当前 full_id 的模型部分
                            cur_model = full_id.split('/')[0]  # "#1"
                            matched.add(f"{cur_model}/{match.group(2)}")
                    else:
                        # 已经包含 #数字/字母
                        matched.add(chain_spec)
            if matched:
                rep = min(matched)  # 代表用最小标识
                identity_groups[rep].extend(list(matched))

        # 合并重叠组
        final_groups = {}
        assigned = set()
        for rep, members in identity_groups.items():
            if rep not in assigned:
                all_members = set(members)
                for other_rep, other_members in identity_groups.items():
                    if other_rep != rep and not set(other_members).isdisjoint(all_members):
                        all_members.update(other_members)
                        assigned.add(other_rep)
                final_groups[rep] = sorted(all_members)
                assigned.add(rep)
        return final_groups


# ========================= 5. 高级分析函数 =========================


def analyze_chain_interfaces(session, save_report=False, save_views=False, output_dir=None, include_residue_details=True):
    """
    分析所有原子模型中的链间界面、接触、氢键、盐桥，并生成报告。

    参数:
        session: ChimeraX 会话对象
        save_report: 是否保存文本报告（默认 False）
        save_views: 是否保存会话和三正交视图（默认 False）
        output_dir: 输出目录，若为 None 则使用脚本所在目录下的 'chain_interface_output'
        include_residue_details: 是否在报告中包含每个互作链对的残基明细（默认 False）
    返回:
        字典，包含报告路径、界面面积、互作统计、互作组合、层级信息等。
    """
    import os
    import re
    import tempfile
    import itertools
    import shutil
    from datetime import datetime
    from collections import defaultdict, deque
    from chimerax.core.commands import run as cxrun
    from chimerax.atomic import AtomicStructure, selected_residues

    log = session.logger
    all_models_data = []

    # 仅当需要保存报告或视图时才确定输出目录并创建
    if save_report or save_views:
        if output_dir is None:
            try:
                script_dir = os.path.dirname(os.path.abspath(__file__))
            except NameError:
                script_dir = os.getcwd()
            output_dir = os.path.join(script_dir, "chain_interface_output")
        if not os.path.isabs(output_dir) or output_dir.startswith('/path'):
            output_dir = os.path.join(os.getcwd(), "chain_interface_output")
        os.makedirs(output_dir, exist_ok=True)
    else:
        output_dir = None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for model in session.models.list():
        if not isinstance(model, AtomicStructure):
            continue

        model_id = model.id_string
        model_name = model.name if model.name else "未命名"

        # 获取链列表
        chains = set()
        for atom in model.atoms:
            chain_id = getattr(atom.residue, 'chain_id', None)
            if chain_id:
                chains.add(chain_id.strip())
        chain_ids = sorted(list(chains))
        if not chain_ids:
            continue

        # ---- 1. 获取界面面积 ----
        interfaces_text = ""
        try:
            with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp:
                log_path = tmp.name
            cxrun(session, "log clear")
            cxrun(session, f"interfaces #{model_id}")
            cxrun(session, f"log save {log_path}")
            with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            os.unlink(log_path)
            for line in content.splitlines():
                if 'buried areas' in line.lower():
                    interfaces_text = line
                    break
        except Exception as e:
            log.warning(f"捕获 interfaces 输出失败: {e}")

        interface_areas = {}
        adjacency = {cid: set() for cid in chain_ids}
        if interfaces_text:
            if ':' in interfaces_text:
                pairs_text = interfaces_text.split(':', 1)[1].strip()
            else:
                pairs_text = interfaces_text.strip()
            pairs = pairs_text.split(',')
            pattern = re.compile(r'([A-Za-z0-9]+)\s+([A-Za-z0-9]+)\s+(\d+)')
            for pair in pairs:
                match = pattern.search(pair.strip())
                if match:
                    c1, c2, area = match.group(1), match.group(2), int(match.group(3))
                    if c1 in chain_ids and c2 in chain_ids:
                        key = tuple(sorted((c1, c2)))
                        interface_areas[key] = area
                        adjacency[c1].add(c2)
                        adjacency[c2].add(c1)

        # ---- 2. 核心链与层次 ----
        core_chains = []
        if adjacency:
            max_degree = max(len(neigh) for neigh in adjacency.values())
            core_chains = [c for c, neigh in adjacency.items() if len(neigh) == max_degree]
        hierarchy = {}
        visited = set()
        queue = deque()
        for core in core_chains:
            queue.append((core, 0))
            visited.add(core)
            hierarchy[core] = 0
        while queue:
            curr, level = queue.popleft()
            for neighbor in adjacency.get(curr, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    hierarchy[neighbor] = level + 1
                    queue.append((neighbor, level + 1))
        max_level = max(hierarchy.values()) if hierarchy else 0
        for c in chain_ids:
            if c not in hierarchy:
                hierarchy[c] = max_level + 1

        # ---- 3. 分析接触、氢键、盐桥 ----
        chain_pairs = list(itertools.combinations(chain_ids, 2))
        pair_stats = []
        temp_dir = tempfile.mkdtemp()

        def count_from_log(filepath):
            if not os.path.exists(filepath):
                return 0
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            m = re.search(r'(\d+)\s+(?:contact|hydrogen bond|salt bridge)', content, re.IGNORECASE)
            if m:
                return int(m.group(1))
            lines = content.split('\n')
            cnt = 0
            for line in lines:
                if re.search(r'/[A-Za-z0-9]+\s+\w+\s+\d+', line) and re.search(r'/\s*[A-Za-z0-9]+', line):
                    cnt += 1
            return cnt

        for c1, c2 in chain_pairs:
            contact_log = os.path.join(temp_dir, f"contact_{c1}_{c2}.log")
            cxrun(session, "log clear")
            cxrun(session, f"contacts /{c1} restrict /{c2} intraMol false log true makePseudobonds false")
            cxrun(session, f"log save {contact_log}")
            contacts = count_from_log(contact_log)

            hbond_log = os.path.join(temp_dir, f"hbond_{c1}_{c2}.txt")
            cxrun(session, f"hbonds /{c1} restrict /{c2} intraMol false reveal false log true saveFile {hbond_log}")
            hbonds = count_from_log(hbond_log)

            salt_log = os.path.join(temp_dir, f"salt_{c1}_{c2}.txt")
            cxrun(session, f"hbonds /{c1} restrict /{c2} intraMol false saltOnly true reveal false log true saveFile {salt_log}")
            salts = count_from_log(salt_log)

            pair_stats.append({
                'pair': f"{c1}-{c2}",
                'contacts': contacts,
                'hbonds': hbonds,
                'salts': salts
            })

        shutil.rmtree(temp_dir, ignore_errors=True)

        # ---- 4. 构建互作图 ----
        interaction_graph = {c: set() for c in chain_ids}
        for (c1, c2), area in interface_areas.items():
            if area > 0:
                interaction_graph[c1].add(c2)
                interaction_graph[c2].add(c1)
        for stat in pair_stats:
            c1, c2 = stat['pair'].split('-')
            if stat['contacts'] > 0 or stat['hbonds'] > 0 or stat['salts'] > 0:
                interaction_graph[c1].add(c2)
                interaction_graph[c2].add(c1)

        # 互作链对（至少有一项非零）
        interacting_pairs = []
        for stat in pair_stats:
            c1, c2 = stat['pair'].split('-')
            if stat['contacts'] > 0 or stat['hbonds'] > 0 or stat['salts'] > 0:
                interacting_pairs.append((c1, c2))

        # 互作三链组（完全连通）
        interacting_triplets = []
        for triplet in itertools.combinations(chain_ids, 3):
            c1, c2, c3 = triplet
            if (c2 in interaction_graph[c1] and c3 in interaction_graph[c1] and
                c3 in interaction_graph[c2]):
                interacting_triplets.append(triplet)

        # 连通分量（每个分量即为一个互作亚基组）
        visited_cluster = set()
        clusters = []
        for c in chain_ids:
            if c not in visited_cluster and any(interaction_graph[c]):
                comp = []
                q = deque([c])
                visited_cluster.add(c)
                while q:
                    cur = q.popleft()
                    comp.append(cur)
                    for nb in interaction_graph[cur]:
                        if nb not in visited_cluster:
                            visited_cluster.add(nb)
                            q.append(nb)
                if len(comp) >= 1:
                    clusters.append(sorted(comp))

        model_data = {
            'model_id': model_id,
            'model_name': model_name,
            'chains': chain_ids,
            'interface_areas': interface_areas,
            'core_chains': core_chains,
            'hierarchy': hierarchy,
            'pair_stats': pair_stats,
            'clusters': clusters,
            'interacting_pairs': interacting_pairs,
            'interacting_triplets': interacting_triplets
        }
        all_models_data.append(model_data)

    # ---- 5. 生成报告 ----
    report_path = None
    if save_report and output_dir is not None:
        report_path = os.path.join(output_dir, f"chain_interface_report_{timestamp}.txt")
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(f"链界面相互作用分析报告\n")
            f.write(f"生成时间: {datetime.now()}\n")
            f.write("=" * 60 + "\n\n")
            for mdata in all_models_data:
                f.write(f"模型 #{mdata['model_id']} ({mdata['model_name']})\n")
                f.write(f"链: {', '.join(mdata['chains'])}\n")
                f.write(f"核心链: {', '.join(mdata['core_chains']) if mdata['core_chains'] else '无'}\n")
                if mdata['hierarchy']:
                    sorted_hier = sorted(mdata['hierarchy'].items(), key=lambda x: x[1])
                    hier_str = ', '.join([f"{c} (level {l})" for c, l in sorted_hier])
                    f.write(f"层次分组: {hier_str}\n")
                else:
                    f.write("层次分组: 无\n")
                f.write("界面面积:\n")
                for (c1, c2), area in sorted(mdata['interface_areas'].items()):
                    f.write(f"  {c1}-{c2}: {area} Å²\n")

                f.write("\n【存在互作的链对统计】\n")
                non_zero_stats = [s for s in mdata['pair_stats'] if s['contacts']>0 or s['hbonds']>0 or s['salts']>0]
                if non_zero_stats:
                    for stat in non_zero_stats:
                        f.write(f"  {stat['pair']}: 接触 {stat['contacts']}, 氢键 {stat['hbonds']}, 盐桥 {stat['salts']}\n")
                else:
                    f.write("  无\n")

                # ========== 输出残基明细（如果请求） ==========
                if include_residue_details:
                    f.write("\n【互作残基明细】\n")
                    # 辅助函数：获取链对之间的互作残基
                    def _get_residues_for_pair(c1, c2):
                        residues = set()
                        for cmd in ['contacts', 'hbonds']:
                            cxrun(session, "select clear")
                            if cmd == 'contacts':
                                cxrun(session, f"contacts /{c1} restrict /{c2} intraMol false select true makePseudobonds false")
                            else:
                                cxrun(session, f"hbonds /{c1} restrict /{c2} select true reveal false dashes 6 log false color black radius .05 namingStyle simple")
                            cxrun(session, "select up")
                            residues.update(selected_residues(session))
                        return residues
                    for stat in non_zero_stats:
                        c1, c2 = stat['pair'].split('-')
                        residues = _get_residues_for_pair(c1, c2)
                        if residues:
                            by_chain = defaultdict(list)
                            for r in residues:
                                aa = r.name.strip()
                                one_letter = aa[0] if aa else 'X'
                                by_chain[r.chain_id].append(f"{one_letter}{r.number}")
                            f.write(f"  链对 {c1}-{c2} (去重共{len(residues)}个):\n")
                            for ch in sorted(by_chain):
                                # 按数字排序
                                def sort_key(x):
                                    num_part = x[1:]
                                    try:
                                        return int(num_part)
                                    except:
                                        return 0
                                res_strs = sorted(by_chain[ch], key=sort_key)
                                f.write(f"      链 {ch}: " + ", ".join(res_strs) + "\n")
                        else:
                            f.write(f"  链对 {c1}-{c2}: 未找到互作残基\n")
                # =============================================

                f.write("\n【互作链对】\n")
                if mdata['interacting_pairs']:
                    for pair in mdata['interacting_pairs']:
                        f.write(f"  {pair[0]}-{pair[1]}\n")
                else:
                    f.write("  无\n")

                f.write("\n【互作三链组】\n")
                if mdata['interacting_triplets']:
                    for tri in mdata['interacting_triplets']:
                        f.write(f"  {tri[0]}-{tri[1]}-{tri[2]}\n")
                else:
                    f.write("  无\n")

                f.write("\n【连通聚类组】\n")
                if mdata['clusters']:
                    for i, grp in enumerate(mdata['clusters'], 1):
                        f.write(f"  组{i}: {', '.join(grp)}\n")
                        for c1, c2 in itertools.combinations(grp, 2):
                            for stat in mdata['pair_stats']:
                                if set(stat['pair'].split('-')) == {c1, c2}:
                                    if stat['contacts']>0 or stat['hbonds']>0 or stat['salts']>0:
                                        f.write(f"      {c1}-{c2}: 接触 {stat['contacts']}, 氢键 {stat['hbonds']}, 盐桥 {stat['salts']}\n")
                                    break
                else:
                    f.write("  无\n")
                f.write("\n" + "-" * 40 + "\n\n")
        log.info(f"报告已保存至: {report_path}")

    # ---- 6. 可选保存视图 ----
    if save_views and output_dir is not None:
        main_model = next((m for m in session.models.list() if isinstance(m, AtomicStructure)), None)
        if main_model:
            try:
                # 注意：如果 save_session_and_views 在同一个模块中，直接调用；否则需导入
                from . import save_session_and_views
                save_session_and_views(
                    session,
                    base_name=f"chain_interface_{timestamp}",
                    save_session=True,
                    save_images=True,
                    three_views=True,
                    focus_model=main_model,
                    output_dir=output_dir
                )
            except Exception as e:
                log.warning(f"保存视图失败: {e}")

    # ---- 7. 返回结果 ----
    if all_models_data:
        primary = all_models_data[0]
        return {
            'report_path': report_path,
            'interfaces': primary['interface_areas'],
            'pair_stats': primary['pair_stats'],
            'clusters': primary['clusters'],
            'interacting_pairs': primary['interacting_pairs'],
            'interacting_triplets': primary['interacting_triplets'],
            'chains': primary['chains'],
            'core_chains': primary['core_chains'],
            'hierarchy': primary['hierarchy']
        }
    else:
        return {
            'report_path': report_path,
            'interfaces': {},
            'pair_stats': [],
            'clusters': [],
            'interacting_pairs': [],
            'interacting_triplets': [],
            'chains': [],
            'core_chains': [],
            'hierarchy': {}
        }



def analyze_chain_oligomeric_state(session, cross_model=True):
    """
    分析每条链的同源聚合状态，并推断整体对称性。
    参数:
        cross_model: 是否进行跨模型同源识别（默认 True）
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = os.path.join(script_dir, f"chain_oligomer_report_{timestamp}.txt")

    all_models = [m for m in session.models.list() if isinstance(m, AtomicStructure)]
    if not all_models:
        session.logger.warning("未找到原子模型")
        return

    # 获取同源组（根据 cross_model 参数调用 compute_identity_groups）
    if cross_model:
        groups = compute_identity_groups(session, None, cross_model=True, all_models=all_models)
        # groups 的键是 "#模型ID/链ID" 格式
        chain_info = {}
        for members in groups.values():
            count = len(members)
            display = ', '.join(members)
            for full_id in members:
                # full_id 如 "#1/A"
                if '/' in full_id:
                    parts = full_id.split('/')
                    mdl_part = parts[0]  # "#1"
                    ch = parts[1]        # "A"
                    mdl = mdl_part.lstrip('#')
                else:
                    mdl = all_models[0].id_string
                    ch = full_id
                chain_info[(mdl, ch)] = {'count': count, 'display': display}
    else:
        # 单模型模式：分别处理每个模型
        chain_info = {}
        for model in all_models:
            groups = compute_identity_groups(session, model, cross_model=False)
            for members in groups.values():
                count = len(members)
                display = ', '.join(members)
                for ch in members:
                    chain_info[(model.id_string, ch)] = {'count': count, 'display': display}
            # 处理可能没有出现在任何同源组中的链（孤立链，count=1）
            all_chains_in_model = set()
            for atom in model.atoms:
                cid = getattr(atom.residue, 'chain_id', None)
                if cid:
                    all_chains_in_model.add(cid.strip())
            for ch in all_chains_in_model:
                if (model.id_string, ch) not in chain_info:
                    chain_info[(model.id_string, ch)] = {'count': 1, 'display': ch}

    # 写入报告
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("链同源聚合状态分析报告\n")
        f.write(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n{'='*60}\n\n")
        current_model = None
        for (mdl, ch), info in sorted(chain_info.items()):
            if mdl != current_model:
                current_model = mdl
                f.write(f"\n模型 #{mdl}:\n{'-'*40}\n")
            count = info['count']
            if count == 1:          oligo = "单体"
            elif count == 2:        oligo = "同源二聚体"
            elif count == 3:        oligo = "同源三聚体"
            elif count == 4:        oligo = "同源四聚体"
            else:                   oligo = f"同源{count}聚体"
            f.write(f"  链 {ch}: {oligo} (共{count}条: {info['display']})\n")

        # 整体对称性推断（按模型）
        f.write("\n" + "="*60 + "\n整体对称性推断（按模型）\n" + "="*60 + "\n")
        for model in all_models:
            model_id = model.id_string
            counts = [info['count'] for (mdl, _), info in chain_info.items() if mdl == model_id]
            if not counts:
                continue
            g = counts[0]
            for c in counts[1:]:
                g = gcd(g, c)
            if g == 1:
                sym = "C1 (拷贝数最大公约数为1，无整体旋转对称性)"
            else:
                sym = f"C{g} (所有链的同源拷贝数均为 {g} 的倍数，具有 C{g} 旋转对称性)"
            f.write(f"模型 #{model_id}: {sym}\n")
        f.write("注：对称阶数取所有链同源拷贝数的最大公约数。例如拷贝数 [2,4,6] -> C2；[3,6,9] -> C3。\n")

    print(f"链聚合状态报告已保存到 {output_path}")
    session.logger.info(f"Oligomer report saved to {output_path}")


def analyze_ligands(session):
    """
    查找所有配体 (polymer_type=0) 并保存报告。
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = os.path.join(script_dir, f"ligand_report_{timestamp}.txt")

    cxrun(session, "select clear")
    ligand_list = []
    for model in session.models.list():
        if not isinstance(model, AtomicStructure):
            continue
        model_id = model.id_string
        cxrun(session, f"select #{model_id} & ::polymer_type=0")
        ligands = selected_residues(session)
        for lig in ligands:
            chain = getattr(lig, 'chain_id', '?')
            num = getattr(lig, 'number', '?')
            name = getattr(lig, 'name', '?')
            ligand_list.append({
                'model': model_id,
                'chain': chain,
                'number': num,
                'name': name
            })
        cxrun(session, "select clear")

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("配体分析报告\n")
        f.write(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n{'='*60}\n\n")
        if not ligand_list:
            f.write("未找到任何配体。\n")
        else:
            f.write(f"共找到 {len(ligand_list)} 个配体：\n{'-'*60}\n")
            f.write(f"{'模型':<6} {'链':<6} {'残基编号':<10} {'残基名':<8}\n{'-'*60}\n")
            for lig in ligand_list:
                f.write(f"#{lig['model']:<5} {lig['chain']:<6} {lig['number']:<10} {lig['name']:<8}\n")
            f.write(f"{'-'*60}\n")
    print(f"配体报告已保存到 {output_path}")
    session.logger.info(f"Ligand report saved to {output_path}")



# ========================= 6. 智能着色相关 =========================

def assign_colors_to_chains(session, model, palette_name='scientific', style='base', color_mode='col_level'):
    """
    根据链层次和同源组计算每个链应分配的颜色（不实际着色）。
    
    参数:
        color_mode: 'row_level' 或 'col_level'
            - row_level: level 决定行（基础色调，共8种），同一行内按顺序取列（变体，共7种）
            - col_level: level 决定列（基础色调，共7种），同一列内按顺序取行（变体，共8种）
        两种模式在预定义变体用完后都会动态调整亮度继续生成相近颜色。
    新增：颜色去重与相似性检测（动态曼哈顿距离阈值），冲突时选择最远颜色。
    """
    from collections import defaultdict

    hierarchy, _, _, _ = compute_chain_hierarchy(session, model)
    groups = compute_identity_groups(session, model, cross_model=False)
    if not groups:
        session.logger.warning("未找到链或同源组，无法分配颜色。")
        return {}, {}

    schemes = generate_all_palette_schemes()
    if palette_name not in schemes or style not in schemes[palette_name]:
        session.logger.warning(f"调色板/样式无效，使用 scientific/base")
        color_matrix = schemes.get('scientific', {}).get('base', [])
    else:
        color_matrix = schemes[palette_name][style]

    if not color_matrix or len(color_matrix) != 8 or len(color_matrix[0]) != 7:
        session.logger.error("颜色矩阵格式错误 (需要 8行 x 7列)")
        return {}, {}

    def hex_to_rgb(hex_color):
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

    def rgb_to_hex(rgb):
        return f'#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}'

    def adjust_brightness(rgb, factor):
        r = min(255, max(0, int(rgb[0] * factor)))
        g = min(255, max(0, int(rgb[1] * factor)))
        b = min(255, max(0, int(rgb[2] * factor)))
        return (r, g, b)

    # 确定每个同源组的 level (取组内最小 level)
    group_levels = {gid: min(hierarchy.get(c, 99) for c in members) for gid, members in groups.items()}
    sorted_groups = sorted(groups.items(), key=lambda kv: group_levels[kv[0]])

    # 记录已使用的RGB颜色（用于相似性检测）
    used_rgb_colors = []

    def is_color_used(rgb):
        """检查RGB颜色是否已使用或过于接近（动态阈值）"""
        # 基础阈值 50，每多10个颜色增加1，最大100
        threshold = min(50 + len(used_rgb_colors) // 10, 100)
        for used_rgb in used_rgb_colors:
            diff = sum(abs(rgb[i] - used_rgb[i]) for i in range(3))
            if diff < threshold:
                return True
        return False

    def find_best_avoidant_color(candidates):
        """从候选颜色列表中找出与已用颜色距离最大（最不同）的颜色"""
        best_rgb = None
        best_dist = -1
        for rgb, hexc in candidates:
            min_dist = min(sum(abs(rgb[i] - used[i]) for i in range(3)) for used in used_rgb_colors)
            if min_dist > best_dist:
                best_dist = min_dist
                best_rgb = rgb
                best_hex = hexc
        return best_rgb, best_hex

    if color_mode == 'row_level':
        # 模式1: level 决定行（基础色调），同一行内按列取变体
        base_rgb_per_row = [hex_to_rgb(color_matrix[row][0]) for row in range(8)]
        predef_limit = 7          # 每行有7个预定义变体（列0~6）
        counter = defaultdict(int)   # row -> 已分配数量
        chain_color_map = {}

        for gid, members in sorted_groups:
            lev = group_levels[gid]
            row = lev % 8
            k = counter[row]
            counter[row] += 1

            # 候选颜色列表（用于冲突时选择最远颜色）
            candidates = []
            for attempt in range(50):  # 最多尝试50次
                if k < predef_limit:
                    col = (k + attempt) % 7
                    color_hex = color_matrix[row][col]
                    rgb = hex_to_rgb(color_hex)
                else:
                    factor = 0.6 + ((k + attempt - predef_limit) % 40) * 0.02
                    rgb = adjust_brightness(base_rgb_per_row[row], factor)
                    color_hex = rgb_to_hex(rgb)
                if not is_color_used(rgb):
                    used_rgb_colors.append(rgb)
                    break
                else:
                    candidates.append((rgb, color_hex))
            else:
                # 所有候选都冲突，选择距离已用颜色最远的
                session.logger.warning(f"同源组 {gid} 所有候选颜色均冲突，选择最远颜色")
                rgb, color_hex = find_best_avoidant_color(candidates)
                used_rgb_colors.append(rgb)

            for ch in members:
                chain_color_map[ch] = color_hex

    else:  # color_mode == 'col_level'
        # 模式2: level 决定列（基础色调），同一列内按行取变体
        base_rgb_per_col = [hex_to_rgb(color_matrix[0][col]) for col in range(7)]
        predef_limit = 8          # 每列有8个预定义变体（行0~7）
        counter = defaultdict(int)   # col -> 已分配数量
        chain_color_map = {}

        for gid, members in sorted_groups:
            lev = group_levels[gid]
            col = lev % 7
            k = counter[col]
            counter[col] += 1

            candidates = []
            for attempt in range(50):
                if k < predef_limit:
                    row = (k + attempt) % 8
                    color_hex = color_matrix[row][col]
                    rgb = hex_to_rgb(color_hex)
                else:
                    factor = 0.6 + ((k + attempt - predef_limit) % 40) * 0.02
                    rgb = adjust_brightness(base_rgb_per_col[col], factor)
                    color_hex = rgb_to_hex(rgb)
                if not is_color_used(rgb):
                    used_rgb_colors.append(rgb)
                    break
                else:
                    candidates.append((rgb, color_hex))
            else:
                session.logger.warning(f"同源组 {gid} 所有候选颜色均冲突，选择最远颜色")
                rgb, color_hex = find_best_avoidant_color(candidates)
                used_rgb_colors.append(rgb)

            for ch in members:
                chain_color_map[ch] = color_hex

    info = {'group_levels': group_levels, 'groups': groups, 'levels': hierarchy}
    return chain_color_map, info


def color_chains_by_hierarchy(session, model, palette_name='scientific', style='base', color_mode='col_level'):
    """
    直接对模型链进行智能着色。
    """
    chain_color_map, _ = assign_colors_to_chains(session, model, palette_name, style, color_mode)
    if not chain_color_map:
        return {}
    for chain, color in chain_color_map.items():
        try:
            cxrun(session, f"color /{chain} {color}")
            cxrun(session, f"hide /{chain} atoms")
            cxrun(session, f"show /{chain} cartoons")
        except Exception as e:
            session.logger.error(f"着色链 {chain} 失败: {e}")
    session.logger.info(f"模型 #{model.id_string} 着色完成，共 {len(chain_color_map)} 条链。")
    return chain_color_map


def color_other_models(session, other_models, palette_name='scientific', style='base'):
    """为其他原子模型整体着色（不区分链）。"""
    schemes = generate_all_palette_schemes()
    if palette_name not in schemes or style not in schemes[palette_name]:
        color_matrix = schemes.get('scientific', {}).get('base', [])
    else:
        color_matrix = schemes[palette_name][style]
    if not color_matrix:
        return
    for i, model in enumerate(other_models):
        row = (i // 7 + 2) % 8
        col = i % 7
        color = color_matrix[row][col]
        try:
            cxrun(session, f"color #{model.id_string} {color}")
            cxrun(session, f"hide #{model.id_string} atoms")
            cxrun(session, f"show #{model.id_string} cartoons")
        except Exception as e:
            session.logger.error(f"着色模型 #{model.id_string} 失败: {e}")


def smart_color_model(session, model, palette_name='scientific', style='base', color_mode='col_level', color_others=False, other_models=None):
    """
    对指定主模型进行智能链着色，并可选择给其他模型整体着色。
    """
    chain_color_map = color_chains_by_hierarchy(session, model, palette_name, style, color_mode)
    if color_others:
        if other_models is None:
            other_models = [m for m in session.models.list() if isinstance(m, AtomicStructure) and m != model]
        if other_models:
            color_other_models(session, other_models, palette_name, style)
    return chain_color_map





# ========================= 8. 体积图与主PDB相关功能 =========================


def classify_models_and_main_pdb(session, main_pdb_id=None, save_stats=False):
    """
    确定主 PDB 模型，优先级如下：
        1. 若指定 main_pdb_id，则使用指定模型。
        2. 若会话中只有一个原子模型，则自动选为 main。
        3. 若存在多个原子模型且存在 Volume 图，则计算每个原子模型与所有 Volume 的平均相关性，
           选择相关性最高的作为 main。
        4. 若不存在 Volume 图，则默认选择第一个原子模型作为 main。

    参数：
        session: ChimeraX 会话对象
        main_pdb_id: 可选，指定主 PDB 的模型 ID（如 "#1" 或 "1"）
        save_stats: 是否保存模型统计文件（默认 False）

    返回：
        dict: {
            'atom_models': list of AtomicStructure objects,
            'regular_volumes': list of Volume objects,
            'locres_volumes': list of Volume objects,
            'all_volumes': list of all Volume objects,
            'main_pdb_model': AtomicStructure or None,
            'stats': dict (inspect_models 返回的统计信息，若无统计则为空)
        }
    """
    log = session.logger
    log.info("=" * 60)
    log.info("开始确定主 PDB 模型")
    log.info("=" * 60)

    # 调用 inspect_models 进行统计（传递 save_stats 控制是否保存文件）
    try:
        stats = inspect_models(session, tag="模型分类", save_file=save_stats)
    except NameError:
        stats = {}

    # 收集模型对象
    atom_models = []
    regular_volumes = []
    locres_volumes = []
    all_volumes = []

    for model in session.models.list():
        if isinstance(model, AtomicStructure):
            atom_models.append(model)
        elif hasattr(model, '__class__') and model.__class__.__name__ == "Volume":
            all_volumes.append(model)
            name = (model.name or "").lower()
            path = getattr(model, "path", "").lower()
            if "locres" in name or "locres" in path:
                locres_volumes.append(model)
            else:
                regular_volumes.append(model)

    log.info(f"发现原子模型: {[f'#{m.id_string}' for m in atom_models]}")
    log.info(f"发现 Volume 模型: {[f'#{v.id_string}' for v in all_volumes]}")
    log.info(f"其中 Local Resolution 图: {[f'#{v.id_string}' for v in locres_volumes]}")

    main_model = None

    # 1. 用户指定
    if main_pdb_id is not None:
        target_id = main_pdb_id.lstrip('#')
        for m in atom_models:
            if m.id_string == target_id:
                main_model = m
                log.info(f"根据用户指定，主 PDB 设为 #{m.id_string} ({m.name})")
                break
        if main_model is None:
            log.warning(f"未找到指定 ID {main_pdb_id} 的原子模型，进入自动选择流程。")
            main_pdb_id = None

    # 2. 唯一原子模型
    if main_model is None and len(atom_models) == 1:
        main_model = atom_models[0]
        log.info(f"仅有唯一原子模型，自动设为主 PDB: #{main_model.id_string} ({main_model.name})")

    # 3. 多原子模型且存在 Volume 图 -> 基于相关性选择
    if main_model is None and len(atom_models) > 1 and all_volumes:
        log.info("存在多个原子模型和 Volume 图，开始基于相关性确定主 PDB...")
        resolution = 3.0
        scores = {}
        temp_maps = []

        for atom in atom_models:
            atom_id = atom.id_string
            log.info(f"  处理原子模型 #{atom_id} ({atom.name})")
            try:
                cxrun(session, f"molmap #{atom_id} {resolution}", log=StringIO())
                new_vol = None
                for m in session.models.list():
                    if (hasattr(m, '__class__') and m.__class__.__name__ == "Volume"
                            and m not in all_volumes and m not in temp_maps):
                        new_vol = m
                        temp_maps.append(m)
                        break
                if not new_vol:
                    log.warning(f"    未能捕获临时地图，跳过此模型。")
                    scores[atom_id] = -999
                    continue
                log.info(f"    生成临时地图 #{new_vol.id_string}")
            except Exception as e:
                log.error(f"    生成 molmap 失败: {e}")
                scores[atom_id] = -999
                continue

            total_corr = 0.0
            valid_count = 0
            for vol in all_volumes:
                try:
                    with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp:
                        log_path = tmp.name
                    cxrun(session, "log clear")
                    cxrun(session, f"measure correlation #{new_vol.id_string} inMap #{vol.id_string}")
                    cxrun(session, f"log save {log_path}")
                    with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                        full_text = f.read()
                    os.unlink(log_path)

                    match = re.search(r'correlation\s*=\s*([-+]?\d*\.?\d+)', full_text)
                    if match:
                        corr = float(match.group(1))
                    else:
                        nums = re.findall(r'[-+]?\d*\.?\d+', full_text)
                        corr = float(nums[0]) if nums else 0.0
                    log.info(f"      与 #{vol.id_string} 相关性: {corr:.4f}")
                    total_corr += corr
                    valid_count += 1
                except Exception as e:
                    log.warning(f"      与 #{vol.id_string} 测量失败: {e}")

            if valid_count > 0:
                avg = total_corr / valid_count
                scores[atom_id] = avg
                log.info(f"    平均相关性: {avg:.4f}")
            else:
                scores[atom_id] = -999
                log.warning(f"    无有效相关性测量")

        # 清理临时地图
        log.info("清理临时体积图...")
        for vol in temp_maps:
            try:
                cxrun(session, f"close #{vol.id_string}")
            except:
                pass

        if scores:
            best_id = max(scores, key=lambda k: scores[k])
            best_score = scores[best_id]
            log.info(f"最高平均相关性模型: #{best_id} (得分 {best_score:.4f})")
            for m in atom_models:
                if m.id_string == best_id:
                    main_model = m
                    break
        if main_model is None:
            log.warning("相关性选择失败，将采用默认第一个原子模型。")
            main_model = atom_models[0]

    # 4. 无 Volume 图，默认第一个
    if main_model is None and atom_models:
        main_model = atom_models[0]
        log.info(f"无 Volume 图，默认选择第一个原子模型作为主 PDB: #{main_model.id_string} ({main_model.name})")

    log.info("=" * 60)
    log.info(f"最终主 PDB 确定为: #{main_model.id_string} ({main_model.name})" if main_model else "未找到任何原子模型")
    log.info("=" * 60)

    return {
        'atom_models': atom_models,
        'regular_volumes': regular_volumes,
        'locres_volumes': locres_volumes,
        'all_volumes': all_volumes,
        'main_pdb_model': main_model,
        'stats': stats
    }


def recommend_volume_threshold(session, volume_model, atom_subset=None, num_layers=6):
    """
    动态推荐普通 Volume 的显示阈值，可基于全部原子或指定原子子集（如配体）计算。

    参数：
        session: ChimeraX 会话对象
        volume_model: 目标 Volume 模型
        atom_subset: 可选，用于计算密度的原子列表。若为 None，则自动使用第一个原子模型的全部原子。
        num_layers: 径向分层数（默认6）
    返回：
        推荐阈值（浮点数）或 None
    """
    log = session.logger
    log.info(f"正在为 Volume #{volume_model.id_string} 计算推荐阈值...")

    if atom_subset is None:
        atoms = None
        for m in session.models.list():
            if isinstance(m, AtomicStructure):
                atoms = m.atoms
                break
        if atoms is None:
            log.warning("未找到原子模型，无法计算阈值。")
            return None
    else:
        atoms = list(atom_subset)

    if len(atoms) == 0:
        log.warning("原子集合为空，无法计算阈值。")
        return None

    coords = np.array([a.scene_coord for a in atoms])
    center = np.mean(coords, axis=0)
    distances = np.sqrt(np.sum((coords - center)**2, axis=1))
    min_d, max_d = np.min(distances), np.max(distances)
    if max_d - min_d < 5.0:
        max_d = min_d + 5.0
    bounds = np.linspace(min_d, max_d, num_layers+1)

    log.info(f"  原子数: {len(atoms)}, 距离范围: {min_d:.2f} - {max_d:.2f} Å")

    try:
        values = np.array(volume_model.interpolated_values(coords))
    except:
        values = np.array([volume_model.interpolated_values(pt.reshape(1,3))[0] for pt in coords])

    valid = ~np.isnan(values)
    valid_vals = values[valid]
    valid_dist = distances[valid]

    if len(valid_vals) == 0:
        log.warning("无有效密度值，无法计算阈值。")
        return None

    layer_means = []
    for i in range(num_layers):
        mask = (valid_dist >= bounds[i]) & (valid_dist <= bounds[i+1])
        layer_vals = valid_vals[mask]
        if len(layer_vals) > 0:
            mean_val = float(np.mean(layer_vals))
            layer_means.append(mean_val)
            log.info(f"  层{i+1} ({bounds[i]:.1f}-{bounds[i+1]:.1f} Å): 平均密度 {mean_val:.4f}")
        else:
            layer_means.append(0.0)
            log.info(f"  层{i+1} ({bounds[i]:.1f}-{bounds[i+1]:.1f} Å): 无有效原子")

    if len(layer_means) < 6:
        log.warning("有效层数不足6层，使用简单平均。")
        return float(np.mean(valid_vals))

    gaps = [abs(layer_means[i+1] - layer_means[i]) for i in range(5)]
    avg_first4 = sum(gaps[:4]) / 4.0 if gaps[:4] else 0.0
    gap5 = gaps[4]

    if gap5 > 2.0 * avg_first4:
        threshold = layer_means[4]
        log.info(f"  第5间隔 ({gap5:.4f}) 显著大于前4间隔平均 ({avg_first4:.4f})，采用次外层密度作为阈值。")
    else:
        threshold = (layer_means[4] + layer_means[5]) / 2
        log.info(f"  密度下降平缓，采用最外层密度作为阈值。")

    log.info(f"  推荐阈值 = {threshold:.4f}")
    return threshold


def recommend_locres_range(session, locres_volume, atom_subset=None, num_layers=6):
    """
    动态生成 LocalRes 图的5个着色值，可基于全部原子或指定原子子集计算。
    """
    log = session.logger
    log.info(f"正在为 LocalRes Volume #{locres_volume.id_string} 计算推荐着色值...")

    if atom_subset is None:
        atoms = None
        for m in session.models.list():
            if isinstance(m, AtomicStructure):
                atoms = m.atoms
                break
        if atoms is None:
            log.warning("未找到原子模型，无法计算。")
            return None
    else:
        atoms = list(atom_subset)

    if len(atoms) == 0:
        log.warning("原子集合为空，无法计算。")
        return None

    coords = np.array([a.scene_coord for a in atoms])
    center = np.mean(coords, axis=0)
    distances = np.sqrt(np.sum((coords - center)**2, axis=1))
    min_d, max_d = np.min(distances), np.max(distances)
    if max_d - min_d < 5.0:
        max_d = min_d + 5.0
    bounds = np.linspace(min_d, max_d, num_layers+1)

    log.info(f"  原子数: {len(atoms)}, 距离范围: {min_d:.2f} - {max_d:.2f} Å")

    try:
        values = np.array(locres_volume.interpolated_values(coords))
    except:
        values = np.array([locres_volume.interpolated_values(pt.reshape(1,3))[0] for pt in coords])

    valid = ~np.isnan(values)
    valid_vals = values[valid]
    valid_dist = distances[valid]

    if len(valid_vals) == 0:
        log.warning("无有效分辨率值，无法计算。")
        return None

    layer_means = []
    for i in range(num_layers):
        mask = (valid_dist >= bounds[i]) & (valid_dist <= bounds[i+1])
        layer_vals = valid_vals[mask]
        if len(layer_vals) > 0:
            mean_val = float(np.mean(layer_vals))
            layer_means.append(mean_val)
            log.info(f"  层{i+1} ({bounds[i]:.1f}-{bounds[i+1]:.1f} Å): 平均分辨率 {mean_val:.2f} Å")
        else:
            layer_means.append(0.0)

    if len(layer_means) < 6:
        log.warning("有效层数不足6层，无法生成着色值。")
        return None

    gaps = [layer_means[i+1] - layer_means[i] for i in range(5)]
    log.info(f"  相邻层间隔: {[round(g, 3) for g in gaps]}")

    avg_first4 = sum(gaps[:4]) / 4.0 if gaps[:4] else 0.0
    gap5 = gaps[4]

    if gap5 > 2.0 * avg_first4:
        base_interval = avg_first4
        log.info(f"  第5间隔 ({gap5:.3f}) 显著大于前4间隔平均 ({avg_first4:.3f})，采用前4间隔平均值。")
    else:
        base_interval = sum(gaps) / 5.0
        log.info(f"  采用所有5个间隔的平均值 ({base_interval:.3f})。")

    import math
    interval = math.ceil(base_interval * 10) / 10.0
    log.info(f"  基础间隔向上取整到0.1后为: {interval:.1f}")

    start_val = round(layer_means[0], 1)
    values_5 = [start_val]
    for i in range(1, 5):
        next_val = round(start_val + i * interval, 1)
        values_5.append(next_val)

    if not all(values_5[i] <= values_5[i+1] for i in range(len(values_5)-1)):
        values_5.sort()

    log.info(f"  生成的5个着色值: {values_5}")
    return values_5


def align_other_pdbs_to_main(session, main_pdb_model):
    """将会话中其他所有原子模型对齐到主 PDB 模型"""
    for model in session.models.list():
        if isinstance(model, AtomicStructure) and model != main_pdb_model:
            session.logger.info(f"正在对齐 #{model.id_string} 到 #{main_pdb_model.id_string} ...")
            cxrun(session, f"matchmaker #{model.id_string} to #{main_pdb_model.id_string}")
    session.logger.info("所有其他原子模型对齐完成。")


# ========================= 9. 脚本入口（演示） =========================
if __name__ == "__main__":
    try:
        # 演示：运行三个常用分析（注意 session 必须在 ChimeraX 环境中）
        analyze_chain_oligomeric_state(session, cross_model=True)
        analyze_ligands(session)
        # analyze_chain_interfaces(session)  # 默认生成报告，不保存视图
    except NameError:
        print("session 对象未定义，请在 ChimeraX 环境中运行该脚本。")