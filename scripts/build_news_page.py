#!/usr/bin/env python3
"""把央行/监管/交易所等机构的公告聚合成一个网页列表。

只用标准库，方便在 GitHub Actions 里零依赖运行。
输出：static/news/index.html（Hugo 会原样复制到站点根 /news/）
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

CN_TZ = timezone(timedelta(hours=8))


def _D(days_ago=0):
    """n 天前的日期字符串，用于需要显式起止日期的接口。"""
    return (datetime.now(CN_TZ) - timedelta(days=days_ago)).strftime("%Y-%m-%d")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 2026-10-27 / 2026/10/27 / 2026.10.27 / 2026年10月27日
DATE_FULL = re.compile(r"(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})")
# 列表里只写 10-27 的情况
DATE_SHORT = re.compile(r"(?<!\d)(\d{1,2})\s*[-/月]\s*(\d{1,2})(?!\d)")

# 噪声过滤：领导活动 / 地方派出机构 / 人事招聘。
# 只作用于标题，命中就不进 feed，可用 --keep-noise 关闭。
NOISE_RE = re.compile(
    r"会见|会谈|座谈|拜访|拜会|调研|考察|走访|出席|致辞|讲话|批示|慰问|参观|访问"
    r"|(?:监管局|监管分局|特派办|专员办|证监局|银保监分局|财政厅|税务局|分局|办事处)\s*[：:]"
    r"|招聘|遴选|招考|报考|录用|选调|笔试|面试|拟聘"
)


class Source:
    """一个抓取源。parser 为 None 时用通用 HTML 列表解析。"""

    def __init__(self, sid, name, url, *, encoding="utf-8", base=None,
                 headers=None, parser=None, kind="html", body=None,
                 cutoff_days=45, home=None, link_re=None, short=None, channel=None):
        self.id = sid
        self.name = name
        self.url = url
        self.encoding = encoding
        self.base = base or url
        self.headers = headers or {}
        self.parser = parser
        self.kind = kind
        self.body = body
        self.cutoff_days = cutoff_days
        self.home = home or base or url
        self.link_re = link_re
        self.short = short or name
        self.channel = channel


# ---------------------------------------------------------------- 网络

def _decode(raw: bytes, content_type: str, fallback: str) -> str:
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    encodings = []
    if m:
        encodings.append(m.group(1))
    encodings += [fallback, "utf-8", "gb18030"]
    seen = set()
    for enc in encodings:
        enc = (enc or "").lower()
        if enc in seen:
            continue
        seen.add(enc)
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "ignore")


def fetch(src: Source, timeout=25, retries=1):
    """返回 (text, final_url)。失败抛异常。"""
    headers = dict(BASE_HEADERS)
    headers.update(src.headers)
    data = src.body.encode("utf-8") if src.body else None
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(src.url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                final = resp.geturl()
            return _decode(raw, ctype, src.encoding), final
        except ssl.SSLError as e:
            last_err = e
            # 少数国内站点证书链不全，退化为不校验（只读公开数据）
            try:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                req = urllib.request.Request(src.url, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                    raw = resp.read()
                    return _decode(raw, resp.headers.get("Content-Type", ""), src.encoding), resp.geturl()
            except Exception as e2:  # noqa: BLE001
                last_err = e2
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise last_err  # type: ignore[misc]


# ---------------------------------------------------------------- 解析

def clean_text(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html_mod.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def parse_date(block: str, now: datetime):
    m = DATE_FULL.search(block)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(y, mo, d, tzinfo=CN_TZ)
        except ValueError:
            return None
    m = DATE_SHORT.search(block)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        try:
            dt = datetime(now.year, mo, d, tzinfo=CN_TZ)
        except ValueError:
            return None
        if dt > now + timedelta(days=2):  # 跨年：列表里是去年的 12 月
            dt = dt.replace(year=now.year - 1)
        return dt
    return None


def parse_generic_html(text: str, src: Source, now: datetime):
    """通用列表解析：按 <li>/<tr> 块切，块内找第一个链接 + 一个日期。"""
    items = []
    blocks = re.findall(r"(?is)<(li|tr|dd)\b[^>]*>(.*?)</\1>", text)
    for _tag, block in blocks:
        if len(block) > 6000:
            block = block[:6000]
        a = re.search(r'(?is)<a\s[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', block)
        if not a:
            continue
        href = a.group(1).strip()
        if href.startswith(("javascript:", "#", "mailto:")):
            continue
        if src.link_re and not re.search(src.link_re, href):
            continue
        inner = a.group(2)
        # 优先 title 属性，其次 h6/h4 里的标题，最后用 <a> 内纯文本
        title = ""
        tattr = re.search(r'title\s*=\s*["\']([^"\']{4,})["\']', a.group(0))
        if tattr:
            title = clean_text(tattr.group(1))
        if len(title) < 4:
            h = re.search(r"(?is)<h[1-6][^>]*>(.*?)</h[1-6]>", inner)
            title = clean_text(h.group(1)) if h else clean_text(inner)
        title = title[:180].strip()
        # 列表里常把日期塞进链接文本，例如「标题 10-29」「标题 2026-10-27」
        title = re.sub(r"\s*20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?\s*$", "", title)
        title = re.sub(r"\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?\s*$", "", title)
        title = title.strip(" ·-—|")
        if len(title) < 4:
            continue
        dt = parse_date(block, now)
        if not dt:
            continue
        link = urllib.parse.urljoin(src.base, href)
        items.append({"source": src.name, "title": title, "link": link, "date": dt})
    return items


def parse_json_items(data, src: Source, now: datetime, mapping):
    """把 JSON 列表映射成条目。mapping 描述字段路径。"""
    rows = data
    for key in mapping.get("list_path", []):
        rows = rows.get(key) if isinstance(rows, dict) else rows
        if rows is None:
            return []
    if not isinstance(rows, list):
        return []
    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = ""
        for k in mapping.get("title_keys", []):
            title = title or clean_text(str(row.get(k) or ""))
        link = ""
        for k in mapping.get("link_keys", []):
            link = link or str(row.get(k) or "")
        datestr = ""
        for k in mapping.get("date_keys", []):
            datestr = datestr or str(row.get(k) or "")
        if not title or len(title) < 4:
            continue
        dt = parse_date(datestr, now) if datestr else None
        if not dt and datestr.isdigit() and len(datestr) == 13:  # 毫秒时间戳
            dt = datetime.fromtimestamp(int(datestr) / 1000, CN_TZ)
        if not dt and datestr.isdigit() and len(datestr) == 10:  # 秒时间戳
            dt = datetime.fromtimestamp(int(datestr), CN_TZ)
        if not dt:
            continue
        if link:
            link = urllib.parse.urljoin(src.base, link)
        items.append({"source": src.name, "title": title[:180], "link": link, "date": dt})
    return items


# ---------------------------------------------------------------- 站点适配器

def parse_pbc(text: str, src: "Source", now: datetime):
    """央行新闻列表：<font class="newslist_style"> + <a title> + 日期在 <a> 外的 span。"""
    items = []
    for chunk in re.split(r'(?is)<font class="newslist_style"', text)[1:]:
        chunk = re.split(r"(?is)</tr>|<li[\s>]", chunk)[0]
        m = re.search(r'(?is)<a\s[^>]*href="([^"]*113469/(\d{19})/index\.html)"[^>]*>', chunk)
        if not m:
            continue
        tag = m.group(0)
        # 必须用空格锚定，否则 istitle="true" 会被误当成 title
        t = re.search(r'\stitle="([^"]+)"', tag)
        title = html_mod.unescape(t.group(1)) if t else ""
        if len(title) < 4:
            continue
        d = re.search(r"(20\d{2}-\d{2}-\d{2})", chunk)
        if d:
            dt = parse_date(d.group(1), now)
        else:  # 退化为用 URL 里的 20261027… 时间戳
            i = m.group(2)
            dt = parse_date(f"{i[:4]}-{i[4:6]}-{i[6:8]}", now)
        if not dt:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin(src.base, m.group(1)),
                      "date": dt})
    return items


def parse_nfra(text: str, src: "Source", now: datetime):
    """金融监管总局：/cbircweb 后端 JSON，需自己拼详情页 URL。"""
    d = json.loads(text)
    rows = (d.get("data") or {}).get("rows") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", "", str(r.get("docTitle") or ""))
        dt = parse_date(str(r.get("publishDate") or ""), now)
        if len(title) < 4 or not dt:
            continue
        items.append({
            "title": title[:180],
            "link": ("https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html"
                     f"?docId={r.get('docId')}&itemId=915&generaltype=0"),
            "date": dt,
        })
    return items


def parse_csrc(text: str, src: "Source", now: datetime):
    """证监会：/searchList/{channelid}?_isJson=true；url 为协议相对地址。"""
    d = json.loads(text)
    rows = (d.get("data") or {}).get("results") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        url = str(r.get("url") or "")
        if url.startswith("//"):
            url = "https:" + url
        dt = parse_date(str(r.get("publishedTimeStr") or r.get("publishedTime") or ""), now)
        if len(title) < 4 or not dt:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


def parse_gov_json(text: str, src: "Source", now: datetime):
    """中国政府网：YAOWENLIEBIAO.json / ZUIXINZHENGCE.json 静态数组。"""
    rows = json.loads(text)
    if isinstance(rows, dict):
        rows = rows.get("data") or rows.get("list") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("TITLE") or r.get("title") or "")).strip()
        url = str(r.get("URL") or r.get("url") or "")
        dt = parse_date(str(r.get("DOCRELPUBTIME") or r.get("pubTime") or ""), now)
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


def parse_shcpe(text: str, src: "Source", now: datetime):
    """票交所：POST /shcpe-cos/article/list，publishTime 为 2026.10.23 点分隔。"""
    d = json.loads(text)
    rows = d.get("data") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        dt = parse_date(str(r.get("publishTime") or ""), now)
        aid = r.get("articleId")
        if len(title) < 4 or not dt or not aid:
            continue
        items.append({
            "title": title[:180],
            "link": ("http://www.shcpe.com.cn/content/shcpe/news/announce.html"
                     f"?articleType=news-announce&articleId={aid}"),
            "date": dt,
        })
    return items


def _raw(url, headers=None, data=None, timeout=25):
    """最简请求，返回解码后的文本（给需要多步握手的源用）。"""
    h = dict(BASE_HEADERS)
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return _decode(raw, resp.headers.get("Content-Type", ""), "utf-8")


def parse_sse(text: str, src: "Source", now: datetime):
    """上交所：pageHelp.data 是二维数组，必须拍平；SSEDATE 已是 YYYY-MM-DD。"""
    d = json.loads(text)
    rows = (d.get("pageHelp") or {}).get("data") or []
    flat = []
    for r in rows:
        if isinstance(r, list):
            flat.extend(r)
        elif isinstance(r, dict):
            flat.append(r)
    items = []
    for r in flat:
        title = re.sub(r"\s+", " ", str(r.get("TITLE") or "")).strip()
        dt = parse_date(str(r.get("SSEDATE") or ""), now)
        url = str(r.get("URL") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin("https://www.sse.com.cn", url),
                      "date": dt})
    return items


def parse_szse(text: str, src: "Source", now: datetime):
    """深交所：正文 PDF 在另一个域名 disc.szse.cn/download 下。"""
    d = json.loads(text)
    rows = d.get("data") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        dt = parse_date(str(r.get("publishTime") or ""), now)
        path = str(r.get("attachPath") or "")
        if len(title) < 4 or not dt or not path:
            continue
        items.append({"title": title[:180],
                      "link": "https://disc.szse.cn/download" + path,
                      "date": dt})
    return items


def parse_chinabond(text: str, src: "Source", now: datetime):
    """中债登：queryLatestReleaseForIndex，只回最新 9 条且不可翻页。"""
    d = json.loads(text)
    rows = (((d.get("data") or {}).get("data") or {}).get("list")) or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("DocTitle") or "")).strip()
        dt = parse_date(str(r.get("ShengXiaoShiJian") or ""), now)
        url = str(r.get("DOCPUBURL") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


def parse_bse(text: str, src: "Source", now: datetime):
    """北交所：首页是 wswaf 挑战，先用 C3VK 换 Cookie，再 POST listse.do。"""
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None  # 不跟随，自己读挑战响应

    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request("https://www.bse.cn/news/important_news.html",
                                 headers=dict(BASE_HEADERS))
    ck, body = "", ""
    try:
        with opener.open(req, timeout=25) as r:
            body = r.read().decode("utf-8", "ignore")
            ck = r.headers.get("Set-Cookie", "") or ""
    except urllib.error.HTTPError as e:  # 302 会抛 HTTPError
        body = e.read().decode("utf-8", "ignore")
        ck = e.headers.get("Set-Cookie", "") or ""
    m = re.search(r"C3VK=([0-9a-fA-F]+)", body) or re.search(r"C3VK=([0-9a-fA-F]+)", ck)
    if not m:
        raise RuntimeError("未取到 C3VK 挑战 Cookie")
    body = ("page=0&pageSize=20&keywords=&startTime=&endTime=&nodeIds[]=1289"
            "&needFields[]=infoId&needFields[]=title&needFields[]=metaDescription"
            "&needFields[]=linkUrl&needFields[]=htmlUrl&needFields[]=publishDate")
    raw = _raw("https://www.bse.cn/info/listse.do",
               headers={"Cookie": f"C3VK={m.group(1)}",
                        "X-Requested-With": "XMLHttpRequest",
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "Referer": "https://www.bse.cn/news/important_news.html"},
               data=body.encode())
    raw = re.sub(r"^\s*[a-zA-Z_$][\w$]*\s*\(", "", raw).strip()
    raw = re.sub(r"\)\s*;?\s*$", "", raw)
    d = json.loads(raw)
    rows = (((d[0] if isinstance(d, list) else d).get("data") or {}).get("content")) or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        dt = parse_date(str(r.get("publishDate") or ""), now)
        url = str(r.get("htmlUrl") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin("https://www.bse.cn", url),
                      "date": dt})
    items.sort(key=lambda x: x["date"], reverse=True)  # 首条恒为 2021 年置顶旧闻
    return items


def parse_shfe(text: str, src: "Source", now: datetime):
    """上期所：/api/search/ 必须带 Content-Type: application/json，否则 200 但 code=500。"""
    d = json.loads(text)
    rows = (d.get("data") or {}).get("content") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("doctitle") or "")).strip()
        dt = parse_date(str(r.get("docreltime") or ""), now)
        url = str(r.get("docpuburl") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin("https://www.shfe.com.cn", url),
                      "date": dt})
    return items


# ---------------------------------------------------------------- 政策栏目适配器

def _top_level(text: str, tag: str):
    """返回 text 里所有顶层 <tag> 的内部 HTML（能正确处理嵌套同名标签）。"""
    out, depth, start = [], 0, None
    for m in re.finditer(r"(?is)<%s\b[^>]*>|</%s\s*>" % (tag, tag), text):
        if m.group(0).startswith("</"):
            depth -= 1
            if depth == 0 and start is not None:
                out.append(text[start:m.start()])
                start = None
        else:
            if depth == 0:
                start = m.end()
            depth += 1
    return out


def parse_pbc_rule(text: str, src: "Source", now: datetime):
    """央行法规三栏：newslist_style 切块，标题只能信 title 属性。"""
    items = []
    for chunk in re.split(r'(?is)<font class="newslist_style"', text)[1:]:
        chunk = re.split(r"(?is)</tr>|<li[\s>]", chunk)[0]
        m = re.search(r'(?is)<a\s[^>]*href="([^"]+)"[^>]*>', chunk)
        if not m:
            continue
        t = re.search(r'\stitle="([^"]+)"', m.group(0))
        title = html_mod.unescape(t.group(1)) if t else ""
        d = re.search(r"(20\d{2}-\d{2}-\d{2})", chunk)
        dt = parse_date(d.group(1), now) if d else None
        if len(title) < 4 or not dt:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin(src.home or src.url, m.group(1)),
                      "date": dt})
    return items


MOF_LI = re.compile(
    r"""(?is)<li>\s*<a[^>]*href="([^"]+)"[^>]*title='([^']*)'[^>]*>.*?</a>\s*"""
    r"""<span[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*</span>""")


MOF_LI2 = re.compile(
    r"""(?is)<li>\s*<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>.*?</a>\s*"""
    r"""<span[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*</span>""")


def parse_mof_policy(text: str, src: "Source", now: datetime):
    """财政部：主站 title 用单引号、会计司子站用双引号，两种都认。"""
    items = []
    rows = MOF_LI.findall(text) or MOF_LI2.findall(text)
    for href, title, d in rows:
        title = re.sub(r"\s+", " ", html_mod.unescape(title)).strip()
        dt = parse_date(d, now)
        if len(title) < 4 or not dt:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin(src.home or src.url,
                                                   html_mod.unescape(href)),
                      "date": dt})
    return items


def parse_ndrc(text: str, src: "Source", now: datetime):
    """发改委：列表里每条嵌了 popbox「相关解读」，必须按顶层 <li> 切块。"""
    h = re.sub(r"(?is)<!--.*?-->", "", text)
    m = re.search(r'(?is)<ul[^>]*class="u-list"[^>]*>', h)
    region = h[m.end():] if m else h
    items = []
    for block in _top_level(region, "li"):
        a = re.search(r'(?is)<a\s[^>]*href="([^"]+)"[^>]*>', block)
        if not a:
            continue
        t = re.search(r'\stitle="([^"]*)"', a.group(0))
        title = html_mod.unescape(t.group(1)) if t else ""
        title = re.sub(r"\s+", " ", title).strip()
        d = re.search(r"(20\d{2}/\d{1,2}/\d{1,2})", block)
        dt = parse_date(d.group(1), now) if d else None
        if len(title) < 4 or not dt:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin(src.home or src.url, a.group(1)),
                      "date": dt})
    return items


SAFE_LI = re.compile(
    r"""(?is)<li>\s*<dt[^>]*>\s*<a\b[^>]*?href="([^"]+)"[^>]*?title="([^"]*)"[^>]*>"""
    r""".*?</dt>\s*<dd[^>]*>\s*(\d{4}-\d{2}-\d{2})""")


def parse_safe_policy(text: str, src: "Source", now: datetime):
    """外汇局：<li><dt><a title>…</dt><dd>2026-10-27</dd></li>。"""
    items = []
    for href, title, d in SAFE_LI.findall(text):
        title = re.sub(r"\s+", " ", html_mod.unescape(title)).strip()
        dt = parse_date(d, now)
        if len(title) < 4 or not dt:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin(src.home or src.url, href),
                      "date": dt})
    return items


def parse_tax_policy(text: str, src: "Source", now: datetime):
    """税务总局政策发布：getFileListByCodeId 返回 JSON。"""
    d = json.loads(text)
    rows = (((d.get("results") or {}).get("data") or {}).get("results")) or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        dt = parse_date(str(r.get("publishedTimeStr") or "")[:10], now)
        url = r.get("url") or ""
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


def parse_tax_jiedu(text: str, src: "Source", now: datetime):
    """税务总局政策解读：search5 返回 JSON，标题带 <em> 高亮。"""
    d = json.loads(text)
    rows = (d.get("searchResultAll") or {}).get("searchTotal") or []
    items = []
    for r in rows:
        title = html_mod.unescape(re.sub(r"<[^>]+>", "", str(r.get("title") or "")))
        title = re.sub(r"\s+", " ", title).strip()
        dt = parse_date(str(r.get("cwrq") or "")[:10], now)
        url = r.get("url") or ""
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


TAX_MS = re.compile(
    r"""(?is)<li[^>]*>\s*<a[^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>\s*"""
    r"""<span[^>]*>\s*\[(\d{4}-\d{2}-\d{2})\]\s*</span>""")


def parse_tax_manuscript(text: str, src: "Source", now: datetime):
    """税务总局 CMS 列表：日期是 [2026-09-01]；只在列表区内匹配，避免抓到导航。"""
    m = re.search(r'(?is)<ul[^>]*class="list"[^>]*>', text)
    region = text[m.end():] if m else text
    items = []
    for url, raw, d in TAX_MS.findall(region):
        title = re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", "", raw))).strip()
        dt = parse_date(d, now)
        if len(title) < 4 or not dt:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items

# ---------------------------------------------------------------- 源清单

def build_sources():
    """按用户口径只收政策类栏目：一条栏目 = 一个源，页面上仍显示同一机关简称。"""
    S = Source
    q = urllib.parse.urlencode
    return [
        # ---- 人民银行：只要行政法规 / 部门规章 / 规范性文件 ----
        S("pbc_xzfg", "中国人民银行·行政法规",
          "https://www.pbc.gov.cn/tiaofasi/144941/144953/index.html",
          parser=parse_pbc_rule, home="https://www.pbc.gov.cn/",
          short="人民银行", channel="行政法规", cutoff_days=1500),
        S("pbc_bmgz", "中国人民银行·部门规章",
          "https://www.pbc.gov.cn/tiaofasi/144941/144957/index.html",
          parser=parse_pbc_rule, home="https://www.pbc.gov.cn/",
          short="人民银行", channel="部门规章", cutoff_days=600),
        S("pbc_gfxwj", "中国人民银行·规范性文件",
          "https://www.pbc.gov.cn/tiaofasi/144941/3581332/index.html",
          parser=parse_pbc_rule, home="https://www.pbc.gov.cn/",
          short="人民银行", channel="规范性文件", cutoff_days=200),

        # ---- 财政部：政策发布 / 政策解读 / 会计司同两栏 ----
        S("mof_zcfb", "财政部·政策发布",
          "https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/",
          parser=parse_mof_policy, home="https://www.mof.gov.cn/",
          short="财政部", channel="政策发布", cutoff_days=200),
        S("mof_zcjd", "财政部·政策解读",
          "https://www.mof.gov.cn/zhengwuxinxi/zhengcejiedu/",
          parser=parse_mof_policy, home="https://www.mof.gov.cn/",
          short="财政部", channel="政策解读", cutoff_days=200),
        S("mof_kjs", "财政部会计司·政策发布",
          "https://kjs.mof.gov.cn/zhengcefabu/",
          parser=parse_mof_policy, home="https://kjs.mof.gov.cn/",
          short="会计司", channel="政策发布", cutoff_days=400),
        S("mof_kjs_jd", "财政部会计司·政策解读",
          "https://kjs.mof.gov.cn/zhengcejiedu/",
          parser=parse_mof_policy, home="https://kjs.mof.gov.cn/",
          short="会计司", channel="政策解读", cutoff_days=400),

        # ---- 金监总局：政策发布 / 政策解读(两栏并集) / 征求意见 ----
        S("nfra_zcfg", "国家金融监督管理总局·政策发布",
          "https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild"
          "?itemId=928&pageSize=20&pageIndex=1",
          parser=parse_nfra, encoding="utf-8-sig",
          home="https://www.nfra.gov.cn/", short="金监总局",
          channel="政策发布", cutoff_days=300),
        S("nfra_zcjd_a", "国家金融监督管理总局·政策解读",
          "https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild"
          "?itemId=917&pageSize=20&pageIndex=1",
          parser=parse_nfra, encoding="utf-8-sig",
          home="https://www.nfra.gov.cn/", short="金监总局",
          channel="政策解读", cutoff_days=300),
        S("nfra_zcjd_b", "国家金融监督管理总局·政策解读(父栏)",
          "https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild"
          "?itemId=916&pageSize=20&pageIndex=1",
          parser=parse_nfra, encoding="utf-8-sig",
          home="https://www.nfra.gov.cn/", short="金监总局",
          channel="政策解读", cutoff_days=300),
        S("nfra_zqyj", "国家金融监督管理总局·征求意见",
          "https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild"
          "?itemId=951&pageSize=20&pageIndex=1",
          parser=parse_nfra, encoding="utf-8-sig",
          home="https://www.nfra.gov.cn/", short="金监总局",
          channel="征求意见", cutoff_days=400),

        # ---- 证监会：证监会令 / 证监会公告 ----
        S("csrc_ling", "中国证监会·证监会令",
          "https://www.csrc.gov.cn/searchList/cd11df89f5894c1eac37ae37cc11e369"
          "?_isAgg=true&_isJson=true&_pageSize=20&_template=index"
          "&_rangeTimeGte=&_channelName=&page=1",
          parser=parse_csrc, home="https://www.csrc.gov.cn/",
          short="证监会", channel="证监会令", cutoff_days=600),
        S("csrc_gg", "中国证监会·证监会公告",
          "https://www.csrc.gov.cn/searchList/625a2f95cc104c1d8b646f98d9f87470"
          "?_isAgg=true&_isJson=true&_pageSize=20&_template=index"
          "&_rangeTimeGte=&_channelName=&page=1",
          parser=parse_csrc, home="https://www.csrc.gov.cn/",
          short="证监会", channel="证监会公告", cutoff_days=200),

        # ---- 票交所：通知公告 / 票据研究 ----
        S("shcpe_tzgg", "上海票据交易所·通知公告",
          "http://www.shcpe.com.cn/shcpe-cos/article/list",
          headers={"Content-Type": "application/json;charset=utf-8",
                   "Accept": "application/json"},
          body=json.dumps({"requestTime": "2026-10-28 00:00:00",
                           "requestSystem": "shcpe-web", "requestNo": "1",
                           "pageSize": 50, "pageNum": 1,
                           "typeCode": "news-announce"}, ensure_ascii=False),
          parser=parse_shcpe, home="http://www.shcpe.com.cn/",
          short="票交所", channel="通知公告", cutoff_days=300),
        S("shcpe_pjyj", "上海票据交易所·票据研究",
          "http://www.shcpe.com.cn/shcpe-cos/article/list",
          headers={"Content-Type": "application/json;charset=utf-8",
                   "Accept": "application/json"},
          body=json.dumps({"requestTime": "2026-10-28 00:00:00",
                           "requestSystem": "shcpe-web", "requestNo": "2",
                           "pageSize": 50, "pageNum": 1,
                           "typeCode": "research-pjyj"}, ensure_ascii=False),
          parser=parse_shcpe, home="http://www.shcpe.com.cn/",
          short="票交所", channel="票据研究", cutoff_days=2000),

        # ---- 税务总局：政策发布 / 政策解读 / 意见征集 / 税案通报 ----
        S("tax_zcfb", "国家税务总局·政策发布",
          "https://www.chinatax.gov.cn/getFileListByCodeId",
          headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                   "X-Requested-With": "XMLHttpRequest"},
          body="codeId=&channelId=29a88b67e4b149cfa9fac7919dfb08a5&page=1&size=50",
          parser=parse_tax_policy, home="https://www.chinatax.gov.cn/",
          short="税务总局", channel="政策发布", cutoff_days=200),
        S("tax_zcjd", "国家税务总局·政策解读",
          "https://www.chinatax.gov.cn/search5/search/s?" + q(
              {"siteCode": "bm29000002", "searchWord": "", "type": "1",
               "xxgkResolveType": "文字", "pageNum": "0", "pageSize": "10",
               "cwrqStart": "", "cwrqEnd": "", "column": "政策解读",
               "likeDoc": "0", "wordPlace": "0", "videoreSolveType": ""}),
          parser=parse_tax_jiedu, home="https://www.chinatax.gov.cn/",
          short="税务总局", channel="政策解读", cutoff_days=200),
        S("tax_yjzj", "国家税务总局·意见征集",
          "https://www.chinatax.gov.cn/chinatax/manuscriptList/n810961?" + q(
              {"_isAgg": "0", "_pageSize": "20", "_template": "index",
               "_channelName": "意见征集", "_keyWH": "wenhao", "page": "1"}),
          parser=parse_tax_manuscript, home="https://www.chinatax.gov.cn/",
          short="税务总局", channel="意见征集", cutoff_days=600),
        S("tax_satb", "国家税务总局·税案通报",
          "https://www.chinatax.gov.cn/chinatax/manuscriptList/c102025?" + q(
              {"_isAgg": "0", "_pageSize": "20", "_template": "index",
               "_channelName": "税案通报", "_keyWH": "wenhao", "page": "1"}),
          parser=parse_tax_manuscript, home="https://www.chinatax.gov.cn/",
          short="税务总局", channel="税案通报", cutoff_days=200),

        # ---- 发改委：令 / 规范性文件 / 规划文本 / 公告 / 通知 / 解读 ----
        S("ndrc_wl", "国家发展改革委·发展改革委令",
          "https://www.ndrc.gov.cn/xxgk/zcfb/fzggwl/",
          parser=parse_ndrc, home="https://www.ndrc.gov.cn/",
          short="发改委", channel="发展改革委令", cutoff_days=400),
        S("ndrc_gfxwj", "国家发展改革委·规范性文件",
          "https://www.ndrc.gov.cn/xxgk/zcfb/ghxwj/",
          parser=parse_ndrc, home="https://www.ndrc.gov.cn/",
          short="发改委", channel="规范性文件", cutoff_days=600),
        S("ndrc_ghwb", "国家发展改革委·规划文本",
          "https://www.ndrc.gov.cn/xxgk/zcfb/ghwb/",
          parser=parse_ndrc, home="https://www.ndrc.gov.cn/",
          short="发改委", channel="规划文本", cutoff_days=1500),
        S("ndrc_gg", "国家发展改革委·公告",
          "https://www.ndrc.gov.cn/xxgk/zcfb/gg/",
          parser=parse_ndrc, home="https://www.ndrc.gov.cn/",
          short="发改委", channel="公告", cutoff_days=400),
        S("ndrc_tz", "国家发展改革委·通知",
          "https://www.ndrc.gov.cn/xxgk/zcfb/tz/",
          parser=parse_ndrc, home="https://www.ndrc.gov.cn/",
          short="发改委", channel="通知", cutoff_days=200),
        S("ndrc_jd", "国家发展改革委·解读",
          "https://www.ndrc.gov.cn/xxgk/jd/jd/",
          parser=parse_ndrc, home="https://www.ndrc.gov.cn/",
          short="发改委", channel="解读", cutoff_days=300),

        # ---- 外汇局：政策法规解读 ----
        S("safe_zcfgjd", "国家外汇管理局·政策法规解读",
          "https://www.safe.gov.cn/safe/zcfgjd/",
          parser=parse_safe_policy, home="https://www.safe.gov.cn/",
          short="外汇局", channel="政策法规解读", cutoff_days=500),

        # ---- 其余机构维持原样 ----
        S("cffex", "中国金融期货交易所·公告", "http://www.cffex.com.cn/cn/jysgg.html",
          home="http://www.cffex.com.cn/", short="中金所", channel="公告"),
        S("cffex_tz", "中国金融期货交易所·通知", "http://www.cffex.com.cn/cn/jystz.html",
          link_re=r"/cn/jystz/\d{8}/\d+\.html", home="http://www.cffex.com.cn/",
          short="中金所", channel="通知"),
        S("bse", "北京证券交易所", "https://www.bse.cn/info/listse.do",
          kind="custom", parser=parse_bse, home="https://www.bse.cn/", short="北交所"),
        S("amac", "中国证券投资基金业协会", "https://www.amac.org.cn/xwfb/tzgg/",
          link_re=r"\./\d{6}/t\d{8}_\d+\.html", home="https://www.amac.org.cn/",
          short="中基协"),
        S("nafmii", "交易商协会", "https://www.nafmii.org.cn/ggtz/tz/",
          link_re=r"\./\d{6}/t\d{8}_\d+\.html", home="https://www.nafmii.org.cn/",
          short="交易商协会"),
    ]


INDEX_TMPL = """<!doctype html>
<html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>机构公告速递</title>
<style>
:root{--fg:#1a1a1a;--dim:#8a8a8a;--line:#ececec;--link:#0a5bd4;--bg:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#e6e6e6;--dim:#8f8f8f;--line:#2a2a2a;--link:#6aa9ff;--bg:#161616}}
*{box-sizing:border-box}
body{font:16px/1.75 -apple-system,BlinkMacSystemFont,"Noto Sans SC","PingFang SC",sans-serif;
     max-width:52rem;margin:3rem auto;padding:0 1.2rem;color:var(--fg);background:var(--bg)}
h1{font-size:1.45rem;margin:0 0 1.6rem}
ul{list-style:none;padding:0;margin:0}
.hd,li{display:grid;grid-template-columns:5.6rem minmax(0,1fr) 7rem;
       column-gap:.85rem;align-items:center}
.hd{padding:.5rem .2rem;border-bottom:2px solid var(--line);
    font-size:.82rem;color:var(--dim);position:sticky;top:0;background:var(--bg);z-index:1}
.hd [data-sort]{cursor:pointer;user-select:none;white-space:nowrap}
.hd [data-sort]:hover{color:var(--fg)}
.hd [data-sort].active{color:var(--fg);font-weight:600}
.hd .arrow{font-size:.7em}
.hd .c-title,.hd .c-src{text-align:center}
li{padding:.55rem .2rem;border-bottom:1px solid var(--line)}
li time{color:var(--dim);font-size:.82rem;font-variant-numeric:tabular-nums;white-space:nowrap}
li .s{color:var(--dim);font-size:.78rem;text-align:center;white-space:nowrap;justify-self:center}
a.t{color:var(--link);text-decoration:none;display:block;line-height:1.42;
    text-indent:0;overflow-wrap:anywhere;text-wrap:pretty;
    transition:color .18s ease,opacity .18s ease}
a.t:hover{text-decoration:underline}
a.t.read{color:var(--dim);opacity:.62}
.pager{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;
       margin:1.8rem 0 1.4rem;font-size:.88rem}
.pager a,.pager span{border:1px solid var(--line);border-radius:.4rem;
       padding:.28rem .6rem;text-decoration:none;color:var(--link);
       min-width:2.1rem;text-align:center}
.pager a:hover{border-color:var(--link);background:rgba(10,91,212,.06)}
.pager .cur{background:var(--link);border-color:var(--link);color:#fff;font-weight:600}
.pager .off{color:var(--dim);border-color:var(--line);pointer-events:none;opacity:.5}
.pager .gap{border:0;color:var(--dim);min-width:1rem}
.foot{border-top:1px solid var(--line);padding-top:.9rem;margin:0 0 3rem;
      color:var(--dim);font-size:.85rem;line-height:1.95}
.foot p{margin:.15rem 0}
.foot b{color:var(--fg);font-weight:600}
.foot button{font:inherit;color:var(--link);background:none;
      border:1px solid var(--line);border-radius:.35rem;
      padding:.12rem .5rem;margin-left:.4rem;cursor:pointer}
.foot button:hover{border-color:var(--link)}
.foot .hint{opacity:.75}
@media (max-width:560px){
  .hd,li{grid-template-columns:5.2rem minmax(0,1fr)}
  .hd .c-src,li .s{display:none}
}
</style></head><body>
<h1>机构公告速递</h1>

<div class="hd">
  <span data-sort="date" class="active">日期<span class="arrow"></span></span>
  <span class="c-title">主题</span>
  <span data-sort="src" class="c-src">发文机关<span class="arrow"></span></span>
</div>
<ul id="list">
__ROWS__
</ul>
<nav class="pager">__NAV__</nav>

<footer class="foot">
  <p>央行、监管、交易所与金融基础设施的官方公告聚合 · 共 __COUNT__ 条 · 第 __PAGE__/__PAGES__ 页 · 更新于 __NOW__ (UTC+8)</p>
  <p>兴趣学习：<b id="hits">0</b> 次点击 · 覆盖 <b id="kinds">0</b> 项机关/栏目/主题 · 最后记录 <b id="last">—</b>
     <button id="mode" type="button">按时间</button>
     <button id="exp" type="button">导出</button>
     <button id="imp" type="button">导入</button>
     <button id="reset" type="button">重置</button></p>
  <p class="hint">记录同时写入 localStorage、IndexedDB 和 Cookie，清缓存只清掉其中一层时不会丢；
     换电脑/换浏览器用「导出」拿到 JSON，再到新设备「导入」即可接着学。</p>
  <input type="file" id="file" accept="application/json" hidden>
</footer>

<script>window.NF={page:__PAGE__,per:__PER__,pages:__PAGES__,data:__DATA__};</script>
<script>
(function(){
  var NF = window.NF || {data:[]};
  var data = NF.data || [], PAGE = NF.page || 1, PER = NF.per || 30;
  var TOPICS = ['会计准则','会计','税务','税收','处罚','征求意见','债券','票据','期货','期权',
    '私募','基金','保险','银行','支付','反洗钱','跨境','外汇','退市','上市','信息披露',
    '公司治理','数据','绿色','普惠','房地产','地方债','评级','信托','理财','托管','清算',
    '结算','交易规则','适当性','监管','资本','风险'];

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                     .replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function lsGet(k, d){ try{ var v = localStorage.getItem('nf_' + k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function lsSet(k, v){ try{ localStorage.setItem('nf_' + k, JSON.stringify(v)); }catch(e){} }

  /* ---------- IndexedDB：比 localStorage 更耐清缓存 ---------- */
  var idb = (function(){
    var db = null, ready = false, queue = [];
    try {
      var req = window.indexedDB && indexedDB.open('nf_store', 1);
      if (req) {
        req.onupgradeneeded = function(e){ e.target.result.createObjectStore('kv'); };
        req.onsuccess = function(e){
          db = e.target.result; ready = true;
          for (var i = 0; i < queue.length; i++) queue[i]();
          queue = [];
        };
        req.onerror = function(){ ready = false; };
      }
    } catch(e){}
    function tx(mode){ return db.transaction('kv', mode).objectStore('kv'); }
    return {
      get: function(k, cb){
        function run(){ try{ var r = tx('readonly').get(k);
          r.onsuccess = function(){ cb(r.result || null); }; r.onerror = function(){ cb(null); };
        }catch(e){ cb(null); } }
        if (ready) run(); else queue.push(run);
      },
      set: function(k, v){
        function run(){ try{ tx('readwrite').put(v, k); }catch(e){} }
        if (ready) run(); else queue.push(run);
      }
    };
  })();

  /* ---------- Cookie：第三层兜底（只放兴趣，体积小） ---------- */
  function cookieGet(){
    try {
      var m = document.cookie.match(/(?:^|;\\s*)nf_aff=([^;]+)/);
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch(e){ return null; }
  }
  function cookieSet(p){
    try {
      var s = JSON.stringify(p);
      if (s.length < 3500) document.cookie = 'nf_aff=' + encodeURIComponent(s)
        + ';path=/;max-age=31536000;SameSite=Lax';
    } catch(e){}
  }

  var aff  = lsGet('aff', null);
  var read = lsGet('read', null) || {};

  function blank(){ return {src:{}, ch:{}, topic:{}, ts:0}; }
  function newer(a, b){ return ((b && b.ts) || 0) > ((a && a.ts) || 0) ? b : a; }

  aff = newer(aff, cookieGet()) || blank();
  if (!aff.src) aff.src = {};
  if (!aff.ch) aff.ch = {};
  if (!aff.topic) aff.topic = {};

  var mode = lsGet('mode', 'time');

  function topicsOf(t){
    var out = [];
    for (var i = 0; i < TOPICS.length; i++) if (t.indexOf(TOPICS[i]) >= 0) out.push(TOPICS[i]);
    return out;
  }
  function w(n){ return n > 0 ? Math.log(1 + n) : 0; }
  function score(it){
    var s = 3 * w(aff.src[it.s] || 0) + 2 * w(aff.ch[it.s + '|' + it.c] || 0);
    var tp = topicsOf(it.t);
    for (var i = 0; i < tp.length; i++) s += 2 * w(aff.topic[tp[i]] || 0);
    var days = (Date.now() - Date.parse(it.d)) / 86400000;
    if (days >= 0 && days < 60) s += (60 - days) / 60 * 2.5;
    return s;
  }
  function hits(){
    var n = 0, k;
    for (k in aff.src) n += aff.src[k];
    return n;
  }
  function kinds(){
    return Object.keys(aff.src).length + Object.keys(aff.ch).length
         + Object.keys(aff.topic).length;
  }

  /* ---------- 持久化：一次写三层 ---------- */
  function pack(){
    aff.ts = Date.now();
    return {v:1, ts:aff.ts, src:aff.src, ch:aff.ch, topic:aff.topic};
  }
  function save(){
    var p = pack();
    lsSet('aff', p);
    cookieSet(p);
    idb.set('aff', p);
    lsSet('read', read);
    idb.set('read', read);
    paint();
  }
  function paint(){
    var h = document.getElementById('hits');
    if (h) h.textContent = String(hits());
    var k = document.getElementById('kinds');
    if (k) k.textContent = String(kinds());
    var l = document.getElementById('last');
    if (l) l.textContent = aff.ts ? new Date(aff.ts).toLocaleString('zh-CN', {hour12:false}) : '—';
  }

  /* ---------- 学习 ---------- */
  function learn(a){
    var s = a.dataset.src || '', c = a.dataset.ch || '', t = a.textContent || '';
    if (s) aff.src[s] = (aff.src[s] || 0) + 1;
    if (s && c) aff.ch[s + '|' + c] = (aff.ch[s + '|' + c] || 0) + 1;
    var tp = topicsOf(t);
    for (var i = 0; i < tp.length; i++) aff.topic[tp[i]] = (aff.topic[tp[i]] || 0) + 1;
    save();
  }

  /* ---------- 渲染 ---------- */
  function liHTML(it){
    var k = it.u || it.t;
    var cls = 't' + (read[k] ? ' read' : '');
    var tip = it.s + (it.c ? '·' + it.c : '');
    return '<li data-date="' + it.d + ' 00:00" data-src="' + esc(it.s) + '">'
         + '<time datetime="' + it.d + '" title="' + it.d + '">' + it.d + '</time>'
         + '<a class="' + cls + '" href="' + esc(it.u) + '" data-k="' + esc(k) + '"'
         + ' data-src="' + esc(it.s) + '" data-ch="' + esc(it.c || '') + '"'
         + ' target="_blank" rel="noopener">' + esc(it.t) + '</a>'
         + '<span class="s" title="' + esc(tip) + '">' + esc(it.s) + '</span></li>';
  }

  function bind(){
    var links = document.querySelectorAll('#list a.t');
    for (var i = 0; i < links.length; i++) (function(a){
      var k = a.dataset.k;
      if (read[k]) a.classList.add('read');
      a.addEventListener('click', function(ev){
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) { learn(a); return; }
        ev.preventDefault();
        var w = window.open(a.href, '_blank');
        if (w) { try { w.opener = null; } catch(e){} window.focus(); } else { location.href = a.href; }
        a.classList.add('read');
        read[k] = 1;
        learn(a);
      });
    })(links[i]);
  }

  function render(){
    var list = document.getElementById('list');
    if (!list) return;
    var items = data.slice();
    if (mode === 'interest') {
      items.sort(function(a, b){
        var d = score(b) - score(a);
        if (d) return d;
        return a.d < b.d ? 1 : (a.d > b.d ? -1 : 0);
      });
    }
    var from = (PAGE - 1) * PER;
    list.innerHTML = items.slice(from, from + PER).map(liHTML).join('');
    bind();
    var btn = document.getElementById('mode');
    if (btn) btn.textContent = mode === 'interest' ? '按兴趣' : '按时间';
    paint();
  }

  /* ---------- 表头排序（只作用于当前页 DOM） ---------- */
  var sortState = {key:'date', dir:'desc'};
  function markHead(){
    var hs = document.querySelectorAll('[data-sort]');
    for (var i = 0; i < hs.length; i++){
      var ar = hs[i].querySelector('.arrow');
      if (ar) ar.textContent = (hs[i].dataset.sort === sortState.key)
        ? (sortState.dir === 'asc' ? ' \\u25b2' : ' \\u25bc') : '';
      hs[i].classList.toggle('active', hs[i].dataset.sort === sortState.key);
    }
  }
  function applySort(key){
    var list = document.getElementById('list');
    if (!list) return;
    if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    else { sortState.key = key; sortState.dir = key === 'date' ? 'desc' : 'asc'; }
    var items = Array.prototype.slice.call(list.children);
    items.sort(function(a, b){
      var x = key === 'date' ? a.dataset.date : (a.dataset.src || '');
      var y = key === 'date' ? b.dataset.date : (b.dataset.src || '');
      var r = key === 'date' ? (x < y ? -1 : x > y ? 1 : 0) : x.localeCompare(y, 'zh-Hans-CN');
      return sortState.dir === 'asc' ? r : -r;
    });
    for (var i = 0; i < items.length; i++) list.appendChild(items[i]);
    markHead();
  }
  (function(){
    var hs = document.querySelectorAll('[data-sort]');
    for (var i = 0; i < hs.length; i++) (function(el){
      el.addEventListener('click', function(){ applySort(el.dataset.sort); });
    })(hs[i]);
    markHead();
  })();

  /* ---------- 按钮 ---------- */
  var btnMode = document.getElementById('mode');
  if (btnMode) btnMode.addEventListener('click', function(){
    mode = mode === 'interest' ? 'time' : 'interest';
    lsSet('mode', mode);
    if (mode === 'time') location.reload(); else render();
  });

  var btnExp = document.getElementById('exp');
  if (btnExp) btnExp.addEventListener('click', function(){
    var blob = new Blob([JSON.stringify(pack(), null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nf-affinity-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  var fileInput = document.getElementById('file');
  var btnImp = document.getElementById('imp');
  if (btnImp && fileInput) {
    btnImp.addEventListener('click', function(){ fileInput.click(); });
    fileInput.addEventListener('change', function(){
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function(){
        try {
          var o = JSON.parse(fr.result);
          ['src','ch','topic'].forEach(function(k){
            var src = o[k] || {}, dst = aff[k];
            for (var key in src) dst[key] = (dst[key] || 0) + src[key];   // 合并而不是覆盖
          });
          save();
          location.reload();
        } catch(e){ alert('这个文件读不出来，需要本页「导出」出来的 JSON。'); }
      };
      fr.readAsText(f);
    });
  }

  var btnReset = document.getElementById('reset');
  if (btnReset) btnReset.addEventListener('click', function(){
    if (!confirm('清空本机记住的点击记录？导出过的 JSON 不受影响。')) return;
    aff = blank(); read = {};
    try { localStorage.removeItem('nf_aff'); localStorage.removeItem('nf_mode');
          localStorage.removeItem('nf_read'); } catch(e){}
    try { document.cookie = 'nf_aff=;path=/;max-age=0'; } catch(e){}
    try { idb.set('aff', null); idb.set('read', null); } catch(e){}
    location.reload();
  });

  /* ---------- 启动：以时间戳最新的那份为准 ---------- */
  var booted = false;
  function boot(){
    if (booted) return;
    booted = true;
    paint();
    if (mode === 'interest') render(); else bind();
  }
  idb.get('aff', function(v){
    var best = newer(aff, v);
    if (best && best !== aff) {
      aff = best;
      if (!aff.src) aff.src = {};
      if (!aff.ch) aff.ch = {};
      if (!aff.topic) aff.topic = {};
    }
    idb.get('read', function(r){
      if (r && Object.keys(r).length > Object.keys(read).length) read = r;
      boot();
    });
  });
  setTimeout(boot, 600);   // 浏览器禁用 IndexedDB 时也能正常启动
})();
</script>
</body></html>
"""

PER_PAGE = 30


def page_url(n: int) -> str:
    return "/news/" if n == 1 else f"/news/page/{n}/"


def _nav(page_no: int, total_pages: int) -> str:
    """上一页 / 页码 / 下一页。"""
    if total_pages <= 1:
        return ""
    out = []
    out.append(f'<a href="{page_url(page_no - 1)}">\u2039 \u4e0a\u4e00\u9875</a>' if page_no > 1
               else '<span class="off">\u2039 \u4e0a\u4e00\u9875</span>')
    shown = {1, total_pages} | set(range(max(1, page_no - 2), min(total_pages, page_no + 2) + 1))
    prev = 0
    for n in sorted(shown):
        if prev and n - prev > 1:
            out.append('<span class="gap">\u2026</span>')
        out.append(f'<span class="cur">{n}</span>' if n == page_no
                   else f'<a href="{page_url(n)}">{n}</a>')
        prev = n
    out.append(f'<a href="{page_url(page_no + 1)}">\u4e0b\u4e00\u9875 \u203a</a>'
               if page_no < total_pages else '<span class="off">\u4e0b\u4e00\u9875 \u203a</span>')
    return "".join(out)


def paginate(items, per_page: int = PER_PAGE, per_source_cap: int = 12, now=None):
    """轮转合并后切页：每源先截到 per_source_cap 条，保证每页各机关都有份。

    先按轮转顺序把各源的新条目交错排（上期所、票交所这类高频站不会占满一页），
    再按 per_page 切块，块内按日期倒序，翻到最后一页也还是均衡的。
    """
    by_src = {}
    for it in sorted(items, key=lambda x: x["date"], reverse=True):
        k = it.get("sid") or it.get("short") or it["source"]
        bucket = by_src.setdefault(k, [])
        if len(bucket) < per_source_cap:
            bucket.append(it)

    order = sorted(by_src)                      # 固定顺序，翻页结果可复现
    seq, i = [], 0
    while any(by_src[k] for k in order):
        k = order[i % len(order)]
        if by_src[k]:
            seq.append(by_src[k].pop(0))
        i += 1

    if now is not None:                      # 半年前的条目统一压到最后
        cut = now - timedelta(days=180)
        fresh = [x for x in seq if x["date"] >= cut]
        stale = [x for x in seq if x["date"] < cut]
        stale.sort(key=lambda x: x["date"], reverse=True)
        seq = fresh + stale

    pages = [seq[i:i + per_page] for i in range(0, len(seq), per_page)]
    for pg in pages:
        pg.sort(key=lambda x: x["date"], reverse=True)
    return [pg for pg in pages if pg]


def _li_html(it) -> str:
    stamp = it["date"].strftime("%Y-%m-%d")
    key = escape(it["link"] or it["title"], {'"': "&quot;"})
    short = escape(it.get("short") or it["source"])
    ch = escape(it.get("channel") or "")
    tip = escape((it.get("short") or it["source"])
                 + (("·" + it["channel"]) if it.get("channel") else ""))
    return (
        f'<li data-date="{stamp} 00:00" data-src="{short}">'
        f'<time datetime="{stamp}" title="{stamp}">{stamp}</time>'
        f'<a class="t" href="{escape(it["link"])}" data-k="{key}"'
        f' data-src="{short}" data-ch="{ch}" target="_blank" rel="noopener">'
        f'{escape(it["title"])}</a>'
        f'<span class="s" title="{tip}">{short}</span></li>'
    )


def build_index_html(items_all, now, page_no: int = 1, total_pages: int = 1,
                     total_items: int = 0):
    """每页都内嵌全量数据，供「按兴趣」在前端重排后取本页切片。"""
    per = PER_PAGE
    start = (page_no - 1) * per
    rows = [_li_html(it) for it in items_all[start:start + per]]

    payload = [{"d": it["date"].strftime("%Y-%m-%d"),
                "t": it["title"],
                "u": it["link"],
                "s": it.get("short") or it["source"],
                "c": it.get("channel") or ""} for it in items_all]
    data_json = (json.dumps(payload, ensure_ascii=False,
                            separators=(",", ":")).replace("</", "<\\/"))

    return (INDEX_TMPL
            .replace("__ROWS__", "\n".join(rows))
            .replace("__NAV__", _nav(page_no, total_pages))
            .replace("__PAGES__", str(total_pages))
            .replace("__PAGE__", str(page_no))
            .replace("__PER__", str(per))
            .replace("__COUNT__", str(total_items or len(items_all)))
            .replace("__DATA__", data_json)
            .replace("__NOW__", now.strftime("%Y-%m-%d %H:%M")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="public/news")
    ap.add_argument("--per-page", type=int, default=30)
    ap.add_argument("--per-source-cap", type=int, default=12)
    ap.add_argument("--only", default="")
    ap.add_argument("--keep-noise", action="store_true", help="不过滤领导活动/地方局/招聘类条目")
    args = ap.parse_args()

    now = datetime.now(CN_TZ)
    sources = [s for s in build_sources() if not args.only or s.id in args.only.split(",")]
    results, errors = {}, []

    def work(src: Source):
        try:
            if src.kind == "custom":
                return src.id, src.parser(None, src, now), None
            text, final = fetch(src)
            if src.parser:
                return src.id, src.parser(text, src, now), final
            return src.id, parse_generic_html(text, src, now), final
        except Exception as e:  # noqa: BLE001
            return src.id, e, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        for sid, res, _final in pool.map(work, sources):
            if isinstance(res, Exception):
                errors.append((sid, f"{type(res).__name__}: {res}"))
            else:
                results[sid] = res

    cutoff = now - timedelta(days=60)
    merged, seen = [], set()
    dropped = 0
    for src in sources:
        src_cutoff = now - timedelta(days=src.cutoff_days or 60)
        for it in results.get(src.id, []):
            if it["date"] < src_cutoff:
                continue
            if not args.keep_noise and NOISE_RE.search(it["title"]):
                dropped += 1
                continue
            it["source"] = src.name
            it["short"] = src.short
            it["sid"] = src.id
            it["channel"] = src.channel
            it["home"] = src.home
            key = re.sub(r"[?#].*$", "", it["link"] or "") or (it["source"] + it["title"])
            if key in seen:
                continue
            seen.add(key)
            merged.append(it)
    # 先保证每个有数据的源至少 1 条，再按时间补满，避免高频站点把低频站点挤掉
    per_source = {}
    for it in merged:
        per_source.setdefault(it["source"], []).append(it)
    for arr in per_source.values():
        arr.sort(key=lambda x: x["date"], reverse=True)

    # 轮转分配：每轮每个源取 1 条，避免高频站点（如中国政府网）挤掉低频的交易所
    queues = {name: list(arr) for name, arr in per_source.items()}
    picked = []
    while queues:
        for name in list(queues):
            arr = queues[name]
            if arr:
                picked.append(arr.pop(0))
            if not arr:
                del queues[name]
    merged = picked
    merged.sort(key=lambda x: x["date"], reverse=True)

    print(f"[info] {len(merged)} 条 / {len(sources)} 源，失败 {len(errors)} 个")
    for sid, err in errors:
        print(f"[warn] {sid}: {err}")
    for src in sources:
        n = len(results.get(src.id, []))
        if n == 0 and not any(e[0] == src.id for e in errors):
            print(f"[warn] {src.id}: 解析到 0 条")

    if not merged:
        print("[error] 没有任何条目，保留旧文件不覆盖")
        return 1

    pages = paginate(merged, args.per_page, args.per_source_cap, now)
    total = sum(len(pg) for pg in pages)
    flat = [it for pg in pages for it in pg]     # 与静态分页严格同序，供前端重排
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, pg in enumerate(pages, start=1):
        target = out_dir / "index.html" if i == 1 else out_dir / "page" / str(i) / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        html = build_index_html(flat, now, i, len(pages), total)
        target.write_text(html, encoding="utf-8")
    print(f"[ok] {total} 条 -> {len(pages)} 页 -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
