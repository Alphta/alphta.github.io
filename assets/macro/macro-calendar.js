/**
 * 宏观信息日历 · 渲染逻辑
 *
 * 依赖：window.MACRO_EVENTS（见 macro-events.js）
 * 挂载点：<div data-macro-calendar></div>
 * 无框架、无外部依赖，纯原生 JS。
 */
(function () {
  "use strict";

  var EVENTS = Array.isArray(window.MACRO_EVENTS) ? window.MACRO_EVENTS : [];
  var WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var REGIONS = {
    cn: { label: "中国" }, us: { label: "美国" },
    eu: { label: "欧元区" }, global: { label: "全球" }
  };
  var CATEGORIES = {
    data: { label: "数据" }, policy: { label: "政策" }, meeting: { label: "会议" }
  };
  var IMPORTANCE = {
    high: { label: "高", rank: 3 },
    medium: { label: "中", rank: 2 },
    low: { label: "低", rank: 1 }
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
  var currentYear = NOW.getFullYear();
  var state = {
    year: currentYear,
    view: "rhythm", // rhythm | calendar | timeline
    region: "all",
    category: "all",
    importance: "all",
    query: ""
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

  /** 把事件落到具体日期。weeklyWeekday 返回当月全部指定星期。 */
  function resolveDays(ev, year, month) {
    var p = ev.placement;
    if (p === "irregular") return [];
    var dim = daysInMonth(year, month);
    var d, w, out;
    if (p === "last") return [dim];
    if (p === "day") {
      d = Number(ev.day);
      if (!isFinite(d) || d < 1) return [];
      d = Math.floor(d);
      return [Math.min(d, dim)];
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

  /** 是否在该月出现；不定期事件也可用 months 限定通常月份。 */
  function isOccurring(ev, month) {
    if (ev.frequency === "monthly" || ev.frequency === "weekly") return true;
    if (Array.isArray(ev.months) && ev.months.length) {
      return ev.months.indexOf(month) !== -1;
    }
    return true;
  }

  function cellHint(ev) {
    var p = ev.placement;
    if (p === "weeklyWeekday" && validWeekday(ev.weekday)) {
      return WEEK_CN[Number(ev.weekday)];
    }
    if (ev.frequency === "weekly") return "每周";
    if (p === "irregular") return "不定期";
    if (p === "last") return "月末";
    if (p === "firstWeekday" && validWeekday(ev.weekday)) {
      return "首" + WEEK_CN[Number(ev.weekday)].slice(1);
    }
    if (p === "lastWeekday" && validWeekday(ev.weekday)) {
      return "末" + WEEK_CN[Number(ev.weekday)].slice(1);
    }
    return Number(ev.day) + "日";
  }

  function matches(ev) {
    if (state.region !== "all" && ev.region !== state.region) return false;
    if (state.category !== "all" && ev.category !== state.category) return false;
    if (state.importance !== "all" && ev.importance !== state.importance) return false;
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

  function visibleEvents() { return EVENTS.filter(matches); }

  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      var ar = IMPORTANCE[a.importance] ? IMPORTANCE[a.importance].rank : 0;
      var br = IMPORTANCE[b.importance] ? IMPORTANCE[b.importance].rank : 0;
      return br - ar || a.name.localeCompare(b.name, "zh-Hans-CN");
    });
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
  function freqLabel(ev) { return FREQ_CN[ev.frequency] || ev.frequency || ""; }
  function isPlaced(ev) { return ev.placement !== "irregular"; }
  function findEvent(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return null;
  }

  /* ─────────────── 骨架 ─────────────── */

  root.classList.add("macro-cal");
  root.innerHTML =
    '<div class="macro-cal__toolbar" role="toolbar" aria-label="日历控制">' +
      '<div class="macro-cal__controls">' +
        '<label class="macro-cal__field"><span>年份</span>' +
          '<select id="mc-year" aria-label="日历年份">' +
            yearOptions(currentYear - 2, currentYear + 3) +
          '</select></label>' +
        '<div class="macro-cal__tabs" role="tablist" aria-label="日历视图">' +
          tabHtml("rhythm", "节奏总览") + tabHtml("calendar", "月历") +
          tabHtml("timeline", "时间轴") +
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
    '<div class="macro-cal__legend" id="mc-legend"></div>' +
    '<div class="macro-cal__summary" id="mc-summary" aria-live="polite"></div>' +
    '<div class="macro-cal__body" id="mc-body"></div>';

  function yearOptions(from, to) {
    var out = "";
    for (var y = from; y <= to; y++) {
      out += '<option value="' + y + '"' + (y === state.year ? " selected" : "") +
        ">" + y + "</option>";
    }
    return out;
  }

  function tabHtml(key, label) {
    var on = state.view === key;
    return '<button type="button" class="macro-cal__tab' + (on ? " is-active" : "") +
      '" role="tab" data-view="' + key + '" aria-selected="' + on +
      '" tabindex="' + (on ? "0" : "-1") + '">' + esc(label) + "</button>";
  }

  function chipRow(key, label) {
    var vals = {
      region: ["all:全部", "cn:中国", "us:美国", "eu:欧元区", "global:全球"],
      category: ["all:全部", "data:数据", "policy:政策", "meeting:会议"],
      importance: ["all:全部", "high:高", "medium:中", "low:低"]
    }[key];
    var out = '<div class="macro-cal__chiprow"><span class="macro-cal__chiplabel">' +
      esc(label) + '</span><div class="macro-cal__chips">';
    vals.forEach(function (v) {
      var parts = v.split(":"), val = parts[0], lab = parts[1];
      var on = state[key] === val;
      out += '<button type="button" class="macro-cal__chip' + (on ? " is-active" : "") +
        '" data-filter="' + key + '" data-value="' + val + '" aria-pressed="' + on +
        '">' + esc(lab) + "</button>";
    });
    return out + "</div></div>";
  }

  /* ─────────────── 图例与摘要 ─────────────── */

  function renderLegend() {
    var html = "<span class='macro-cal__legendlabel'>地区</span>";
    Object.keys(REGIONS).forEach(function (r) {
      html += "<span class='macro-cal__legenditem is-" + r +
        "'><i class='macro-cal__legenddot'></i>" + esc(REGIONS[r].label) + "</span>";
    });
    html += "<span class='macro-cal__legendsep'></span>" +
      "<span class='macro-cal__legendlabel'>重要度</span>";
    ["high", "medium", "low"].forEach(function (i) {
      html += "<span class='macro-cal__legenditem imp-" + i +
        "'><i class='macro-cal__legenddot'></i>" + esc(IMPORTANCE[i].label) + "</span>";
    });
    html += "<span class='macro-cal__legendsep'></span>" +
      "<span class='macro-cal__legendnote'>日期为通常发布窗口，以官方公告为准</span>";
    root.querySelector("#mc-legend").innerHTML = html;
  }

  function renderSummary() {
    root.querySelector("#mc-summary").innerHTML =
      "当前筛选下共 <strong>" + visibleEvents().length + "</strong> 项事件 · 年份 " + state.year;
  }

  /* ─────────────── 三种视图 ─────────────── */

  function renderBody() {
    var list = sortEvents(visibleEvents());
    var body = root.querySelector("#mc-body");
    if (!list.length) {
      body.innerHTML = '<div class="macro-cal__empty">没有符合筛选条件的事件。</div>';
      return;
    }
    if (state.view === "rhythm") body.innerHTML = viewRhythm(list);
    else if (state.view === "calendar") body.innerHTML = viewCalendar(list);
    else body.innerHTML = viewTimeline(list);
  }

  function viewRhythm(list) {
    var h = "<div class='macro-cal__tablewrap'><table class='macro-cal__table'>" +
      "<thead><tr><th class='macro-cal__th macro-cal__th--name'>事件</th>";
    for (var m = 1; m <= 12; m++) h += "<th class='macro-cal__th'>" + m + "月</th>";
    h += "</tr></thead><tbody>";
    list.forEach(function (ev) {
      h += "<tr class='macro-cal__tr'><td class='macro-cal__td macro-cal__td--name'>" +
        "<button type='button' class='macro-cal__namebtn is-" + ev.region + " imp-" +
        ev.importance + "' data-id='" + esc(ev.id) + "'>" +
        "<span class='macro-cal__nametext'>" + esc(ev.name) + "</span>" +
        "<span class='macro-cal__namemeta'><i class='macro-cal__legenddot'></i>" +
        esc(regionLabel(ev)) + " · " + esc(catLabel(ev)) + " · " + esc(freqLabel(ev)) +
        "</span></button></td>";
      for (var mm = 1; mm <= 12; mm++) {
        if (!isOccurring(ev, mm)) {
          h += "<td class='macro-cal__td macro-cal__celldim'>—</td>";
        } else {
          h += "<td class='macro-cal__td'><button type='button' class='macro-cal__cell is-" +
            ev.region + " imp-" + ev.importance + "' data-id='" + esc(ev.id) +
            "' aria-label='" + esc(ev.name + "，" + mm + "月，" + cellHint(ev)) + "'>" +
            esc(cellHint(ev)) + "</button></td>";
        }
      }
      h += "</tr>";
    });
    return h + "</tbody></table></div>";
  }

  function viewCalendar(list) {
    var h = "<div class='macro-cal__months'>";
    for (var m = 1; m <= 12; m++) h += monthCard(list, m);
    return h + "</div>";
  }

  function monthCard(list, month) {
    var y = state.year;
    var dim = daysInMonth(y, month);
    var first = new Date(y, month - 1, 1).getDay();
    var offset = (first + 6) % 7; // 周一为第一列
    var items = list.filter(function (ev) { return isOccurring(ev, month); });
    var h = "<section class='macro-cal__month'><h3 class='macro-cal__monthhead'>" +
      y + " 年 " + month + " 月<span class='macro-cal__monthcount' title='事件定义数'>" +
      items.length + "</span></h3><div class='macro-cal__weekdays'>";
    ["一", "二", "三", "四", "五", "六", "日"].forEach(function (w) {
      h += "<span>" + w + "</span>";
    });
    h += "</div><div class='macro-cal__days'>";
    for (var i = 0; i < offset; i++) {
      h += "<span class='macro-cal__day macro-cal__day--blank'></span>";
    }
    for (var d = 1; d <= dim; d++) {
      var dayItems = items.filter(function (ev) {
        return resolveDays(ev, y, month).indexOf(d) !== -1;
      });
      var isToday = y === NOW.getFullYear() && month === NOW.getMonth() + 1 && d === NOW.getDate();
      h += "<span class='macro-cal__day" + (isToday ? " macro-cal__day--today" : "") +
        "'><span class='macro-cal__daynum'>" + d + "</span><span class='macro-cal__dayevents'>";
      dayItems.forEach(function (ev) {
        h += "<button type='button' class='macro-cal__mini is-" + ev.region + " imp-" +
          ev.importance + "' data-id='" + esc(ev.id) + "' title='" +
          esc(ev.name + " · " + ev.window) + "'>" + esc(ev.short || ev.name) + "</button>";
      });
      h += "</span></span>";
    }
    h += "</div>";
    var notes = list.filter(function (ev) {
      return !isPlaced(ev) && isOccurring(ev, month);
    });
    if (notes.length) {
      h += "<div class='macro-cal__monthnotes'>";
      notes.forEach(function (ev) {
        h += "<button type='button' class='macro-cal__notechip is-" + ev.region + " imp-" +
          ev.importance + "' data-id='" + esc(ev.id) + "'>" + esc(ev.short || ev.name) +
          " <em>" + esc(freqLabel(ev)) + "</em></button>";
      });
      h += "</div>";
    }
    return h + "</section>";
  }

  function viewTimeline(list) {
    var h = "<div class='macro-cal__timeline'>";
    for (var m = 1; m <= 12; m++) {
      var occurrences = [];
      list.forEach(function (ev) {
        if (!isPlaced(ev) || !isOccurring(ev, m)) return;
        resolveDays(ev, state.year, m).forEach(function (d) {
          occurrences.push({ event: ev, day: d });
        });
      });
      occurrences.sort(function (a, b) {
        if (a.day !== b.day) return a.day - b.day;
        var ar = IMPORTANCE[a.event.importance] ? IMPORTANCE[a.event.importance].rank : 0;
        var br = IMPORTANCE[b.event.importance] ? IMPORTANCE[b.event.importance].rank : 0;
        return br - ar || a.event.name.localeCompare(b.event.name, "zh-Hans-CN");
      });
      if (!occurrences.length) continue;
      h += "<section class='macro-cal__monthblock'><h3 class='macro-cal__monthhead'>" +
        state.year + " 年 " + m + " 月<span class='macro-cal__monthcount' title='事件项次'>" +
        occurrences.length + "</span></h3><div class='macro-cal__rows'>";
      occurrences.forEach(function (item) {
        var ev = item.event;
        h += "<button type='button' class='macro-cal__row is-" + ev.region + " imp-" +
          ev.importance + "' data-id='" + esc(ev.id) + "'>" +
          "<span class='macro-cal__rowday'>" + item.day + " 日</span>" +
          "<span class='macro-cal__rowbody'><span class='macro-cal__rowname'>" +
          esc(ev.name) + "</span><span class='macro-cal__rowmeta'>" +
          esc(regionLabel(ev)) + " · " + esc(catLabel(ev)) + " · " + esc(ev.window) +
          "</span></span><i class='macro-cal__legenddot'></i></button>";
      });
      h += "</div></section>";
    }
    var rest = list.filter(function (ev) { return !isPlaced(ev); });
    if (rest.length) {
      h += "<section class='macro-cal__monthblock'><h3 class='macro-cal__monthhead'>" +
        "不定期关注<span class='macro-cal__monthcount'>" + rest.length +
        "</span></h3><div class='macro-cal__rows'>";
      rest.forEach(function (ev) {
        h += "<button type='button' class='macro-cal__row macro-cal__row--rest is-" +
          ev.region + " imp-" + ev.importance + "' data-id='" + esc(ev.id) + "'>" +
          "<span class='macro-cal__rowday'>" + esc(freqLabel(ev)) + "</span>" +
          "<span class='macro-cal__rowbody'><span class='macro-cal__rowname'>" +
          esc(ev.name) + "</span><span class='macro-cal__rowmeta'>" +
          esc(regionLabel(ev)) + " · " + esc(catLabel(ev)) + " · " + esc(ev.window) +
          "</span></span><i class='macro-cal__legenddot'></i></button>";
      });
      h += "</div></section>";
    }
    return h + "</div>";
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
      if (!isOccurring(ev, m)) continue;
      resolveDays(ev, state.year, m).forEach(function (d) {
        dates.push(state.year + "-" + pad2(m) + "-" + pad2(d));
      });
    }
    var dateText = dates.length ? dates.join("、") : ev.window + "（以官方公告为准）";
    if (ev.frequency === "weekly") dateText = ev.window;

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
          // 弹窗目前只有关闭按钮可聚焦，阻止 Tab 落到背景页面。
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
          "<span class='macro-cal__tag imp-" + ev.importance + "'>重要度 " +
            esc(impLabel(ev)) + "</span>" +
        "</div>" +
        "<h3 class='mc-modal__title' id='mc-modal-title'>" + esc(ev.name) + "</h3>" +
        "<dl class='mc-modal__dl'>" +
          "<dt>通常发布窗口</dt><dd>" + esc(ev.window) + "</dd>" +
          "<dt>频率</dt><dd>" + esc(freqLabel(ev)) + "</dd>" +
          "<dt>本年度日期 / 节奏</dt><dd>" + esc(dateText) + "</dd>" +
          "<dt>发布机构</dt><dd>" + esc(ev.source) + "</dd>" +
        "</dl>" +
        "<p class='mc-modal__note'>" + esc(ev.note) + "</p>" +
        "<p class='mc-modal__hint'>※ 以上为通常窗口推算，实际日期以官方公告为准。</p>" +
      "</div>";
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    modal.querySelector(".mc-modal__close").focus();
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

  /* ─────────────── 事件绑定 ─────────────── */

  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-view], [data-filter], [data-id]");
    if (!t || !root.contains(t)) return;
    if (t.dataset.view) {
      state.view = t.dataset.view;
      renderAll();
    } else if (t.dataset.filter) {
      var k = t.dataset.filter, v = t.dataset.value;
      state[k] = state[k] === v ? "all" : v;
      renderAll();
    } else if (t.dataset.id) {
      openModal(t.dataset.id, t);
    }
  });

  root.addEventListener("keydown", function (e) {
    var tab = e.target.closest("[data-view]");
    if (!tab || ["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) === -1) return;
    e.preventDefault();
    var views = ["rhythm", "calendar", "timeline"];
    var index = views.indexOf(state.view);
    if (e.key === "Home") index = 0;
    else if (e.key === "End") index = views.length - 1;
    else index = (index + (e.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    state.view = views[index];
    renderAll();
    root.querySelector('[data-view="' + state.view + '"]').focus();
  });

  root.addEventListener("change", function (e) {
    if (e.target.id === "mc-year") {
      state.year = Number(e.target.value);
      renderAll();
    }
  });

  root.addEventListener("input", function (e) {
    if (e.target.id === "mc-search") {
      state.query = e.target.value;
      renderBody();
      renderSummary();
    }
  });

  function renderAll() {
    var sel = root.querySelector("#mc-year");
    if (sel) sel.innerHTML = yearOptions(currentYear - 2, currentYear + 3);
    root.querySelectorAll(".macro-cal__tab").forEach(function (tab) {
      var on = tab.dataset.view === state.view;
      tab.className = "macro-cal__tab" + (on ? " is-active" : "");
      tab.setAttribute("aria-selected", on);
      tab.setAttribute("tabindex", on ? "0" : "-1");
    });
    root.querySelectorAll(".macro-cal__chip").forEach(function (chip) {
      var on = state[chip.dataset.filter] === chip.dataset.value;
      chip.className = "macro-cal__chip" + (on ? " is-active" : "");
      chip.setAttribute("aria-pressed", on);
    });
    renderBody();
    renderSummary();
  }

  renderLegend();
  renderAll();
})();
