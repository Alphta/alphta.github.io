#!/usr/bin/env python3
"""把一份文档加入资料库。

付费文档：上传到 Cloudflare KV（单文件 ≤ 25MB），凭访问码下载
免费文档：复制到 static/files/，直接公开下载

用法：
  python3 scripts/upload_doc.py 论文.pdf --title "债券收益率曲线" --authors "张三" --year 2020 \
      --summary "一句话介绍" --paid
  python3 scripts/upload_doc.py 报告.pdf --title "..." --free --tags "债券,利率"

加 --code XXX-2026 可同时创建一个只解锁这份文件的访问码。
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "files.json"
KV_NS = "8ba601649b08479a92f16f4faf968331"
WORKER_DIR = ROOT / "workers" / "counter"
KV_LIMIT = 25 * 1024 * 1024


def slugify(text):
    ascii_only = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    if ascii_only:
        if len(ascii_only) > 60:
            ascii_only = ascii_only[:60].rsplit("-", 1)[0]
        return ascii_only
    # 中文标题走拼音
    try:
        from pypinyin import lazy_pinyin
        py = "-".join(lazy_pinyin(text))
        py = re.sub(r"[^a-z0-9]+", "-", py.lower()).strip("-")
        if py:
            if len(py) > 60:
                py = py[:60].rsplit("-", 1)[0]
            return py
    except ImportError:
        pass
    return "doc-" + hashlib.md5(text.encode()).hexdigest()[:8]


def wrangler(*args):
    cmd = ["npx", "wrangler", *args, "--namespace-id=" + KV_NS, "--remote"]
    r = subprocess.run(cmd, cwd=WORKER_DIR, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-800:])
        print(r.stderr[-800:])
        raise SystemExit(f"wrangler 失败：{' '.join(args[:2])}")
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--title", required=True)
    ap.add_argument("--authors", default="")
    ap.add_argument("--year", default="")
    ap.add_argument("--summary", default="")
    ap.add_argument("--tags", default="")
    ap.add_argument("--slug", default="")
    ap.add_argument("--paid", action="store_true")
    ap.add_argument("--free", action="store_true")
    ap.add_argument("--code", default="")
    ap.add_argument("--filename", default="")
    a = ap.parse_args()

    if a.paid == a.free:
        raise SystemExit("必须二选一：--paid 或 --free")

    src = pathlib.Path(a.file).expanduser().resolve()
    if not src.exists():
        raise SystemExit(f"文件不存在：{src}")
    size = src.stat().st_size
    ext = src.suffix.lower() or ".pdf"
    slug = a.slug or slugify(a.title)
    sha = hashlib.sha256(src.read_bytes()).hexdigest()

    type_map = {".pdf": "application/pdf", ".epub": "application/epub+zip",
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".zip": "application/zip", ".md": "text/markdown; charset=utf-8"}
    mime = type_map.get(ext, "application/octet-stream")

    entry = {
        "slug": slug,
        "title": a.title,
        "authors": a.authors,
        "year": a.year,
        "summary": a.summary,
        "tags": [t.strip() for t in a.tags.split(",") if t.strip()],
        "size": size,
        "sha256": sha,
        "paid": bool(a.paid),
        "filename": a.filename or src.name,
        "type": mime,
        "added": __import__("datetime").date.today().isoformat(),
    }

    if a.paid:
        if size > KV_LIMIT:
            raise SystemExit(f"文件 {size/1048576:.1f}MB 超过 KV 25MB 上限；大文件需要 R2（需绑卡）")
        print(f"上传到 KV：{slug}（{size/1048576:.1f}MB）…")
        wrangler("kv", "key", "put", f"file:{slug}", f"--path={src}")
        meta = {k: entry[k] for k in ("filename", "type", "size", "title", "paid")}
        wrangler("kv", "key", "put", f"doc:{slug}:meta", json.dumps(meta, ensure_ascii=False))
        if a.code:
            code = a.code.strip().upper()
            wrangler("kv", "key", "put", f"code:{code}", json.dumps({"slugs": [slug]}, ensure_ascii=False))
            print(f"访问码已创建：{code}（仅解锁 {slug}）")
    else:
        dest_dir = ROOT / "static" / "files"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{slug}{ext}"
        shutil.copy2(src, dest)
        entry["url"] = f"/files/{slug}{ext}"
        print(f"已复制到 {dest.relative_to(ROOT)}")

    items = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else []
    items = [x for x in items if x.get("slug") != slug]
    items.insert(0, entry)
    DATA.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"✅ 已登记：{a.title}（{'付费' if a.paid else '免费'}，{size/1048576:.1f}MB）")
    print("下一步：hugo --gc --minify && git add -A && git commit && git push")


if __name__ == "__main__":
    main()
