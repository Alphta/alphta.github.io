/**
 * 宏观信息日历 · 单月月历 / 年历视图 / 未来 7 天速览与分国别列表
 * 依赖：window.MACRO_EVENTS；挂载点：<div data-macro-calendar></div>
 * 可选：window.NF（新闻聚合数据，弹窗「相关公告」联动）、
 *       window.MACRO_ACTUALS（前值/预期/实际，形如 { "2026-09": { "cn-cpi": {...} } }）
 * 无框架、无外部依赖，纯原生 JS（ES5 语法，与站内其他脚本一致）。
 */
(function () {
  "use strict";

  var EVENTS = Array.isArray(window.MACRO_EVENTS) ? window.MACRO_EVENTS : [];
  var WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var REGIONS = {
    cn: { label: "中国" }, us: { label: "美国" },
    eu: { label: "欧洲" }, global: { label: "全球" }
  };
  var CATEGORIES = {
    data: { label: "数据" }, policy: { label: "政策" }, meeting: { label: "会议" }
  };
  var IMPORTANCE = {
    high: { label: "最重要", stars: "★★★", rank: 3 },
    medium: { label: "次重要", stars: "★★", rank: 2 },
    low: { label: "一般", stars: "★", rank: 1 }
  };
  var FREQ_CN = {
    monthly: "每月", quarterly: "每季", semiannual: "每半年",
    annual: "每年", multiple: "每年多次", weekly: "每周", irregular: "不定期"
  };

  var root = document.querySelector("[data-macro-calendar]");
  if (!root) return;
  if (!EVENTS.length) {
    root.textContent = "暂无事件数据。";
    return;
  }

  var NOW = new Date();
  var state = {
    year: NOW.getFullYear(), month: NOW.getMonth() + 1, view: "month",
    region: "all", category: "all", importance: [], query: ""
  };

  /* ─────────────── 工具函数 ─────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function validWeekday(w) {
    w = Number(w);
    return w >= 0 && w <= 6 && Math.floor(w) === w;
  }
  function monthText(y, m) { return y + " 年 " + m + " 月"; }
  function today0() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }

  function officialDatesForYear(ev, year) {
    if (!ev.datesByYear) return null;
    var dates = ev.datesByYear[String(year)];
    return Array.isArray(dates) ? dates : null;
  }

  /** 官方年度日程优先；否则按通常规则推算。weeklyWeekday 返回当月全部指定星期。 */
  function resolveDays(ev, year, month) {
    var dim = daysInMonth(year, month);
    var official = officialDatesForYear(ev, year);
    var d, w, out;
    if (official !== null) {
      out = [];
      official.forEach(function (date) {
        var match = typeof date === "string" && date.match(/^(\d{2})-(\d{2})$/);
        if (!match || Number(match[1]) !== month) return;
        d = Number(match[2]);
        if (d >= 1 && d <= dim && out.indexOf(d) === -1) out.push(d);
      });
      return out.sort(function (a, b) { return a - b; });
    }
    var p = ev.placement;
    if (p === "irregular") return [];
    if (p === "last") return [dim];
    if (p === "day") {
      d = Number(ev.day);
      if (!isFinite(d) || d < 1) return [];
      d = Math.floor(d);
      return d <= dim ? [d] : [];
    }
    if (p === "weeklyWeekday") {
      if (!validWeekday(ev.weekday)) return [];
      w = Number(ev.weekday);
      out = [];
      for (d = 1; d <= dim; d++) {
        if (new Date(year, month - 1, d).getDay() === w) out.push(d);
      }
      return out;
    }
    if (p === "firstWeekday") {
      if (!validWeekday(ev.weekday)) return [];
      w = Number(ev.weekday);
      for (d = 1; d <= 7; d++) {
        if (new Date(year, month - 1, d).getDay() === w) return [d];
      }
      return [];
    }
    if (p === "lastWeekday") {
      if (!validWeekday(ev.weekday)) return [];
      w = Number(ev.weekday);
      for (d = dim; d >= dim - 6; d--) {
        if (new Date(year, month - 1, d).getDay() === w) return [d];
      }
      return [];
    }
    return [];
  }

  function isOccurring(ev, month, year) {
    var official = officialDatesForYear(ev, year);
    if (official !== null) {
      return official.some(function (date) {
        return typeof date === "string" && date.slice(0, 2) === pad2(month) &&
          /^\d{2}-\d{2}$/.test(date);
      });
    }
    if (ev.frequency === "monthly" || ev.frequency === "weekly") return true;
    if (Array.isArray(ev.months) && ev.months.length) {
      return ev.months.indexOf(month) !== -1;
    }
    return true;
  }

  function matches(ev) {
    if (state.region !== "all" && ev.region !== state.region) return false;
    if (state.category !== "all" && ev.category !== state.category) return false;
    if (state.importance.length && state.importance.indexOf(ev.importance) === -1) return false;
    if (state.query) {
      var q = state.query.toLowerCase();
      var hay = [
        ev.name, ev.short, ev.window, ev.note, ev.source,
        REGIONS[ev.region] ? REGIONS[ev.region].label : "",
        CATEGORIES[ev.category] ? CATEGORIES[ev.category].label : ""
      ].join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      var ar = IMPORTANCE[a.importance] ? IMPORTANCE[a.importance].rank : 0;
      var br = IMPORTANCE[b.importance] ? IMPORTANCE[b.importance].rank : 0;
      return br - ar || a.name.localeCompare(b.name, "zh-Hans-CN");
    });
  }
  function monthItems() {
    return sortEvents(EVENTS.filter(matches).filter(function (ev) {
      return isOccurring(ev, state.month, state.year);
    }));
  }
  function regionLabel(ev) {
    return REGIONS[ev.region] ? REGIONS[ev.region].label : ev.region;
  }
  function catLabel(ev) {
    return CATEGORIES[ev.category] ? CATEGORIES[ev.category].label : ev.category;
  }
  function impLabel(ev) {
    return IMPORTANCE[ev.importance] ? IMPORTANCE[ev.importance].label : ev.importance;
  }
  function impStars(ev) {
    return IMPORTANCE[ev.importance] ? IMPORTANCE[ev.importance].stars : "";
  }
  function impRank(ev) {
    return IMPORTANCE[ev.importance] ? IMPORTANCE[ev.importance].rank : 0;
  }
  function freqLabel(ev) { return FREQ_CN[ev.frequency] || ev.frequency || ""; }
  function findEvent(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return null;
  }
  function shiftMonth(step) {
    var index = state.year * 12 + state.month - 1 + step;
    state.year = Math.floor(index / 12);
    state.month = (index % 12 + 12) % 12 + 1;
  }

  /* ─────────────── 跨视图查询：某日事件 / 下次发生 / 倒计时 ─────────────── */

  /** 某一天（按当前筛选）发生的事件，重要度优先。 */
  function eventsForDate(y, m, d) {
    return sortEvents(EVENTS.filter(matches).filter(function (ev) {
      return isOccurring(ev, m, y) && resolveDays(ev, y, m).indexOf(d) !== -1;
    }));
  }

  /** 从 from（零点）向后找事件最近一次发生日；找不到（如不定期）返回 null。 */
  function nextOccurrence(ev, from) {
    for (var i = 0; i < 25; i++) {
      var first = new Date(from.getFullYear(), from.getMonth() + i, 1);
      var y = first.getFullYear(), m = first.getMonth() + 1;
      if (!isOccurring(ev, m, y)) continue;
      var days = resolveDays(ev, y, m);
      for (var j = 0; j < days.length; j++) {
        var dt = new Date(y, m - 1, days[j]);
        if (dt >= from) {
          return { y: y, m: m, d: days[j], days: Math.round((dt - from) / 86400000) };
        }
      }
    }
    return null;
  }

  /** 高重要度事件的倒计时徽标文案；其余事件返回空串。 */
  function countdownLabel(ev, from) {
    if (ev.importance !== "high") return "";
    var n = nextOccurrence(ev, from);
    if (!n) return "";
    if (n.days === 0) return "今天";
    if (n.days === 1) return "明天";
    return n.days + " 天后";
  }

  /* ─────────────── 新闻聚合 / 实际值联动 ─────────────── */

  /** 在 window.NF.data 里找该事件的相关公告（发文机关 + 标题关键词）。 */
  function newsMatches(ev) {
    var m = ev.newsMatch;
    if (!m) return [];
    var db = window.NF && Array.isArray(window.NF.data) ? window.NF.data : [];
    var re = null;
    if (m.kw) {
      try { re = new RegExp(m.kw); } catch (e) { return []; }
    }
    var out = [];
    for (var i = 0; i < db.length && out.length < 5; i++) {
      var it = db[i];
      if (!it || !it.u || !it.t) continue;
      if (re && !re.test(it.t)) continue;
      if (m.src && m.src.length && m.src.indexOf(it.s) === -1) continue;
      out.push(it);
    }
    return out;
  }

  /** 最近一期已回填的前值/预期/实际；数据文件不存在时静默无此行。 */
  function actualFor(ev) {
    var db = window.MACRO_ACTUALS;
    if (!db || typeof db !== "object") return null;
    var now = new Date();
    var cur = now.getFullYear() * 100 + now.getMonth() + 1;
    var keys = Object.keys(db).filter(function (k) { return /^\d{4}-\d{2}$/.test(k); })
      .filter(function (k) {
        var p = k.split("-");
        return Number(p[0]) * 100 + Number(p[1]) <= cur;
      })
      .sort().reverse();
    for (var i = 0; i < keys.length; i++) {
      var rec = db[keys[i]] && db[keys[i]][ev.id];
      if (rec) return { period: keys[i], prev: rec.prev, cons: rec.cons, actual: rec.actual };
    }
    return null;
  }

  /* ─────────────── 骨架 ─────────────── */

  root.classList.add("macro-cal");
  root.innerHTML =
    '<div class="macro-cal__toolbar" role="toolbar" aria-label="日历控制">' +
      '<div class="macro-cal__controls">' +
        '<div class="macro-cal__monthnav">' +
          '<button type="button" class="macro-cal__navbtn" data-month-step="-1" aria-label="上一个月">‹</button>' +
          '<h2 class="macro-cal__monthtitle" id="mc-month-title" aria-live="polite"></h2>' +
          '<button type="button" class="macro-cal__navbtn" data-month-step="1" aria-label="下一个月">›</button>' +
          '<button type="button" class="macro-cal__today" data-today>今天</button>' +
          '<div class="macro-cal__views" role="group" aria-label="视图切换">' +
            '<button type="button" class="macro-cal__viewbtn is-active" data-view="month">月历</button>' +
            '<button type="button" class="macro-cal__viewbtn" data-view="year">年历</button>' +
          '</div>' +
          '<button type="button" class="macro-cal__action" data-ics ' +
            'title="按当前筛选，把 ' + NOW.getFullYear() + ' 年事件导出为日历文件">导出 .ics</button>' +
        '</div>' +
        '<div class="macro-cal__search">' +
          '<input type="search" id="mc-search" aria-label="搜索宏观事件" ' +
            'placeholder="搜索：CPI / FOMC / 社融 …" value="' + esc(state.query) + '">' +
        '</div>' +
      '</div>' +
      '<div class="macro-cal__filters">' +
        chipRow("region", "地区") + chipRow("category", "类别") +
        chipRow("importance", "重要度") +
      '</div>' +
    '</div>' +
    '<div class="macro-cal__upnext" id="mc-upnext" aria-label="未来 7 天"></div>' +
    '<div class="macro-cal__legend" id="mc-legend"></div>' +
    '<div class="macro-cal__scroll"><div class="macro-cal__calendarwrap" id="mc-monthwrap">' +
      '<div class="macro-cal__calendar">' +
        '<div class="macro-cal__weekdays">' +
          '<span>周一</span><span>周二</span><span>周三</span><span>周四</span>' +
          '<span>周五</span><span>周六</span><span>周日</span>' +
        '</div><div class="macro-cal__days" id="mc-days"></div>' +
      '</div>' +
    '</div></div>' +
    '<div class="macro-cal__yearwrap" id="mc-yearwrap" hidden></div>' +
    '<div class="macro-cal__regions" id="mc-regions"></div>' +
    '<div class="macro-cal__scrollhint">左右滑动查看完整月历</div>';

  function filterActive(key, value) {
    if (key !== "importance") return state[key] === value;
    return value === "all" ? state.importance.length === 0 :
      state.importance.indexOf(value) !== -1;
  }

  function chipRow(key, label) {
    var vals = {
      region: ["all:全部", "cn:中国", "us:美国", "eu:欧洲", "global:全球"],
      category: ["all:全部", "data:数据", "policy:政策", "meeting:会议"],
      importance: ["all:全部", "high:★★★", "medium:★★", "low:★"]
    }[key];
    var out = '<div class="macro-cal__chiprow"><span class="macro-cal__chiplabel">' +
      esc(label) + '</span><div class="macro-cal__chips">';
    vals.forEach(function (v) {
      var parts = v.split(":"), val = parts[0], lab = parts[1];
      var on = filterActive(key, val);
      var ariaLabel = key === "importance" && IMPORTANCE[val] ? IMPORTANCE[val].label : lab;
      out += '<button type="button" class="macro-cal__chip' + (on ? " is-active" : "") +
        '" data-filter="' + key + '" data-value="' + val + '" aria-pressed="' + on +
        '" aria-label="' + esc(ariaLabel) + '">' + esc(lab) + "</button>";
    });
    return out + "</div></div>";
  }

  /* ─────────────── 未来 7 天速览 ─────────────── */

  function renderUpnext() {
    var el = root.querySelector("#mc-upnext");
    if (!el) return;
    var today = today0();
    var h = "<span class='macro-cal__upnextlabel'>未来 7 天</span>" +
      "<div class='macro-cal__upnextdays'>";
    for (var i = 0; i < 7; i++) {
      var dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
      var items = eventsForDate(y, m, d);
      var head = i === 0 ? "今天" : i === 1 ? "明天" : WEEK_CN[dt.getDay()];
      h += "<div class='macro-cal__upnextday" + (i === 0 ? " is-today" : "") + "'>" +
        "<span class='macro-cal__upnexthead'>" + esc(head) +
        "<time datetime='" + y + "-" + pad2(m) + "-" + pad2(d) + "'>" + m + "/" + d + "</time></span>";
      if (items.length) {
        items.forEach(function (ev) {
          h += "<button type='button' class='macro-cal__event is-" + ev.region + " imp-" +
            ev.importance + "' data-id='" + esc(ev.id) + "' title='" +
            esc(ev.name + " · " + ev.window) + "'>" +
            "<span class='macro-cal__eventlabel'>" + esc(ev.short || ev.name) +
            "</span></button>";
        });
      } else {
        h += "<span class='macro-cal__upnextempty'>—</span>";
      }
      h += "</div>";
    }
    el.innerHTML = h + "</div>";
  }

  /* ─────────────── 图例、月历与分国别列表 ─────────────── */

  function nextImportant() {
    var today = today0();
    for (var offset = 0; offset < 370; offset++) {
      var date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
      var items = EVENTS.filter(function (ev) {
        return ev.importance === "high" && isOccurring(ev, m, y) &&
          resolveDays(ev, y, m).indexOf(d) !== -1;
      });
      if (items.length) {
        var ev = sortEvents(items)[0];
        return (offset === 0 ? "今日" : "下个") + " ★★★：" + m + " 月 " + d +
          " 日 · " + ev.name;
      }
    }
    return "";
  }

  function renderLegend() {
    var html = "<span class='macro-cal__legendlabel'>地区</span>";
    Object.keys(REGIONS).forEach(function (r) {
      html += "<span class='macro-cal__legenditem is-" + r +
        "'><i class='macro-cal__legenddot'></i>" + esc(REGIONS[r].label) + "</span>";
    });
    html += "<span class='macro-cal__legendsep'></span>" +
      "<span class='macro-cal__legendlabel'>重要度</span>";
    ["high", "medium", "low"].forEach(function (i) {
      html += "<span class='macro-cal__legenditem'><i class='macro-cal__stars imp-" + i +
        "' aria-hidden='true'>" + IMPORTANCE[i].stars + "</i>" +
        esc(IMPORTANCE[i].label) + "</span>";
    });
    var next = nextImportant();
    if (next) html += "<span class='macro-cal__legendnext'>" + esc(next) + "</span>";
    root.querySelector("#mc-legend").innerHTML = html;
  }

  function renderBody() {
    var monthView = state.view !== "year";
    root.querySelector("#mc-monthwrap").hidden = !monthView;
    root.querySelector("#mc-regions").hidden = !monthView;
    root.querySelector("#mc-yearwrap").hidden = monthView;
    root.querySelector("#mc-month-title").textContent =
      monthView ? monthText(state.year, state.month) : state.year + " 年";
    var prev = new Date(state.year, state.month - 1 - (monthView ? 1 : 12), 1);
    var nextD = new Date(state.year, state.month - 1 + (monthView ? 1 : 12), 1);
    root.querySelector('[data-month-step="-1"]').setAttribute("aria-label",
      (monthView ? "上一个月：" : "上一年：") +
      (monthView ? monthText(prev.getFullYear(), prev.getMonth() + 1)
        : prev.getFullYear() + " 年"));
    root.querySelector('[data-month-step="1"]').setAttribute("aria-label",
      (monthView ? "下一个月：" : "下一年：") +
      (monthView ? monthText(nextD.getFullYear(), nextD.getMonth() + 1)
        : nextD.getFullYear() + " 年"));
    renderUpnext();
    if (monthView) {
      var items = monthItems();
      renderCalendar(items);
      renderRegionGroups(items);
    } else {
      renderYear();
    }
  }

  function renderCalendar(items) {
    var y = state.year, m = state.month;
    var dim = daysInMonth(y, m);
    var first = new Date(y, m - 1, 1).getDay();
    var offset = (first + 6) % 7;
    var totalCells = Math.ceil((offset + dim) / 7) * 7; // 只显示当月实际需要的周数
    var today = new Date();
    var h = "";
    for (var i = 0; i < totalCells; i++) {
      var d = i - offset + 1;
      var weekend = i % 7 >= 5;
      if (d < 1 || d > dim) {
        var adjacent = d < 1 ? daysInMonth(y, m - 1) + d : d - dim;
        h += "<span class='macro-cal__day macro-cal__day--adjacent' aria-hidden='true'>" +
          "<span class='macro-cal__daynum'>" + adjacent + "</span></span>";
        continue;
      }
      var dayItems = items.filter(function (ev) {
        return resolveDays(ev, y, m).indexOf(d) !== -1;
      });
      var isToday = y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate();
      var density = dayItems.length >= 7 ? " macro-cal__day--multi macro-cal__day--dense" :
        dayItems.length >= 4 ? " macro-cal__day--multi" : "";
      h += "<span class='macro-cal__day" + (isToday ? " macro-cal__day--today" : "") +
        (weekend ? " macro-cal__day--weekend" : "") +
        (dayItems.length ? " macro-cal__day--has-events" : "") + density +
        "' data-event-count='" + dayItems.length + "'>" +
        "<span class='macro-cal__daynum'>" + d + "</span><span class='macro-cal__dayevents'>";
      dayItems.forEach(function (ev) {
        var official = officialDatesForYear(ev, y) !== null ? "官方日程 · " : "";
        h += "<button type='button' class='macro-cal__event is-" + ev.region + " imp-" +
          ev.importance + "' data-id='" + esc(ev.id) + "' title='" +
          esc(official + ev.name + " · " + ev.window) + "'>" +
          "<span class='macro-cal__eventlabel'>" + esc(ev.short || ev.name) +
          "</span></button>";
      });
      h += "</span></span>";
    }
    root.querySelector("#mc-days").innerHTML = h;
  }

  function eventDayLabel(ev) {
    if (ev.frequency === "weekly" && validWeekday(ev.weekday)) {
      return "每" + WEEK_CN[Number(ev.weekday)];
    }
    var days = resolveDays(ev, state.year, state.month);
    if (!days.length) return "不定期";
    if (days.length === 1) return days[0] + " 日";
    return days.join("、") + " 日";
  }

  function renderRegionGroups(items) {
    var regions = state.region === "all" ? Object.keys(REGIONS) : [state.region];
    var today = today0();
    var h = "";
    regions.forEach(function (region) {
      var regionItems = items.filter(function (ev) { return ev.region === region; });
      regionItems.sort(function (a, b) {
        var ad = resolveDays(a, state.year, state.month)[0] || 99;
        var bd = resolveDays(b, state.year, state.month)[0] || 99;
        if (ad !== bd) return ad - bd;
        return impRank(b) - impRank(a) || a.name.localeCompare(b.name, "zh-Hans-CN");
      });
      h += "<section class='macro-cal__region is-" + region + "'>" +
        "<h3 class='macro-cal__regionhead'><span><i class='macro-cal__legenddot'></i>" +
        esc(REGIONS[region].label) + "</span><span class='macro-cal__regioncount'>" +
        regionItems.length + " 项</span></h3>";
      if (!regionItems.length) {
        h += "<div class='macro-cal__regionempty'>本月没有符合筛选条件的事件</div></section>";
        return;
      }
      h += "<div class='macro-cal__regionlist'>";
      regionItems.forEach(function (ev) {
        var cd = countdownLabel(ev, today);
        h += "<button type='button' class='macro-cal__regionrow imp-" + ev.importance +
          "' data-id='" + esc(ev.id) + "'>" +
          "<span class='macro-cal__regionday'>" + esc(eventDayLabel(ev)) + "</span>" +
          "<span class='macro-cal__regionbody'><span class='macro-cal__regionname'>" +
          esc(ev.name) + "</span><span class='macro-cal__regionmeta'>" +
          esc(catLabel(ev)) + " · " + esc(ev.window) + "</span></span>" +
          "<span class='macro-cal__regionstars imp-" + ev.importance +
          "' aria-label='" + esc(impLabel(ev)) + "' title='" + esc(impLabel(ev)) +
          "'>" + esc(impStars(ev)) + "</span>" +
          (cd ? "<span class='macro-cal__countdown imp-" + ev.importance + "'>" +
            esc(cd) + "</span>" : "") +
          "</button>";
      });
      h += "</div></section>";
    });
    root.querySelector("#mc-regions").innerHTML = h;
  }

  /* ─────────────── 年历视图：12 格小月历 + 全年重点 ─────────────── */

  function miniMonth(year, m, today) {
    var dim = daysInMonth(year, m);
    var offset = (new Date(year, m - 1, 1).getDay() + 6) % 7;
    var cells = Math.ceil((offset + dim) / 7) * 7;
    var h = "<button type='button' class='macro-cal__minimonth' data-goto='" + m +
      "' aria-label='查看 " + monthText(year, m) + " 月历'>" +
      "<span class='macro-cal__minititle'>" + m + " 月</span>" +
      "<span class='macro-cal__minigrid'>";
    "一二三四五六日".split("").forEach(function (c) {
      h += "<span class='macro-cal__minidow'>" + c + "</span>";
    });
    for (var i = 0; i < cells; i++) {
      var d = i - offset + 1;
      if (d < 1 || d > dim) { h += "<span class='macro-cal__miniday'></span>"; continue; }
      var items = eventsForDate(year, m, d);
      var isToday = year === today.getFullYear() && m === today.getMonth() + 1 &&
        d === today.getDate();
      var dots = "";
      items.slice(0, 3).forEach(function (ev) {
        dots += "<i class='is-" + ev.region + "'></i>";
      });
      h += "<span class='macro-cal__miniday" + (items.length ? " has-events" : "") +
        (isToday ? " today" : "") + "'>" + d +
        (dots ? "<span class='macro-cal__minidots'>" + dots + "</span>" : "") +
        "</span>";
    }
    return h + "</span></button>";
  }

  /** 全年重点：季度及以上频率的事件（月度/周度太密，不适合年规划视图）。 */
  function renderHighlights() {
    var rows = [];
    EVENTS.filter(matches).forEach(function (ev) {
      if (["quarterly", "annual", "semiannual", "multiple"].indexOf(ev.frequency) === -1) return;
      for (var m = 1; m <= 12; m++) {
        if (!isOccurring(ev, m, state.year)) continue;
        resolveDays(ev, state.year, m).forEach(function (d) {
          rows.push({ m: m, d: d, ev: ev });
        });
      }
    });
    rows.sort(function (a, b) {
      return (a.m * 100 + a.d) - (b.m * 100 + b.d) || impRank(b.ev) - impRank(a.ev);
    });
    var h = "<div class='macro-cal__highlights'>" +
      "<div class='macro-cal__hlhead'>" + state.year + " 年重点节点 · " +
      rows.length + " 项</div>";
    var cur = 0;
    rows.forEach(function (r) {
      if (r.m !== cur) {
        cur = r.m;
        h += "<div class='macro-cal__hlmonth'>" + cur + " 月</div>";
      }
      h += "<button type='button' class='macro-cal__hlrow' data-id='" + esc(r.ev.id) + "'>" +
        "<span class='macro-cal__hlday'>" + pad2(r.d) + " 日</span>" +
        "<i class='macro-cal__legenddot is-" + r.ev.region + "'></i>" +
        "<span class='macro-cal__hlname'>" + esc(r.ev.name) + "</span>" +
        "<span class='macro-cal__regionstars imp-" + r.ev.importance + "'>" +
        esc(impStars(r.ev)) + "</span></button>";
    });
    if (!rows.length) h += "<div class='macro-cal__regionempty'>没有符合筛选条件的全年节点</div>";
    return h + "</div>";
  }

  function renderYear() {
    var wrap = root.querySelector("#mc-yearwrap");
    if (!wrap) return;
    var today = new Date();
    var h = "<div class='macro-cal__yeargrid'>";
    for (var m = 1; m <= 12; m++) h += miniMonth(state.year, m, today);
    wrap.innerHTML = h + "</div>" + renderHighlights();
  }

  /* ─────────────── 详情弹窗 ─────────────── */

  var modal = null;
  var lastFocus = null;
  var previousOverflow = "";

  function openModal(id, trigger) {
    var ev = findEvent(id);
    if (!ev) return;
    var dates = [];
    for (var m = 1; m <= 12; m++) {
      if (!isOccurring(ev, m, state.year)) continue;
      resolveDays(ev, state.year, m).forEach(function (d) {
        dates.push(state.year + "-" + pad2(m) + "-" + pad2(d));
      });
    }
    var dateText = dates.length ? dates.join("、") : ev.window + "（以官方公告为准）";
    if (ev.frequency === "monthly" || ev.frequency === "weekly") dateText = ev.window;
    var isOfficial = officialDatesForYear(ev, state.year) !== null;
    var dateLabel = isOfficial ? state.year + " 年官方日期" : "本年度日期 / 节奏";

    var dlRows = [
      ["通常发布窗口", esc(ev.window)],
      ["频率", esc(freqLabel(ev))]
    ];
    if (ev.timeCST) dlRows.push(["北京时间", esc(ev.timeCST)]);
    dlRows.push([esc(dateLabel), esc(dateText)]);
    dlRows.push(["发布机构", ev.sourceUrl
      ? "<a class='mc-modal__srclink' href='" + esc(ev.sourceUrl) +
        "' target='_blank' rel='noopener'>" + esc(ev.source) + " ↗</a>"
      : esc(ev.source)]);
    var actual = actualFor(ev);
    if (actual) {
      var parts = [];
      if (actual.prev != null && actual.prev !== "") parts.push("前值 " + esc(actual.prev));
      if (actual.cons != null && actual.cons !== "") parts.push("预期 " + esc(actual.cons));
      if (actual.actual != null && actual.actual !== "") {
        parts.push("<strong>实际 " + esc(actual.actual) + "</strong>");
      }
      if (parts.length) {
        dlRows.push(["最新一期（" + esc(actual.period) + "）", parts.join(" · ")]);
      }
    }

    if (!modal) {
      modal = document.createElement("div");
      modal.className = "mc-modal";
      document.body.appendChild(modal);
      modal.addEventListener("click", function (e) {
        if (e.target.closest("[data-close]")) closeModal();
      });
      document.addEventListener("keydown", function (e) {
        if (!modal || !modal.classList.contains("is-open")) return;
        if (e.key === "Escape") {
          e.preventDefault();
          closeModal();
        } else if (e.key === "Tab") {
          e.preventDefault();
          var close = modal.querySelector(".mc-modal__close");
          if (close) close.focus();
        }
      });
    }
    lastFocus = trigger || document.activeElement;
    previousOverflow = document.body.style.overflow;
    modal.innerHTML =
      "<div class='mc-modal__backdrop' data-close='1'></div>" +
      "<div class='mc-modal__card' role='dialog' aria-modal='true' aria-labelledby='mc-modal-title'>" +
        "<button type='button' class='mc-modal__close' data-close='1' aria-label='关闭'>×</button>" +
        "<div class='mc-modal__tags'>" +
          "<span class='macro-cal__tag is-" + ev.region + "'>" + esc(regionLabel(ev)) + "</span>" +
          "<span class='macro-cal__tag'>" + esc(catLabel(ev)) + "</span>" +
          "<span class='macro-cal__tag imp-" + ev.importance + "'>" +
            esc(impStars(ev)) + " " + esc(impLabel(ev)) + "</span>" +
          (isOfficial ? "<span class='macro-cal__tag'>官方日程</span>" : "") +
        "</div>" +
        "<h3 class='mc-modal__title' id='mc-modal-title'>" + esc(ev.name) + "</h3>" +
        "<dl class='mc-modal__dl'>" +
          dlRows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") +
        "</dl>" +
        "<p class='mc-modal__note'>" + esc(ev.note) + "</p>" +
        (ev.focus
          ? "<div class='mc-modal__focus'><span class='mc-modal__focuslabel'>关注点</span>" +
            "<p>" + esc(ev.focus) + "</p></div>"
          : "") +
        newsBlock(ev) +
      "</div>";
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    modal.querySelector(".mc-modal__close").focus();
  }

  function newsBlock(ev) {
    var list = newsMatches(ev);
    if (!list.length) return "";
    var h = "<div class='mc-modal__news'><div class='mc-modal__newshead'>相关公告 · " +
      list.length + " 条（点击查看原文）</div>";
    list.forEach(function (it) {
      h += "<a href='" + esc(it.u) + "' target='_blank' rel='noopener'>" +
        "<time>" + esc(it.d) + "</time>" + esc(it.t) + "</a>";
    });
    return h + "</div>";
  }

  function closeModal() {
    if (!modal || !modal.classList.contains("is-open")) return;
    modal.classList.remove("is-open");
    document.body.style.overflow = previousOverflow;
    if (lastFocus && document.contains(lastFocus) && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  /* ─────────────── .ics 导出（RFC 5545，全天事件 + 周期规则） ─────────────── */

  function icsEscape(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }
  function ymdOf(dt) {
    return dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate());
  }

  /**
   * 生成 state.year 年的 ICS 文本（list 为当前筛选下的事件）。
   * 官方日程会议逐日生成并附提前 1 天提醒；周度/月度事件用 RRULE；
   * 季度及以上按通常窗口逐次生成，口径写入 DESCRIPTION。
   */
  function buildICS(year, list) {
    var DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad2(now.getUTCMonth() + 1) + pad2(now.getUTCDate()) +
      "T" + pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + pad2(now.getUTCSeconds()) + "Z";
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//essay.alphta.com//macro-calendar//CN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:宏观事件日历 " + year,
      "X-WR-TIMEZONE:Asia/Shanghai"
    ];
    var seq = 0;
    /* RFC 5545：全天事件的 UNTIL 必须与 DTSTART 同为 DATE 类型；
       限定在导出年内，避免推算规则无限递归误导未来年份。 */
    var until = ";UNTIL=" + year + "1231";

    function desc(ev, extra) {
      var parts = ["窗口: " + ev.window, "频率: " + freqLabel(ev), "机构: " + ev.source];
      if (ev.timeCST) parts.push("北京时间: " + ev.timeCST);
      if (extra) parts.push(extra);
      if (ev.focus) parts.push("关注点: " + ev.focus);
      if (ev.note) parts.push("口径: " + ev.note);
      parts.push("※ 由官方日程/通常窗口整理，以官方公告为准");
      return parts.join("\n");
    }
    function veventOn(start, ev, title, extraDesc, rrule, alarm) {
      seq += 1;
      var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + ev.id + "-" + year + "-" + seq + "@essay.alphta.com");
      lines.push("DTSTAMP:" + stamp);
      lines.push("DTSTART;VALUE=DATE:" + ymdOf(start));
      lines.push("DTEND;VALUE=DATE:" + ymdOf(end));
      lines.push("SUMMARY:" + icsEscape(title));
      lines.push("DESCRIPTION:" + icsEscape(desc(ev, extraDesc)));
      if (rrule) lines.push("RRULE:" + rrule);
      if (ev.sourceUrl) lines.push("URL:" + ev.sourceUrl);
      if (alarm) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY",
          "DESCRIPTION:" + icsEscape(ev.name + "（官方日程）"),
          "TRIGGER:-P1D", "END:VALARM");
      }
      lines.push("END:VEVENT");
    }

    list.forEach(function (ev) {
      if (ev.frequency === "irregular" || ev.placement === "irregular") return;
      var official = officialDatesForYear(ev, year);
      var w, start;
      if (official) {
        official.forEach(function (md) {
          var p = String(md).match(/^(\d{2})-(\d{2})$/);
          if (!p) return;
          veventOn(new Date(year, Number(p[1]) - 1, Number(p[2])), ev, ev.name,
            "官方日程", null, ev.importance === "high");
        });
        return;
      }
      if (ev.frequency === "weekly") {
        w = Number(ev.weekday);
        start = new Date(year, 0, 1);
        while (start.getDay() !== w) {
          start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        }
        veventOn(start, ev, ev.name + "（每周）", "每周事件",
          "FREQ=WEEKLY;BYDAY=" + DAY[w] + until, false);
        return;
      }
      if (ev.frequency === "monthly") {
        var days = resolveDays(ev, year, 1);
        start = new Date(year, 0, days.length ? days[0] : 1);
        var rrule;
        if (ev.placement === "last") rrule = "FREQ=MONTHLY;BYMONTHDAY=-1";
        else if (ev.placement === "firstWeekday") {
          rrule = "FREQ=MONTHLY;BYDAY=1" + DAY[Number(ev.weekday)];
        } else if (ev.placement === "lastWeekday") {
          rrule = "FREQ=MONTHLY;BYDAY=-1" + DAY[Number(ev.weekday)];
        } else {
          rrule = "FREQ=MONTHLY;BYMONTHDAY=" + Math.floor(Number(ev.day));
        }
        veventOn(start, ev, ev.name, "每月重复（按通常窗口推算）", rrule + until, false);
        return;
      }
      for (var m = 1; m <= 12; m++) {
        if (!isOccurring(ev, m, year)) continue;
        resolveDays(ev, year, m).forEach(function (d) {
          veventOn(new Date(year, m - 1, d), ev, ev.name,
            "按通常窗口推算", null, false);
        });
      }
    });

    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  function exportICS() {
    var text;
    try {
      text = buildICS(state.year, EVENTS.filter(matches));
    } catch (e) {
      return;
    }
    if (typeof Blob === "undefined" || !URL || !URL.createObjectURL) return;
    var blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "macro-events-" + state.year + ".ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ─────────────── 事件绑定 ─────────────── */

  root.addEventListener("click", function (e) {
    var t = e.target.closest(
      "[data-month-step], [data-today], [data-filter], [data-id], " +
      "[data-view], [data-ics], [data-goto]");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-month-step")) {
      var step = Number(t.getAttribute("data-month-step")) * (state.view === "year" ? 12 : 1);
      shiftMonth(step);
      renderBody();
    } else if (t.hasAttribute("data-today")) {
      var today = new Date();
      state.year = today.getFullYear();
      state.month = today.getMonth() + 1;
      state.view = "month";
      renderAll();
    } else if (t.hasAttribute("data-view")) {
      state.view = t.getAttribute("data-view") === "year" ? "year" : "month";
      renderAll();
    } else if (t.hasAttribute("data-ics")) {
      exportICS();
    } else if (t.hasAttribute("data-goto")) {
      var m = Number(t.getAttribute("data-goto"));
      if (m >= 1 && m <= 12) state.month = m;
      state.view = "month";
      renderAll();
    } else if (t.dataset.filter) {
      var k = t.dataset.filter, v = t.dataset.value;
      if (k === "importance") {
        if (v === "all") {
          state.importance = [];
        } else {
          var index = state.importance.indexOf(v);
          if (index === -1) state.importance.push(v);
          else state.importance.splice(index, 1);
        }
      } else {
        state[k] = state[k] === v ? "all" : v;
      }
      renderAll();
    } else if (t.dataset.id) {
      openModal(t.dataset.id, t);
    }
  });

  root.addEventListener("keydown", function (e) {
    var nav = e.target.closest("[data-month-step]");
    if (!nav || ["ArrowLeft", "ArrowRight"].indexOf(e.key) === -1) return;
    e.preventDefault();
    var step = (e.key === "ArrowRight" ? 1 : -1) * (state.view === "year" ? 12 : 1);
    shiftMonth(step);
    renderBody();
  });

  root.addEventListener("input", function (e) {
    if (e.target.id === "mc-search") {
      state.query = e.target.value;
      renderBody();
    }
  });

  function renderAll() {
    root.querySelectorAll(".macro-cal__chip").forEach(function (chip) {
      var on = filterActive(chip.dataset.filter, chip.dataset.value);
      chip.className = "macro-cal__chip" + (on ? " is-active" : "");
      chip.setAttribute("aria-pressed", on);
    });
    root.querySelectorAll(".macro-cal__viewbtn").forEach(function (btn) {
      var on = btn.getAttribute("data-view") === state.view;
      btn.classList.toggle("is-active", on);
    });
    renderBody();
  }

  renderLegend();
  renderAll();

  /* 调试 / 无头测试入口（不参与页面逻辑） */
  window.MACRO_CAL_DEBUG = {
    state: state,
    renderBody: renderBody,
    eventsForDate: eventsForDate,
    nextOccurrence: nextOccurrence,
    resolveDays: resolveDays,
    buildICS: buildICS,
    openModal: openModal,
    newsMatches: newsMatches
  };
})();
