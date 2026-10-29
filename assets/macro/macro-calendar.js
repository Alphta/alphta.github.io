/**
 * 宏观信息日历 · 单月月历与分国别列表
 * 依赖：window.MACRO_EVENTS；挂载点：<div data-macro-calendar></div>
 * 无框架、无外部依赖，纯原生 JS。
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
    year: NOW.getFullYear(), month: NOW.getMonth() + 1,
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
      return [Math.min(Math.floor(d), dim)];
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

  function isOccurring(ev, month) {
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
      return isOccurring(ev, state.month);
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
    '<div class="macro-cal__scroll"><div class="macro-cal__monthly">' +
      '<div class="macro-cal__calendarwrap"><div class="macro-cal__calendar">' +
        '<div class="macro-cal__weekdays">' +
          '<span>周一</span><span>周二</span><span>周三</span><span>周四</span>' +
          '<span>周五</span><span>周六</span><span>周日</span>' +
        '</div><div class="macro-cal__days" id="mc-days"></div>' +
      '</div></div>' +
      '<div class="macro-cal__regions" id="mc-regions"></div>' +
    '</div></div>' +
    '<div class="macro-cal__scrollhint">左右滑动查看完整月历与地区列表</div>';

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

  /* ─────────────── 图例、月历与分国别列表 ─────────────── */

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
    html += "<span class='macro-cal__legendsep'></span>" +
      "<span class='macro-cal__legendnote'>日期为通常发布窗口，以官方公告为准</span>";
    root.querySelector("#mc-legend").innerHTML = html;
  }

  function occurrenceCount(items) {
    return items.reduce(function (total, ev) {
      var days = resolveDays(ev, state.year, state.month);
      return total + (days.length || 1);
    }, 0);
  }

  function renderBody() {
    var items = monthItems();
    root.querySelector("#mc-month-title").textContent = monthText(state.year, state.month);
    root.querySelector("#mc-summary").innerHTML =
      "本月 <strong>" + items.length + "</strong> 项事件 · " +
      occurrenceCount(items) + " 项次（周频按实际日期计）";
    root.querySelector('[data-month-step="-1"]').setAttribute("aria-label",
      "上一个月：" + monthText(state.month === 1 ? state.year - 1 : state.year,
        state.month === 1 ? 12 : state.month - 1));
    root.querySelector('[data-month-step="1"]').setAttribute("aria-label",
      "下一个月：" + monthText(state.month === 12 ? state.year + 1 : state.year,
        state.month === 12 ? 1 : state.month + 1));
    renderCalendar(items);
    renderRegionGroups(items);
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
        h += "<span class='macro-cal__day macro-cal__day--blank" +
          (weekend ? " macro-cal__day--weekend" : "") + "' aria-hidden='true'></span>";
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
        h += "<button type='button' class='macro-cal__event is-" + ev.region + " imp-" +
          ev.importance + "' data-id='" + esc(ev.id) + "' title='" +
          esc(ev.name + " · " + ev.window) + "'>" +
          "<i class='macro-cal__eventdot' aria-hidden='true'></i>" +
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
    var h = "";
    regions.forEach(function (region) {
      var regionItems = items.filter(function (ev) { return ev.region === region; });
      regionItems.sort(function (a, b) {
        var ad = resolveDays(a, state.year, state.month)[0] || 99;
        var bd = resolveDays(b, state.year, state.month)[0] || 99;
        if (ad !== bd) return ad - bd;
        var ar = IMPORTANCE[a.importance] ? IMPORTANCE[a.importance].rank : 0;
        var br = IMPORTANCE[b.importance] ? IMPORTANCE[b.importance].rank : 0;
        return br - ar || a.name.localeCompare(b.name, "zh-Hans-CN");
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
        h += "<button type='button' class='macro-cal__regionrow imp-" + ev.importance +
          "' data-id='" + esc(ev.id) + "'>" +
          "<span class='macro-cal__regionday'>" + esc(eventDayLabel(ev)) + "</span>" +
          "<span class='macro-cal__regionbody'><span class='macro-cal__regionname'>" +
          esc(ev.name) + "</span><span class='macro-cal__regionmeta'>" +
          esc(catLabel(ev)) + " · " + esc(ev.window) + "</span></span>" +
          "<span class='macro-cal__regionstars imp-" + ev.importance +
          "' aria-label='" + esc(impLabel(ev)) + "' title='" + esc(impLabel(ev)) +
          "'>" + esc(impStars(ev)) + "</span></button>";
      });
      h += "</div></section>";
    });
    root.querySelector("#mc-regions").innerHTML = h;
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
    var t = e.target.closest("[data-month-step], [data-today], [data-filter], [data-id]");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-month-step")) {
      shiftMonth(Number(t.getAttribute("data-month-step")));
      renderBody();
    } else if (t.hasAttribute("data-today")) {
      var today = new Date();
      state.year = today.getFullYear();
      state.month = today.getMonth() + 1;
      renderBody();
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
    shiftMonth(e.key === "ArrowRight" ? 1 : -1);
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
    renderBody();
  }

  renderLegend();
  renderAll();
})();
