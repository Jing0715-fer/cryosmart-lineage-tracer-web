# -*- coding: utf-8 -*-
"""
CryoSmart Flow Bridge (in-ChimeraX CORS relay)

用法（只需一次）：
  在 ChimeraX 的 Command Line 里运行（把 <APP-ORIGIN> 换成网页应用地址）：
      open <APP-ORIGIN>/api/cryosmart/flow-figure/relay.py

  （推荐直接在网页的 "Workflow Figure" 卡片里复制这条命令——那里已经
   把真实 origin 拼好了。）

作用：
  在本机启动一个微型 HTTP 桥（默认端口 8927，冲突时自动尝试 8928/8929，
  监听所有网卡），之后 CryoSmart Lineage Tracer Web 页面即可直接
  驱动 ChimeraX 完成：地图打开 → 5 候选对齐（含 z 翻转手性检查）→
  90° 视角评分 → 高清截图回传 → 网页端组装 16:9 流程图 PPTX。

  ChimeraX 与浏览器可以在不同机器上（例如 ChimeraX 装在 CryoSmart
  服务器上、页面开在工作电脑上）——网页会同时探测 127.0.0.1 与
  CryoSmart 服务器主机的 8927-8929；安全不受影响：CORS 仍然仅放行
  本网页（Origin 校验，浏览器不可伪造）。

  内部机制与 ChimeraX 官方 MCP bridge / remotecontrol REST server 相同
  （session.ui.thread_safe 派发 + 日志捕获），但 CORS 仅放行本网页
  （Origin 校验，浏览器不可伪造），并且额外提供：
      GET  /ping        桥状态（工作目录、ChimeraX 版本）
      POST /exec        运行 ChimeraX 命令，返回文本输出与错误
      POST /stage       上传大文件（如 MRC 地图）到本机暂存目录，返回
                        ChimeraX 可直接 open 的本地绝对路径
                        （v3.47：ChimeraX 不支持 http+mrc，也无法无后缀
                        嗅探——网页先下载再经此接口暂存到 ChimeraX 同机，
                        之后 open 本地文件，全程零弹窗）
      GET  /file?name=  取回 /ping 工作目录里 ChimeraX 保存的 PNG
      GET  /volstats?id= 体数据统计（max/mean/sd，用于统一等值面水平）
      GET  /nextid      下一个空闲 model id（volume flip 需要）
      GET  /volumes    当前已打开的 volume 模型清单（id + 名称）。
                        v3.55：流程图网页在截图前先经此清单精确关闭
                        “过去已打开的 map”（仅关 volume，不动其他模型），
                        旧版桥无此端点时网页会退化为 close all。

  升级提示：若你的 ChimeraX 里还在运行旧版桥（/ping 不含 "stage":
  true），请在 ChimeraX Command Line 重新运行一次本命令即可更新
  （无需重启 ChimeraX）。v3.55 起重新 open 会先关掉旧桥再接管同一
  端口（旧版桥重 open 会叠到下一个端口，网页仍探到旧桥）。

运行环境：ChimeraX 1.12+（GUI）。保持 ChimeraX 打开即可；关闭 ChimeraX
时桥随之消失，下次重新 open 一次。
"""

import json
import os
import socket
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from queue import Queue

# The web app bakes its own origin in here when serving this file via
# /api/cryosmart/flow-figure/relay.py — only that origin may talk to the bridge.
ALLOWED_ORIGINS = ["__APP_ORIGIN__"]

PORT_PREFERENCE = [8927, 8928, 8929]

# v3.47 /stage limits: one MRC map is 8–300 MB; several full runs must not
# fill the ChimeraX machine's temp disk. Oldest staged files are removed
# first whenever the staging dir would exceed STAGING_TOTAL_CAP.
STAGING_DIR_NAME = "staged"
STAGE_SINGLE_CAP = 400 * 1024 * 1024   # 400 MB per upload
STAGING_TOTAL_CAP = 1536 * 1024 * 1024  # 1.5 GB total


def _read_exact(rfile, n):
    """Read exactly n bytes (rfile.read may return short on sockets)."""
    chunks = []
    remaining = n
    while remaining > 0:
        chunk = rfile.read(min(remaining, 1 << 20))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _num_list(text):
    out = []
    for part in str(text).replace(",", " ").replace(";", " ").split():
        try:
            out.append(float(part))
        except ValueError:
            pass
    return out


def main(session):
    # v3.55: 重新 open 本脚本时，先关闭旧桥再接管同一端口。旧版逻辑直接
    # 再 bind——旧桥仍占着 8927，新桥只能叠到 8928，而网页按顺序探测
    # 8927 会一直找到旧桥，升级流程从未真正生效。
    prev_server = getattr(session, "_cryoflow_bridge_server", None)
    if prev_server is not None:
        try:
            prev_server.shutdown()
            prev_server.server_close()
            session.logger.info("CryoSmart Flow Bridge: 旧桥已关闭，新桥将接管端口。")
        except Exception:
            pass
        try:
            session._cryoflow_bridge_server = None
        except Exception:
            pass

    workdir = tempfile.mkdtemp(prefix="cryoflow_")
    staging_dir = os.path.join(workdir, STAGING_DIR_NAME)
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

    def volume_list():
        """v3.55: 当前已打开的 volume 模型清单（流程图网页截图前的精确
        清理用它——只关 volume，不动用户手边打开的其他模型）。"""
        def f():
            out = []
            for m in session.models.list():
                if m.__class__.__name__ != "Volume":
                    continue
                out.append({
                    "id": str(getattr(m, "id_string", "")),
                    "name": str(getattr(m, "name", "")),
                })
            return out
        return ui_run(f)

    def stage_file(data, name):
        """v3.47: write uploaded bytes into the ChimeraX-side staging dir and
        return the local absolute path. ChimeraX cannot open http MRC URLs
        (format mrc unsupported for the http database; suffix-less plain
        opens pop a save dialog and block the UI thread), so the page
        downloads each map with its login session and hands the bytes to
        the bridge; ChimeraX then opens the LOCAL file. Oldest staged
        files are evicted first when the size cap would be exceeded."""
        os.makedirs(staging_dir, exist_ok=True)
        safe = os.path.basename(name or "") or "map.mrc"
        safe = "".join(c for c in safe if c.isalnum() or c in "._- ") or "map.mrc"
        entries = []
        total = 0
        try:
            for fn in os.listdir(staging_dir):
                p = os.path.join(staging_dir, fn)
                if os.path.isfile(p):
                    sz = os.path.getsize(p)
                    mt = os.path.getmtime(p)
                    entries.append((mt, p, sz))
                    total += sz
        except OSError:
            entries, total = [], 0
        for _, p, sz in sorted(entries):
            if total + len(data) - STAGING_TOTAL_CAP <= 0:
                break
            try:
                os.remove(p)
                total -= sz
            except OSError:
                pass
        path = os.path.join(staging_dir, safe)
        with open(path, "wb") as f:
            f.write(data)
        return path, len(data)

    class Handler(BaseHTTPRequestHandler):
        server_version = "CryoSmartFlowBridge/1.1"

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
            # v3.47: X-Filename — the /stage upload carries the target file
            # name in a custom header (query-param fallback kept too).
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
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
                        # v3.47: the page checks this to know /stage exists —
                        # older in-ChimeraX bridge copies don't send it.
                        "stage": True,
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
                if r.path == "/volumes":
                    # v3.55: 网页在截图前按此清单逐个 close 残留 volume。
                    try:
                        self._reply(200, {"ok": True, "volumes": volume_list()})
                    except Exception as exc:  # noqa: BLE001
                        self._reply(500, {"ok": False, "error": str(exc)})
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
            from urllib.parse import urlparse, parse_qs
            r = urlparse(self.path)
            try:
                if r.path == "/stage":
                    # v3.47: body = raw bytes; name = X-Filename header or
                    # ?name= query. Returns the ChimeraX-openable local path.
                    length = int(self.headers.get("Content-Length") or 0)
                    if length <= 0:
                        self._reply(400, {"ok": False, "error": "empty body"})
                        return
                    if length > STAGE_SINGLE_CAP:
                        self._reply(413, {
                            "ok": False,
                            "error": "file exceeds %d MB staging cap" % (STAGE_SINGLE_CAP // (1024 * 1024)),
                        })
                        return
                    q = parse_qs(r.query)
                    name = (q.get("name") or [""])[0] or self.headers.get("X-Filename") or ""
                    data = _read_exact(self.rfile, length)
                    if len(data) != length:
                        self._reply(400, {"ok": False, "error": "truncated upload"})
                        return
                    path, size = stage_file(data, name)
                    self._reply(200, {"ok": True, "path": path, "name": os.path.basename(path), "size": size})
                    return
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
    # v3.44: bind ALL interfaces (was 127.0.0.1) — ChimeraX often lives on
    # the CryoSmart server machine while the browser is a different desktop;
    # the strict Origin allow-list below is the security boundary, not the
    # loopback binding. Rejected requests (bad/no Origin) never execute
    # anything and only receive an empty 403.
    for port in PORT_PREFERENCE:
        try:
            server = HTTPServer(("", port), Handler)
            bound_port = port
            break
        except OSError:
            continue
    if server is None:
        session.logger.error("CryoSmart Flow Bridge: 端口 %s 均被占用，无法启动。" % PORT_PREFERENCE)
        return

    def _lan_ips():
        ips = set()
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ips.add(info[4][0])
        except Exception:
            pass
        try:
            probe_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe_sock.connect(("8.8.8.8", 80))
            ips.add(probe_sock.getsockname()[0])
            probe_sock.close()
        except Exception:
            pass
        return sorted(ips)

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    # v3.55: 记在 session 上，重 open 时才能关掉旧桥接管同端口。
    try:
        session._cryoflow_bridge_server = server
    except Exception:
        pass

    session.logger.info("=" * 60)
    session.logger.info("CryoSmart Flow Bridge 已启动 (监听全部网卡):")
    session.logger.info("  本机:      http://127.0.0.1:%d" % bound_port)
    for ip in _lan_ips():
        session.logger.info("  局域网:    http://%s:%d  (ChimeraX 与浏览器不同机时用这个)" % (ip, bound_port))
    session.logger.info("允许的网页来源: %s" % ", ".join(ALLOWED_ORIGINS))
    session.logger.info("暂存目录 (v3.47 /stage): %s" % staging_dir)
    session.logger.info("保持 ChimeraX 打开；在网页端点击 \"生成流程图\" 即可全自动完成对齐/手性检查/截图。")
    session.logger.info("=" * 60)


# ==================== 入口 ====================
if "session" in globals():
    main(session)
elif __name__ == "__main__":
    print("请在 ChimeraX 中打开此脚本运行（open <APP-ORIGIN>/api/cryosmart/flow-figure/relay.py）。")
