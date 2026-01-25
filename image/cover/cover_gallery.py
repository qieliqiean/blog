#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


DEFAULT_USED_FILE = ".cover-used.json"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heif", ".heic"}
CONTENT_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".heif": "image/heif",
    ".heic": "image/heic",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _text_response(handler: BaseHTTPRequestHandler, status: int, text: str, content_type: str) -> None:
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", f"{content_type}; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _safe_join(root: Path, relative: str) -> Path:
    rel = Path(relative)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("invalid path")
    full = (root / rel).resolve()
    root_resolved = root.resolve()
    if root_resolved not in full.parents and full != root_resolved:
        raise ValueError("path escapes root")
    return full


@dataclass(frozen=True)
class ImageInfo:
    name: str
    size: int
    mtime: float
    ext: str
    detected_format: str
    used: bool
    browser_maybe_unsupported: bool


class UsedStore:
    def __init__(self, used_file: Path):
        self.used_file = used_file
        self._used: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self.used_file.exists():
            self._used = {}
            return
        try:
            data = json.loads(self.used_file.read_text(encoding="utf-8"))
            used = data.get("used", {})
            self._used = used if isinstance(used, dict) else {}
        except Exception:
            self._used = {}

    def is_used(self, filename: str) -> bool:
        return filename in self._used

    def mark(self, filename: str, used: bool) -> None:
        if used:
            self._used[filename] = {"marked_at": _utc_now_iso()}
        else:
            self._used.pop(filename, None)
        self._save()

    def _save(self) -> None:
        tmp = self.used_file.with_suffix(self.used_file.suffix + ".tmp")
        payload = {"version": 1, "used": self._used}
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, self.used_file)

    def apply_renames(self, renames: dict[str, str]) -> None:
        if not renames:
            return
        updated = False
        for old, new in renames.items():
            if old == new:
                continue
            if old not in self._used:
                continue
            if new in self._used:
                self._used.pop(old, None)
                updated = True
                continue
            self._used[new] = self._used.pop(old)
            updated = True
        if updated:
            self._save()


def sniff_image_format(header: bytes) -> str:
    if header.startswith(b"\xFF\xD8\xFF"):
        return "jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        return "gif"
    if header.startswith(b"BM"):
        return "bmp"
    if header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP":
        return "webp"
    if len(header) >= 12 and header[4:8] == b"ftyp":
        brand = header[8:12]
        if brand in {
            b"heic",
            b"heix",
            b"hevc",
            b"hevx",
        }:
            return "heic"
        if brand in {
            b"mif1",
            b"msf1",
            b"heif",
        }:
            return "heif"
    return "unknown"


def format_to_content_type(fmt: str, ext: str) -> str:
    if fmt == "jpeg":
        return "image/jpeg"
    if fmt == "png":
        return "image/png"
    if fmt == "gif":
        return "image/gif"
    if fmt == "bmp":
        return "image/bmp"
    if fmt == "webp":
        return "image/webp"
    if fmt == "heic":
        return "image/heic"
    if fmt == "heif":
        return "image/heif"
    return CONTENT_TYPES.get(ext) or mimetypes.guess_type("x" + ext)[0] or "application/octet-stream"


def _is_simple_number_name(path: Path) -> bool:
    base = path.stem
    if not base.isdigit():
        return False
    if len(base) > 6:
        return False
    return True


def auto_rename_images(folder: Path, store: UsedStore, *, dry_run: bool = False) -> dict[str, Any]:
    images = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS]

    max_num = 0
    for file_path in images:
        base = file_path.stem
        if base.isdigit():
            try:
                num = int(base)
            except ValueError:
                continue
            if 0 <= num < 1_000_000 and num > max_num:
                max_num = num

    next_num = max_num + 1
    renamed: list[dict[str, str]] = []
    renames_for_store: dict[str, str] = {}
    skipped: list[str] = []

    for file_path in sorted(images, key=lambda p: p.name.lower()):
        if _is_simple_number_name(file_path):
            skipped.append(file_path.name)
            continue

        ext = file_path.suffix
        while (folder / f"{next_num}{ext}").exists():
            next_num += 1
        new_name = f"{next_num}{ext}"
        new_path = folder / new_name

        if not dry_run:
            os.replace(file_path, new_path)
        renamed.append({"from": file_path.name, "to": new_name})
        renames_for_store[file_path.name] = new_name
        next_num += 1

    if not dry_run:
        store.apply_renames(renames_for_store)
    return {"max_num": max_num, "dry_run": dry_run, "renamed": renamed, "skipped": skipped}


def list_images(folder: Path, store: UsedStore, *, only_unused: bool) -> list[ImageInfo]:
    items: list[ImageInfo] = []
    for child in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_file():
            continue
        ext = child.suffix.lower()
        if ext not in IMAGE_EXTS:
            continue

        stat = child.stat()
        used = store.is_used(child.name)
        if only_unused and used:
            continue

        try:
            with child.open("rb") as f:
                header = f.read(32)
        except Exception:
            header = b""
        detected_format = sniff_image_format(header)
        browser_maybe_unsupported = detected_format in {"heif", "heic"}
        items.append(
            ImageInfo(
                name=child.name,
                size=stat.st_size,
                mtime=stat.st_mtime,
                ext=ext,
                detected_format=detected_format,
                used=used,
                browser_maybe_unsupported=browser_maybe_unsupported,
            )
        )
    return items


INDEX_HTML = """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cover Gallery</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 16px; }
      .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
      .bar > * { margin: 0; }
      button { padding: 8px 10px; cursor: pointer; }
      label { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; }
      .muted { opacity: 0.75; font-size: 12px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
      .card { border: 1px solid rgba(127,127,127,.35); border-radius: 12px; overflow: hidden; background: rgba(127,127,127,.06); }
      .thumbWrap { position: relative; aspect-ratio: 16 / 9; background: rgba(127,127,127,.12); display: grid; place-items: center; }
      img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
      .warn { position: absolute; left: 8px; top: 8px; font-size: 12px; padding: 4px 6px; border-radius: 999px; background: rgba(220, 38, 38, .18); border: 1px solid rgba(220, 38, 38, .35); }
      .fallback { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 10px; font-size: 12px; opacity: .85; }
      .meta { padding: 10px; display: grid; gap: 6px; }
      .name { font-weight: 600; word-break: break-all; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .primary { background: rgba(34, 197, 94, .20); border: 1px solid rgba(34, 197, 94, .45); border-radius: 10px; }
      .secondary { background: rgba(59, 130, 246, .18); border: 1px solid rgba(59, 130, 246, .4); border-radius: 10px; }
      .danger { background: rgba(239, 68, 68, .18); border: 1px solid rgba(239, 68, 68, .4); border-radius: 10px; }
      .toast { position: fixed; right: 16px; bottom: 16px; padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,.80); color: #fff; opacity: 0; transform: translateY(6px); transition: opacity .15s ease, transform .15s ease; pointer-events: none; }
      .toast.show { opacity: 1; transform: translateY(0px); }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <div class="bar">
      <button id="refresh">刷新</button>
      <button id="rename">重命名(自动编号)</button>
      <label><input id="showUsed" type="checkbox" />显示已用</label>
      <span class="muted" id="count"></span>
      <span class="muted">提示：点击“标记已用”后，这张图默认就不会再出现。</span>
    </div>
    <div class="grid" id="grid"></div>
    <div class="toast" id="toast"></div>
    <script>
      const grid = document.getElementById('grid');
      const showUsed = document.getElementById('showUsed');
      const refreshBtn = document.getElementById('refresh');
      const renameBtn = document.getElementById('rename');
      const count = document.getElementById('count');
      const toast = document.getElementById('toast');

      function fmtBytes(bytes) {
        const units = ['B','KB','MB','GB'];
        let n = bytes, i = 0;
        while (n >= 1024 && i < units.length-1) { n /= 1024; i++; }
        return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
      }

      function showToast(text) {
        toast.textContent = text;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1200);
      }

      async function api(path, options) {
        const res = await fetch(path, { cache: 'no-store', ...options });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`${res.status} ${res.statusText} ${t}`);
        }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) return res.json();
        return res.text();
      }

      async function setUsed(name, used) {
        await api('/api/mark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, used })
        });
      }

      async function renameImages() {
        if (!confirm('会把“非纯数字文件名”的图片自动改成顺序编号（例如 11.jpg）。确定继续？')) return;
        renameBtn.disabled = true;
        try {
          const res = await api('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          showToast(`已重命名 ${res.renamed.length} 个`);
          await refresh();
        } catch (e) {
          showToast('重命名失败');
          throw e;
        } finally {
          renameBtn.disabled = false;
        }
      }

      async function convertHeicToJpg(name) {
        if (!confirm('检测到 HEIC/HEIF（即使扩展名是 .jpg 也可能无法预览）。转换后会生成真正的 JPG，原文件会移动到 .originals/。继续？')) return;
        const res = await api('/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, format: 'jpg' })
        });
        showToast(`已转换为 ${res.output_name}`);
      }

      function card(item) {
        const wrap = document.createElement('div');
        wrap.className = 'card';

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'thumbWrap';

        if (item.browser_maybe_unsupported) {
          const warn = document.createElement('div');
          warn.className = 'warn';
          warn.textContent = `可能无法预览(${(item.detected_format || 'HEIC').toUpperCase()})`;
          thumbWrap.appendChild(warn);
        }

        const addFallback = (text) => {
          const fb = document.createElement('div');
          fb.className = 'fallback muted';
          fb.textContent = text;
          thumbWrap.appendChild(fb);
        };

        if (item.browser_maybe_unsupported) {
          addFallback('此格式浏览器通常不支持预览（可点“转换为JPG”）');
        } else {
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.alt = item.name;
          img.addEventListener('error', () => {
            img.remove();
            addFallback('预览失败（可能是格式/文件损坏）');
          }, { once: true });
          img.src = `/img/${encodeURIComponent(item.name)}`;
          thumbWrap.appendChild(img);
        }

        const meta = document.createElement('div');
        meta.className = 'meta';

        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = item.name;

        const sub = document.createElement('div');
        sub.className = 'muted';
        const fmt = (item.detected_format || 'unknown').toUpperCase();
        sub.textContent = `${fmtBytes(item.size)} · ${item.used ? '已用' : '未用'} · ${item.ext} / ${fmt}`;

        const actions = document.createElement('div');
        actions.className = 'actions';

        const open = document.createElement('a');
        open.href = `/img/${encodeURIComponent(item.name)}`;
        open.target = '_blank';
        open.rel = 'noreferrer';
        const openBtn = document.createElement('button');
        openBtn.className = 'secondary';
        openBtn.textContent = '打开';
        open.appendChild(openBtn);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'secondary';
        copyBtn.textContent = '复制文件名';
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(item.name);
            showToast('已复制文件名');
          } catch {
            showToast('复制失败（浏览器权限）');
          }
        });

        const usedBtn = document.createElement('button');
        usedBtn.className = item.used ? 'danger' : 'primary';
        usedBtn.textContent = item.used ? '取消已用' : '标记已用';
        usedBtn.addEventListener('click', async () => {
          usedBtn.disabled = true;
          try {
            await setUsed(item.name, !item.used);
            await refresh();
            showToast(item.used ? '已取消' : '已标记');
          } finally {
            usedBtn.disabled = false;
          }
        });

        actions.appendChild(open);
        actions.appendChild(copyBtn);
        if (item.browser_maybe_unsupported) {
          const convBtn = document.createElement('button');
          convBtn.className = 'primary';
          convBtn.textContent = '转换为JPG';
          convBtn.addEventListener('click', async () => {
            convBtn.disabled = true;
            try {
              await convertHeicToJpg(item.name);
              await refresh();
            } finally {
              convBtn.disabled = false;
            }
          });
          actions.appendChild(convBtn);
        }
        actions.appendChild(usedBtn);

        meta.appendChild(name);
        meta.appendChild(sub);
        meta.appendChild(actions);

        wrap.appendChild(thumbWrap);
        wrap.appendChild(meta);
        return wrap;
      }

      async function refresh() {
        const onlyUnused = !showUsed.checked;
        const data = await api(`/api/images?only_unused=${onlyUnused ? '1' : '0'}`);
        grid.replaceChildren(...data.images.map(card));
        count.textContent = `${data.images.length} 张`;
      }

      refreshBtn.addEventListener('click', refresh);
      renameBtn.addEventListener('click', renameImages);
      showUsed.addEventListener('change', refresh);
      refresh();
    </script>
  </body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "CoverGallery/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            return _text_response(self, HTTPStatus.OK, INDEX_HTML, "text/html")
        if parsed.path == "/api/images":
            qs = parse_qs(parsed.query)
            only_unused = qs.get("only_unused", ["0"])[0] in {"1", "true", "yes"}
            images = list_images(self.server.folder, self.server.store, only_unused=only_unused)  # type: ignore[attr-defined]
            return _json_response(
                self,
                HTTPStatus.OK,
                {
                    "folder": str(self.server.folder),  # type: ignore[attr-defined]
                    "images": [i.__dict__ for i in images],
                },
            )
        if parsed.path.startswith("/img/"):
            name = unquote(parsed.path[len("/img/") :])
            try:
                file_path = _safe_join(self.server.folder, name)  # type: ignore[attr-defined]
            except ValueError:
                return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid filename"})
            if not file_path.exists() or not file_path.is_file():
                return _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

            ext = file_path.suffix.lower()
            if ext not in IMAGE_EXTS:
                return _json_response(self, HTTPStatus.FORBIDDEN, {"error": "forbidden"})

            try:
                with file_path.open("rb") as f:
                    header = f.read(64)
                    fmt = sniff_image_format(header)
                    ctype = format_to_content_type(fmt, ext)
                    rest = f.read()
                data = header + rest
            except Exception:
                return _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "read failed"})

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/rename":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            raw = self.rfile.read(length) if length > 0 else b""
            if raw.strip():
                try:
                    payload = json.loads(raw.decode("utf-8"))
                except Exception:
                    return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid json"})
            else:
                payload = {}
            dry_run = bool(payload.get("dry_run", False))
            try:
                result = auto_rename_images(self.server.folder, self.server.store, dry_run=dry_run)  # type: ignore[attr-defined]
            except Exception as exc:
                return _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return _json_response(self, HTTPStatus.OK, result)

        if parsed.path == "/api/convert":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            raw = self.rfile.read(length) if length > 0 else b""
            try:
                payload = json.loads(raw.decode("utf-8") if raw else "{}")
            except Exception:
                return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid json"})

            name = payload.get("name")
            fmt = payload.get("format", "jpg")
            if not isinstance(name, str) or not isinstance(fmt, str):
                return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "expected {name: string, format: string}"})
            if fmt.lower() not in {"jpg", "jpeg"}:
                return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "only jpg supported"})

            try:
                result = convert_heic_to_jpg(self.server.folder, self.server.store, name)  # type: ignore[attr-defined]
            except FileNotFoundError:
                return _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})
            except ValueError as exc:
                return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except RuntimeError as exc:
                return _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            except Exception as exc:
                return _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return _json_response(self, HTTPStatus.OK, result)

        if parsed.path != "/api/mark":
            return _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid json"})

        name = payload.get("name")
        used = payload.get("used")
        if not isinstance(name, str) or not isinstance(used, bool):
            return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "expected {name: string, used: boolean}"})

        try:
            file_path = _safe_join(self.server.folder, name)  # type: ignore[attr-defined]
        except ValueError:
            return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid filename"})
        if not file_path.exists() or not file_path.is_file():
            return _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

        ext = file_path.suffix.lower()
        if ext not in IMAGE_EXTS:
            return _json_response(self, HTTPStatus.FORBIDDEN, {"error": "forbidden"})

        self.server.store.mark(name, used)  # type: ignore[attr-defined]
        return _json_response(self, HTTPStatus.OK, {"ok": True})

    def log_message(self, fmt: str, *args: Any) -> None:
        return


class Server(ThreadingHTTPServer):
    def __init__(self, addr: tuple[str, int], handler: type[BaseHTTPRequestHandler], *, folder: Path, store: UsedStore):
        super().__init__(addr, handler)
        self.folder = folder
        self.store = store


def _unique_path(folder: Path, name: str) -> Path:
    base = Path(name).name
    candidate = folder / base
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    for i in range(1, 10_000):
        cand = folder / f"{stem}.{i}{suffix}"
        if not cand.exists():
            return cand
    raise RuntimeError("unable to find unique name")


def convert_heic_to_jpg(folder: Path, store: UsedStore, name: str) -> dict[str, Any]:
    file_path = _safe_join(folder, name)
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(name)
    if file_path.suffix.lower() not in IMAGE_EXTS:
        raise ValueError("not an image")

    with file_path.open("rb") as f:
        header = f.read(64)
    detected = sniff_image_format(header)
    if detected not in {"heif", "heic"}:
        raise ValueError(f"not heic/heif (detected: {detected})")

    originals_dir = folder / ".originals"
    originals_dir.mkdir(exist_ok=True)

    base = file_path.stem
    desired_ext = ".jpg"
    output_path = folder / f"{base}{desired_ext}"

    moved_original: Path | None = None
    restore_to: Path | None = None

    # If current name already ends with .jpg/.jpeg, keep output name stable:
    # move original to .originals/ (with corrected extension) then write converted jpg to original path.
    if file_path.suffix.lower() in {".jpg", ".jpeg"}:
        corrected_ext = ".heic" if detected == "heic" else ".heif"
        moved_name = f"{base}{corrected_ext}"
        moved_path = _unique_path(originals_dir, moved_name)
        os.replace(file_path, moved_path)
        moved_original = moved_path
        restore_to = file_path
        input_path = moved_path
        final_output = file_path.with_suffix(desired_ext)
        tmp_output = _unique_path(originals_dir, f"{base}.converted{desired_ext}")
    else:
        input_path = file_path
        final_output = output_path
        tmp_output = _unique_path(originals_dir, f"{base}.converted{desired_ext}")

    script = folder / "convert_heic_to_jpg.ps1"
    if not script.exists():
        raise RuntimeError("convert_heic_to_jpg.ps1 not found")

    try:
        proc = subprocess.run(
            [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
                "-InputPath",
                str(input_path),
                "-OutputPath",
                str(tmp_output),
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            msg = (proc.stdout + "\n" + proc.stderr).strip()
            raise RuntimeError(msg or "conversion failed")

        os.replace(tmp_output, final_output)
    except Exception:
        if moved_original is not None and restore_to is not None:
            if not restore_to.exists() and moved_original.exists():
                try:
                    os.replace(moved_original, restore_to)
                except Exception:
                    pass
        raise

    if file_path.suffix.lower() not in {".jpg", ".jpeg"}:
        store.apply_renames({file_path.name: final_output.name})

    return {
        "ok": True,
        "input_moved_or_used": str(input_path),
        "output_name": final_output.name,
        "detected": detected,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Local gallery to mark used cover images.")
    parser.add_argument("--dir", default=".", help="Folder to scan (default: current dir)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Bind port (default: 8765)")
    parser.add_argument("--used-file", default=DEFAULT_USED_FILE, help=f"Used json file name (default: {DEFAULT_USED_FILE})")
    args = parser.parse_args()

    folder = Path(args.dir).resolve()
    used_file = folder / args.used_file
    store = UsedStore(used_file)

    with Server((args.host, args.port), Handler, folder=folder, store=store) as httpd:
        url = f"http://{args.host}:{args.port}/"
        print(f"Cover gallery: {url}")
        print(f"Folder: {folder}")
        print(f"Used file: {used_file}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
