from chimerax.core.commands import run

# 获取当前所有 volume 模型
volumes = [m for m in session.models.list() if m.__class__.__name__ == "Volume"]

if len(volumes) != 2:
    print("请确保只打开两个 volume 文件：EM map 和 locres map")
else:
    vol1, vol2 = volumes

    # 根据文件名判断 locres map - 现在包含 "locres" 即可
    if "locres" in vol1.name.lower() or "locres" in vol1.path.lower():
        locres = vol1
        em_map = vol2
    elif "locres" in vol2.name.lower() or "locres" in vol2.path.lower():
        locres = vol2
        em_map = vol1
    else:
        print("未检测到包含 'locres' 的文件名，将默认使用数据范围判断")
        # 默认按数据范围判断
        if vol1.data.full_matrix().max() < vol2.data.full_matrix().max():
            locres = vol1
            em_map = vol2
        else:
            locres = vol2
            em_map = vol1

    # 自动设置 EM map 的显示 level（最大值的15%）
    level = em_map.data.full_matrix().max() * 0.15
    run(session, f"volume #{em_map.id_string} level {level}")

    # 设置背景为白色
    run(session, "set bgColor white")

    # 设置 volume step
    run(session, f"volume #{em_map.id_string} step 1")

    # 添加 surface dust
    run(session, f"surface dust #{em_map.id_string} size 8.08")

    # 用 locres map 给 EM map 着色
    run(session, f"color electrostatic #{em_map.id_string} map #{locres.id_string} palette rainbow key true range full")

    # 隐藏 locres map 本身
    run(session, f"hide #{locres.id_string}")

    # 显示 Color Key 工具
    run(session, 'ui tool show "Color Key"')

    # 设置鼠标右键为调节 color key
    run(session, 'ui mousemode right "color key"')
    run(session, 'key pos 0.854619,0.13133 size 0.00908632,0.714163')

    print(f"自动识别完成：EM map #{em_map.id_string}, locres map #{locres.id_string}")