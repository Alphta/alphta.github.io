#!/usr/bin/env python3
"""生成站内 AI 问答用的语料（纯文本），输出 static/ai/corpus.json"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "ai" / "corpus.json"


def strip_md(text):
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)          # 图片
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)      # 链接
    text = re.sub(r"(?m)^\|.*\|$", "", text)                   # 表格行
    text = re.sub(r"(?m)^[#>\-\*]\s*", "", text)               # 标记
    text = re.sub(r"\*\*|__|\*|_", "", text)                   # 强调
    text = re.sub(r"`{1,3}", "", text)                         # 行内代码
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


items = []
for p in sorted((ROOT / "content" / "posts").glob("*/index.md")):
    raw = p.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
    fm, body = (m.group(1), raw[m.end():]) if m else ("", raw)

    def field(name):
        mm = re.search(rf'^{name}:\s*"?(.*?)"?\s*$', fm, re.M)
        return mm.group(1) if mm else ""

    title = field("title")
    slug = field("slug") or p.parent.name
    date = field("date")[:10]
    text = strip_md(body)
    if not text:
        continue
    items.append({
        "slug": slug,
        "title": title,
        "url": f"/posts/{slug}/",
        "date": date,
        "text": text,
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
total = sum(len(x["text"]) for x in items)
print(f"写入 {OUT.relative_to(ROOT)}：{len(items)} 篇，正文 {total} 字，文件 {OUT.stat().st_size/1024:.0f} KB")
