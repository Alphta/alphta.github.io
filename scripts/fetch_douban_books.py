#!/usr/bin/env python3
"""抓取豆瓣「读过」书单 → data/books.json

用法：/usr/bin/python3 scripts/fetch_douban_books.py
原理：先访问 www.douban.com 拿到 bid cookie，再翻收藏页（否则 403）。
"""
import json
import os
import re
import subprocess
import sys
import time

import requests
from bs4 import BeautifulSoup

USER = "niviens"
SITE = os.path.expanduser("~/Quant/blog")
OUT_JSON = os.path.join(SITE, "data", "books.json")
IMG_DIR = os.path.join(SITE, "static", "images", "books")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
session.proxies = {}  # 直连，走代理会被判成机房 IP


def warmup():
    session.get("https://www.douban.com/", timeout=20)


def parse_page(html):
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for li in soup.select("li.subject-item"):
        a = li.select_one(".pic a") or li.select_one("a.nbg")
        img = li.select_one(".pic img")
        title_a = li.select_one("h2 a") or li.select_one(".title a")
        meta = li.select_one(".pub")
        rating = li.select_one("span[class^='rating']")
        date = li.select_one(".date")
        comment = li.select_one(".comment")
        if not title_a:
            continue
        rating_n = 0
        if rating:
            m = re.search(r"rating(\d)-t", " ".join(rating.get("class") or []))
            if m:
                rating_n = int(m.group(1))
        items.append({
            "title": title_a.get_text(strip=True),
            "url": title_a.get("href", ""),
            "cover": (img.get("src") if img else "") or "",
            "meta": meta.get_text(" ", strip=True) if meta else "",
            "rating": rating_n,
            "date": date.get_text(strip=True) if date else "",
            "comment": comment.get_text(" ", strip=True) if comment else "",
        })
    return items


def fetch_reviews():
    """抓「书评」列表（长评），按书目 URL 建索引"""
    out = {}
    start = 0
    while start < 200:
        url = f"https://www.douban.com/people/{USER}/reviews?start={start}"
        r = session.get(url, timeout=30)
        if r.status_code != 200:
            break
        soup = BeautifulSoup(r.text, "html.parser")
        items = soup.select(".review-list .review-item")
        if not items:
            break
        for it in items:
            a_book = it.select_one("a.subject-img")
            h = it.select_one("h2 a") or it.select_one(".title a")
            sc = it.select_one(".short-content, .review-short")
            if not (a_book and h):
                continue
            book_url = a_book.get("href", "").split("?")[0]
            out[book_url.rstrip("/") + "/"] = {
                "review_title": h.get_text(strip=True),
                "review_url": h.get("href", ""),
                "review_excerpt": sc.get_text(" ", strip=True)[:140] if sc else "",
            }
        start += 10
        time.sleep(1.2)
    return out


def main():
    warmup()
    books, seen = [], set()
    for start in range(0, 200, 15):
        url = f"https://book.douban.com/people/{USER}/collect?start={start}&sort=time&rating=all&filter=all&mode=grid"
        r = session.get(url, timeout=30)
        if r.status_code != 200:
            print(f"  start={start} -> HTTP {r.status_code}", file=sys.stderr)
            break
        page_items = parse_page(r.text)
        if not page_items:
            break
        for b in page_items:
            if b["url"] in seen:
                continue
            seen.add(b["url"])
            books.append(b)
        print(f"  start={start}: +{len(page_items)} (total {len(books)})")
        if len(page_items) < 15:
            break
        time.sleep(1.5)

    # 书评（长评）：按书目挂到对应条目上
    reviews = fetch_reviews()
    for b in books:
        key = b["url"].split("?")[0].rstrip("/") + "/"
        rv = reviews.get(key)
        if rv:
            b.update(rv)
    print(f"  书评 {len(reviews)} 条，匹配 {sum(1 for b in books if b.get('review_url'))} 本")

    # 下载封面
    os.makedirs(IMG_DIR, exist_ok=True)
    for i, b in enumerate(books, 1):
        cover = b.get("cover", "")
        if not cover:
            continue
        ext = os.path.splitext(cover.split("?")[0])[1] or ".jpg"
        name = f"{i:03d}{ext}"
        dest = os.path.join(IMG_DIR, name)
        if not os.path.exists(dest) or os.path.getsize(dest) < 500:
            subprocess.run(["curl", "-sL", "--noproxy", "*", "-A", UA,
                            "-e", "https://book.douban.com/", "-o", dest, cover], timeout=60)
        if os.path.exists(dest) and os.path.getsize(dest) > 500:
            b["cover_local"] = f"/images/books/{name}"
        else:
            b["cover_local"] = ""

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, indent=1)
    print(f"saved {len(books)} books -> {OUT_JSON}")


if __name__ == "__main__":
    main()
