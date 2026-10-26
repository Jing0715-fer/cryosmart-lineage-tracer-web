# -*- coding: utf-8 -*-
"""
CryoSmart Flow Bridge (in-ChimeraX CORS relay)

用法（只需一次）：
  在 ChimeraX 的 Command Line 里运行（把 <APP-ORIGIN> 换成网页应用地址）：
      open <APP-ORIGIN>/api/cryosmart/flow-figure/relay.py

  （推荐直接在网页的 "Workflow Figure" 卡片里复制这条命令——那里已经
   把真实 origin 拼好了。）

作用：
  在本机 127.0.0.1 上启动一个微型 HTTP 桥（默认端口 8927，冲突时自动
  尝试 8928/8929），之后 CryoSmart Lineage Tracer Web 页面即可直接
  驱动 ChimeraX 完成：地图打开 → 5 候选对齐（含 z 翻转手性检查）→
  90° 视角评分 → 高清截图回传 → 网页端组装 16:9 流程图 PPTX。

  内部机制与 ChimeraX 官方 MCP bridge / remotecontrol REST server 相同
  （session.ui.thread_safe 派发 + 日志捕获），但 CORS 仅放行本网页
  （Origin 校验，浏览器不可伪造），并且额外提供：
      GET  /ping        桥状态（工作目录、ChimeraX 版本）
      POST /exec        运行 ChimeraX 命令，返回文本输出与错误
      GET  /file?name=  取回 /ping 工作目录里 ChimeraX 保存的 PNG
      GET  /volstats?id= 体数据统计（max/mean/sd，用于统一等值面水平）
      GET  /nextid      下一个空闲 model id（volume flip 需要）

运行环境：ChimeraX 1.12+（GUI）。保持 ChimeraX 打开即可；关闭 ChimeraX
时桥随之消失，下次重新 open 一次。
"""

import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from queue import Queue

# The web app bakes its own origin in here when serving this file via
# /api/cryosmart/flow-figure/relay.py — only that origin may talk to the bridge.
ALLOWED_ORIGINS = ["__APP_ORIGIN__"]

PORT_PREFERENCE = [8927, 8928, 8929]


def _num_list(text):
    out = []
    for part in str(text).replace(",", " ").replace(";", " ").split():
        try:
            out.append(float(part))
        except ValueError:
            pass
    return out


def main(session):
    workdir = tempfile.mkdtemp(prefix="cryoflow_")
    state = {"session": session, "workdir": workdir}

    try:
        from chimerax import buildinfo
        version = buildinfo.version
    except Exception:
        version = "unknown"

    def ui_run(fn):
        """Run fn on the ChimeraX UI thread (mirrors rest_server.RESTHandler)."""
        ui = getattr(session, "ui", None)
        thread_safe = getattr(ui, "thread_safe", None)
        if callable(thread_safe):
            q = Queue()
            def wrapped():
                try:
                    q.put(("ok", fn()))
                except Exception as exc:  # noqa: BLE001 - relay must survive
                    q.put(("err", "%s: %s" % (type(exc).__name__, exc)))
            thread_safe(wrapped)
            status, value = q.get()
            if status != "ok":
                raise value
            return value
        return fn()

    def run_command(command):
        """Execute a ChimeraX command, capturing its log text (RESTHandler pattern)."""
        def f():
            from chimerax.core.logger import StringPlainTextLog
            from chimerax.core.commands import run
            err = None
            with StringPlainTextLog(session.logger) as log:
                try:
                    run(session, command, log=False)
                except Exception as exc:  # noqa: BLE001 - surfaced as error
                    err = "%s: %s" % (type(exc).__name__, exc)
            return log.getvalue(), err
        return ui_run(f)

    def vol_stats(model_id):
        def f():
            import numpy as np
            target = None
            for m in session.models.list():
                if str(getattr(m, "id_string", "")) == str(model_id):
                    target = m
                    break
            if target is None:
                raise RuntimeError("model #%s not found" % model_id)
            mat = np.asarray(target.data.full_matrix(), dtype=np.float64)
            return {
                "max": float(mat.max()),
                "mean": float(mat.mean()),
                "sd": float(mat.std()),
                "min": float(mat.min()),
            }
        return ui_run(f)

    def next_model_id():
        def f():
            ids = [m.id[0] for m in session.models.list() if getattr(m, "id", None)]
            return (max(ids) + 1) if ids else 1
        return ui_run(f)

    class Handler(BaseHTTPRequestHandler):
        server_version = "CryoSmartFlowBridge/1.0"

        # ---------- plumbing ----------
        def _origin_ok(self):
            origin = self.headers.get("Origin", "")
            if origin not in ALLOWED_ORIGINS:
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return False
            return True

        def _cors_headers(self):
            origin = self.headers.get("Origin", "")
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "86400")

        def _reply(self, code, payload, ctype="application/json"):
            body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
            self.send_response(code)
            if self._origin_ok_head():
                self._cors_headers()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _origin_ok_head(self):
            # _reply needs CORS headers even when the origin check already
            # happened in the route handler; re-check without writing a 403.
            return self.headers.get("Origin", "") in ALLOWED_ORIGINS

        def do_OPTIONS(self):
            if not self._origin_ok():
                return
            self.send_response(204)
            self._cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_request(self, code="-", size="-"):
            pass

        # ---------- routes ----------
        def do_GET(self):
            if not self._origin_ok():
                return
            from urllib.parse import urlparse, parse_qs
            r = urlparse(self.path)
            q = parse_qs(r.query)
            try:
                if r.path == "/ping":
                    self._reply(200, {
                        "ok": True,
                        "workdir": workdir,
                        "version": version,
                        "volumes": sum(1 for m in ui_run(lambda: list(session.models.list()))
                                       if m.__class__.__name__ == "Volume"),
                    })
                    return
                if r.path == "/file":
                    name = os.path.basename((q.get("name") or [""])[0])
                    path = os.path.join(workdir, name)
                    if not name or not os.path.isfile(path) or not os.path.realpath(path).startswith(os.path.realpath(workdir)):
                        self._reply(404, {"error": "file not found"})
                        return
                    with open(path, "rb") as f:
                        data = f.read()
                    ctype = "image/png" if name.lower().endswith(".png") else "application/octet-stream"
                    self._reply(200, data, ctype)
                    return
                if r.path == "/volstats":
                    model_id = (q.get("id") or [""])[0]
                    if not model_id:
                        self._reply(400, {"error": "missing id"})
                        return
                    try:
                        self._reply(200, vol_stats(model_id))
                    except Exception as exc:  # noqa: BLE001
                        self._reply(500, {"error": str(exc)})
                    return
                if r.path == "/nextid":
                    self._reply(200, {"next": next_model_id()})
                    return
                if r.path == "/exec":
                    command = (q.get("command") or [""])[0]
                    if not command:
                        self._reply(400, {"error": "missing command"})
                        return
                    self._exec(command)
                    return
                self._reply(404, {"error": "unknown route"})
            except Exception as exc:  # noqa: BLE001 - keep the bridge alive
                try:
                    self._reply(500, {"error": str(exc)})
                except Exception:
                    pass

        def do_POST(self):
            if not self._origin_ok():
                return
            from urllib.parse import urlparse
            r = urlparse(self.path)
            try:
                if r.path == "/exec":
                    length = int(self.headers.get("Content-Length") or 0)
                    body = self.rfile.read(length) if length else b"{}"
                    try:
                        payload = json.loads(body.decode("utf-8") or "{}")
                    except Exception:
                        payload = {}
                    command = str(payload.get("command") or "")
                    if not command:
                        self._reply(400, {"error": "missing command"})
                        return
                    self._exec(command)
                    return
                self._reply(404, {"error": "unknown route"})
            except Exception as exc:  # noqa: BLE001
                try:
                    self._reply(500, {"error": str(exc)})
                except Exception:
                    pass

        def _exec(self, command):
            try:
                text, err = run_command(command)
            except Exception as exc:  # noqa: BLE001
                text, err = "", "%s: %s" % (type(exc).__name__, exc)
            self._reply(200, {"text": text or "", "error": err})

    server = None
    bound_port = None
    for port in PORT_PREFERENCE:
        try:
            server = HTTPServer(("127.0.0.1", port), Handler)
            bound_port = port
            break
        except OSError:
            continue
    if server is None:
        session.logger.error("CryoSmart Flow Bridge: 端口 %s 均被占用，无法启动。" % PORT_PREFERENCE)
        return

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    session.logger.info("=" * 60)
    session.logger.info("CryoSmart Flow Bridge 已启动: http://127.0.0.1:%d" % bound_port)
    session.logger.info("允许的网页来源: %s" % ", ".join(ALLOWED_ORIGINS))
    session.logger.info("保持 ChimeraX 打开；在网页端点击 \"生成流程图\" 即可全自动完成对齐/手性检查/截图。")
    session.logger.info("=" * 60)


# ==================== 入口 ====================
if "session" in globals():
    main(session)
elif __name__ == "__main__":
    print("请在 ChimeraX 中打开此脚本运行（open <APP-ORIGIN>/api/cryosmart/flow-figure/relay.py）。")
