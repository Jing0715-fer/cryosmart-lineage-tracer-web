# -*- coding: utf-8 -*-
"""
analyze_volume_layers.py
分阶段体积图分析脚本（灵活保存控制）
依赖：ini.py（包含 classify_models_and_main_pdb, recommend_volume_threshold,
      recommend_locres_range, color_chains_by_hierarchy, color_other_models 等）
"""

import os
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

try:
    import ini
except ImportError as e:
    print(f"错误：缺少 ini.py 模块 - {e}")
    sys.exit(1)

from chimerax.core.commands import run as cxrun
from chimerax.atomic import AtomicStructure


def color_main_map_by_locres(session, main_map, locres_map, threshold_values, custom_colors=None):
    """使用 LocalRes 图的值对主密度图进行着色"""
    if not threshold_values or len(threshold_values) != 5:
        session.logger.warning("阈值列表必须包含恰好 5 个值，跳过着色。")
        return

    if custom_colors is None or len(custom_colors) != 5:
        custom_colors = ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000']

    pairs = [f"{threshold_values[i]},{custom_colors[i]}" for i in range(5)]
    mapping_str = ':'.join(pairs)

    cmd = f"color sample #{main_map.id_string} map #{locres_map.id_string} palette {mapping_str} "
    thresholds_str = ' :'.join(str(v) for v in threshold_values)
    cmd_key = f"key rainbow :{thresholds_str} showTool true"

    try:
        cxrun(session, cmd)
        session.logger.info(f"主密度图 #{main_map.id_string} 已按照 LocalRes 图 #{locres_map.id_string} 着色。")
        cxrun(session, cmd_key)
        session.logger.info("已添加颜色条（key）。")
        cxrun(session, f"key fontSize 18")
        cxrun(session, f"key font \"Times New Roman\"")
        cxrun(session, f"key pos 0.842613,0.454672 size 0.0334953,0.313488")
    except Exception as e:
        session.logger.error(f"着色失败: {e}")


def set_display_state(session, show_atoms=False, show_volumes=None):
    """设置显示状态：原子模型、体积图等"""
    all_models = list(session.models.list())
    atoms = [m for m in all_models if isinstance(m, AtomicStructure)]
    volumes = [m for m in all_models if hasattr(m, '__class__') and m.__class__.__name__ == "Volume"]

    for m in atoms:
        try:
            if show_atoms:
                cxrun(session, f"show #{m.id_string} models")
            else:
                cxrun(session, f"hide #{m.id_string} models")
        except Exception as e:
            session.logger.warning(f"切换原子模型 #{m.id_string} 显示状态失败: {e}")

    if show_volumes is not None:
        show_ids = {v.id_string for v in show_volumes}
        for v in volumes:
            try:
                if v.id_string in show_ids:
                    cxrun(session, f"show #{v.id_string} models")
                else:
                    cxrun(session, f"hide #{v.id_string} models")
            except Exception as e:
                session.logger.warning(f"切换 Volume #{v.id_string} 显示状态失败: {e}")

    # 隐藏其他非必要类型
    other_types = ['Surface', 'Pseudobonds']
    for m in all_models:
        cls_name = getattr(m, '__class__', None)
        if cls_name and cls_name.__name__ in other_types:
            try:
                cxrun(session, f"hide #{m.id_string} models")
            except:
                pass


def save_state(session, base_name, output_dir, stage_name,
               save_session=True, save_images=False, three_views=False):
    """保存当前状态（会话和/或图片）"""
    stage_base = f"{base_name}_{stage_name}"
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if save_session:
        session_file = f"{stage_base}_session_{timestamp}.cxs"
        session_path = os.path.join(output_dir, session_file)
        try:
            cxrun(session, f"save {session_path}")
            session.logger.info(f"[阶段 {stage_name}] 会话已保存: {session_path}")
        except Exception as e:
            session.logger.error(f"保存会话失败: {e}")

    if save_images:
        width, height, supersample = 2500, 1500, 3
        if three_views:
            views = ['xy_view', 'yz_view', 'xz_view']
            turns = ['', 'turn y 90; turn z 270', 'turn y 90']
            for view_name, turn_cmd in zip(views, turns):
                if turn_cmd:
                    cxrun(session, turn_cmd)
                cxrun(session, f"view name {view_name}")
                filename = f"{stage_base}_{view_name}_{timestamp}.tif"
                filepath = os.path.join(output_dir, filename)
                try:
                    cxrun(session, f"save {filepath} width {width} height {height} supersample {supersample}")
                    session.logger.info(f"[阶段 {stage_name}] 视图 {view_name} 已保存: {filepath}")
                except Exception as e:
                    session.logger.error(f"保存视图 {view_name} 失败: {e}")
            cxrun(session, "turn x -90; turn y -90; view xy_view")
        else:
            filename = f"{stage_base}_current_view_{timestamp}.tif"
            filepath = os.path.join(output_dir, filename)
            try:
                cxrun(session, f"save {filepath} width {width} height {height} supersample {supersample}")
                session.logger.info(f"[阶段 {stage_name}] 当前视图已保存: {filepath}")
            except Exception as e:
                session.logger.error(f"保存当前视图失败: {e}")


def analyze_and_apply(session, main_pdb_id=None,
                      output_dir=None, base_name="volume_analysis",
                      save_session=True, save_images=False, three_views=False,
                      use_smart_coloring=True,
                      apply_chain_coloring=True, chain_coloring_mode='default',
                      chain_palette='scientific', chain_style='base', chain_color_mode='col_level'):
    """
    新增参数：
        apply_chain_coloring    : 是否对主PDB进行链着色（默认True）
        chain_coloring_mode     : 'default' 或 'custom'
            - 'default': 使用 ini 中 color_chains_by_hierarchy 的默认参数（即跟随 ini 内部默认值）
            - 'custom' : 使用下面 chain_palette, chain_style, chain_color_mode 自定义参数着色
        chain_palette, chain_style, chain_color_mode : 自定义着色参数（仅当 mode='custom' 时生效）
    """
    log = session.logger
    log.info("=" * 70)
    log.info("开始分阶段体积图分析流程")
    log.info("=" * 70)

    # 获取模型信息（使用 ini 函数）
    info = ini.classify_models_and_main_pdb(session, main_pdb_id=main_pdb_id)
    main_pdb = info['main_pdb_model']
    if not main_pdb:
        log.error("未找到主 PDB，流程终止。")
        return

    regular_volumes = info['regular_volumes']
    locres_volumes = info['locres_volumes']
    atom_models = info['atom_models']
    other_models = [m for m in atom_models if m != main_pdb]

    log.info(f"主 PDB: #{main_pdb.id_string} ({main_pdb.name})")
    log.info(f"普通 Volume: {[f'#{v.id_string}' for v in regular_volumes]}")
    log.info(f"LocalRes Volume: {[f'#{v.id_string}' for v in locres_volumes]}")

    if output_dir is None:
        output_dir = os.path.join(SCRIPT_DIR, "volume_analysis_output")
    os.makedirs(output_dir, exist_ok=True)

    cxrun(session, "set bgColor white")
    cxrun(session, f"view #{main_pdb.id_string} pad 0.5")

    # 阶段1：PDB 智能着色（支持模式选择）
    log.info(f"阶段 1：应用{'智能' if use_smart_coloring else '简单'}着色 PDB")
    if use_smart_coloring:
        if apply_chain_coloring:
            if chain_coloring_mode == 'default':
                log.info("  着色模式: 跟随 ini 默认参数")
                ini.color_chains_by_hierarchy(session, main_pdb)
                if other_models:
                    ini.color_other_models(session, other_models)
            else:  # custom
                log.info(f"  着色模式: 自定义参数 (palette={chain_palette}, style={chain_style}, color_mode={chain_color_mode})")
                ini.color_chains_by_hierarchy(session, main_pdb,
                                              palette_name=chain_palette,
                                              style=chain_style,
                                              color_mode=chain_color_mode)
                if other_models:
                    ini.color_other_models(session, other_models,
                                           palette_name=chain_palette,
                                           style=chain_style)
        else:
            log.info("跳过了链着色（apply_chain_coloring=False）。")
    else:
        cxrun(session, f"rainbow #{main_pdb.id_string}")
        for m in other_models:
            cxrun(session, f"rainbow #{m.id_string}")

    set_display_state(session, show_atoms=True, show_volumes=[])
    cxrun(session, "select ligand")
    cxrun(session, "show sel atoms")
    cxrun(session, "color sel byhetero target a")
    cxrun(session, "style sel ball")
    cxrun(session, "select clear")
    save_state(session, base_name, output_dir, "1_pdb_colored",
               save_session, save_images, three_views)

    if not regular_volumes:
        log.warning("未找到普通 Volume，跳过阶段 2 和 3。")
        set_display_state(session, show_atoms=True, show_volumes=[])
        return

    main_map = regular_volumes[0]

    # 阶段2：主密度图灰色表面
    log.info("阶段 2：显示主密度图（灰色表面）")
    set_display_state(session, show_atoms=False, show_volumes=[main_map])
    thr = ini.recommend_volume_threshold(session, main_map, atom_subset=main_pdb.atoms)
    if thr is not None:
        log.info(f"推荐显示阈值: {thr:.4f}")
        cxrun(session, f"volume #{main_map.id_string} level {thr:.4f} step 1 style surface")
        cxrun(session, f"color #{main_map.id_string} light gray")
        cxrun(session, f"surface dust #{main_map.id_string} size 20")
    else:
        log.warning("未能计算推荐阈值，使用默认显示。")
        cxrun(session, f"volume #{main_map.id_string} style surface color light gray")
    save_state(session, base_name, output_dir, "2_volume_gray",
               save_session, save_images, three_views)

    # 阶段3：LocalRes 彩色着色
    log.info("阶段 3：使用 LocalRes 值彩色着色主密度图")
    if not locres_volumes:
        log.warning("未找到 LocalRes Volume，跳过阶段 3。")
    else:
        locres_map = locres_volumes[0]
        log.info(f"LocalRes 图: #{locres_map.id_string}")
        set_display_state(session, show_atoms=False, show_volumes=[main_map])
        values = ini.recommend_locres_range(session, locres_map, atom_subset=main_pdb.atoms)
        if values and len(values) == 5:
            log.info(f"推荐着色阈值: {values}")
            color_main_map_by_locres(session, main_map, locres_map, values)
        else:
            log.warning("未能计算 LocalRes 着色阈值，跳过彩色着色。")
        save_state(session, base_name, output_dir, "3_volume_colored",
                   save_session, save_images, three_views)

    set_display_state(session, show_atoms=True, show_volumes=[])
    log.info("=" * 70)
    log.info("分阶段体积图分析流程完成")
    log.info("=" * 70)



try:
    # 默认行为：着色，跟随 ini 默认参数（与原始行为一致）
    analyze_and_apply(
        session,
        main_pdb_id=None,
        output_dir=None,
        base_name="volume_analysis",
        save_session=True,
        save_images=True,
        three_views=True,
        use_smart_coloring=True,
        apply_chain_coloring=True,
        chain_coloring_mode='default'
    )

    # 可选：使用自定义参数着色（取消注释下面代码，并注释上面的调用）
    # analyze_and_apply(
    #     session,
    #     main_pdb_id=None,
    #     output_dir=None,
    #     base_name="volume_analysis",
    #     save_session=True,
    #     save_images=True,
    #     three_views=True,
    #     use_smart_coloring=True,
    #     apply_chain_coloring=True,
    #     chain_coloring_mode='custom',
    #     chain_palette='elegant',
    #     chain_style='base',
    #     chain_color_mode='col_level'
    # )

    # 可选：不着色，仅执行体积图阶段
    # analyze_and_apply(
    #     session,
    #     apply_chain_coloring=False
    # )
except NameError:
    print("请在 ChimeraX 环境中运行此脚本。")
except Exception as e:
    print(f"脚本运行出错: {e}")