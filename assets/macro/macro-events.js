/**
 * 宏观信息日历 · 事件数据
 *
 * 字段说明
 * ---------
 * id         唯一标识（勿重复）
 * name       完整名称
 * short      紧凑显示名（月历格子、卡片角标里用）
 * region     地区：cn 中国 / us 美国 / eu 欧元区 / global 全球
 * category   类别：data 数据发布 / policy 政策事件 / meeting 政策会议
 * importance 重要度：high / medium / low
 * frequency  频率：monthly 每月 / quarterly 每季 / semiannual 每半年 /
 *              annual 每年 / multiple 每年多次 / weekly 每周 / irregular 不定期
 * months     通常出现的月份，取值 1-12；monthly / weekly 无需设置
 * placement  日期规则：
 *              day            通常锚定某日（取 day，并非官方精确排期）
 *              last           当月最后一日
 *              firstWeekday   当月第一个周几（取 weekday，0=周日 … 6=周六）
 *              lastWeekday    当月最后一个周几
 *              weeklyWeekday  当月每周的指定周几
 *              irregular      日期不固定（只在月份备注和时间轴末尾列示）
 * day        placement = day 时使用的日期
 * weekday    placement 为 *Weekday 时使用的星期
 * window     通常发布窗口（文字说明）
 * note       口径 / 备注
 * source     发布机构
 *
 * 重要口径声明
 * ------------
 * 这里是「通常发布窗口」，不是官方排期。同一指标在不同年份、不同年份的节假日安排下，
 * 实际发布日会在窗口内浮动 1-3 天（例如 CPI 有时 9 日、有时 10 日；PMI 偶有因节假日
 * 顺延）。会议类（FOMC、欧央行）每年的具体日期由官方提前公布，本表只在对应月份
 * 给出「通常时点」作为参考。使用前请以国家统计局、央行、美国劳工部等官方公告为准。
 */
window.MACRO_EVENTS = [
  /* ─────────────── 中国 · 月度数据 ─────────────── */
  {
    id: "cn-pmi-manufacturing",
    name: "官方制造业PMI",
    short: "官方PMI",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "last",
    window: "每月最后一日",
    note: "制造业采购经理指数，50 为荣枯线；同日发布非制造业PMI与综合PMI。",
    source: "国家统计局"
  },
  {
    id: "cn-pmi-caixin-manufacturing",
    name: "财新制造业PMI",
    short: "财新PMI",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 1,
    window: "每月 1 日",
    note: "财新/S&P Global 编制的制造业PMI，与官方PMI互补，更反映中小出口型企业。",
    source: "财新 / S&P Global"
  },
  {
    id: "cn-pmi-caixin-services",
    name: "财新服务业PMI",
    short: "财新服务业",
    region: "cn",
    category: "data",
    importance: "medium",
    frequency: "monthly",
    placement: "day",
    day: 3,
    window: "每月 3 日左右",
    note: "财新服务业PMI与经营活动指数，关注服务业景气度。",
    source: "财新 / S&P Global"
  },
  {
    id: "cn-trade",
    name: "进出口（贸易帐）",
    short: "进出口",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 7,
    window: "每月 7 日左右",
    note: "以美元计价的进出口总额、贸易顺差/逆差；出口链相关度高。",
    source: "海关总署"
  },
  {
    id: "cn-fx-reserves",
    name: "外汇储备",
    short: "外储",
    region: "cn",
    category: "data",
    importance: "medium",
    frequency: "monthly",
    placement: "day",
    day: 7,
    window: "每月 7 日左右",
    note: "官方外汇储备余额及变动，观察汇率压力与干预。",
    source: "国家外汇管理局"
  },
  {
    id: "cn-cpi",
    name: "CPI（居民消费价格）",
    short: "CPI",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 9,
    window: "每月 9-10 日",
    note: "同比/环比涨幅，核心CPI单独关注；是货币政策的重要输入。",
    source: "国家统计局"
  },
  {
    id: "cn-ppi",
    name: "PPI（工业生产者出厂价格）",
    short: "PPI",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 9,
    window: "每月 9-10 日（与CPI同日）",
    note: "出厂价格同比/环比，与CPI一起反映通胀链条上中下游。",
    source: "国家统计局"
  },
  {
    id: "cn-social-financing",
    name: "社融 / M1 / M2",
    short: "社融/M2",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 10,
    window: "每月 10-15 日",
    note: "社会融资规模存量/增量，M1、M2 增速；M1 口径已调整，注意同比口径。",
    source: "中国人民银行"
  },
  {
    id: "cn-economy-monthly",
    name: "工业增加值 / 社零 / 固投",
    short: "工业/社零",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 15,
    window: "每月 15 日左右",
    note: "月度国民经济运行主要指标，与季度GDP同源。",
    source: "国家统计局"
  },
  {
    id: "cn-housing-70",
    name: "70城新建/二手住宅价格",
    short: "70城房价",
    region: "cn",
    category: "data",
    importance: "medium",
    frequency: "monthly",
    placement: "day",
    day: 15,
    window: "每月 15 日左右",
    note: "70个大中城市商品住宅销售价格变动，房地产景气度高频代理。",
    source: "国家统计局"
  },
  {
    id: "cn-lpr",
    name: "LPR（贷款市场报价利率）",
    short: "LPR",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 20,
    window: "每月 20 日（遇节假日顺延）",
    note: "1年期与5年期以上LPR报价；房贷利率定价基准。",
    source: "全国银行间同业拆借中心 / 中国人民银行"
  },
  {
    id: "cn-industrial-profits",
    name: "规模以上工业企业利润",
    short: "工业利润",
    region: "cn",
    category: "data",
    importance: "low",
    frequency: "monthly",
    placement: "day",
    day: 27,
    window: "每月 27 日左右",
    note: "工业企业利润总额累计同比与当月同比，反映工业盈利周期。",
    source: "国家统计局"
  },

  /* ─────────────── 中国 · 季度数据 ─────────────── */
  {
    id: "cn-gdp",
    name: "GDP / 国民经济运行情况",
    short: "GDP",
    region: "cn",
    category: "data",
    importance: "high",
    frequency: "quarterly",
    months: [1, 4, 7, 10],
    placement: "day",
    day: 15,
    window: "1/4/7/10 月 15 日前后",
    note: "季度GDP同比增速及三次产业、需求端分项；全年数据在次年1月发布。",
    source: "国家统计局"
  },
  {
    id: "cn-cb-report",
    name: "央行货币政策执行报告",
    short: "货政报告",
    region: "cn",
    category: "policy",
    importance: "medium",
    frequency: "quarterly",
    months: [2, 5, 8, 11],
    placement: "day",
    day: 15,
    window: "2/5/8/11 月中下旬",
    note: "季度货币政策取向、流动性判断与下一阶段思路，措辞变化是重点。",
    source: "中国人民银行"
  },

  /* ─────────────── 中国 · 政策 / 会议 ─────────────── */
  {
    id: "cn-politburo",
    name: "中央政治局会议",
    short: "政治局",
    region: "cn",
    category: "policy",
    importance: "high",
    frequency: "quarterly",
    months: [4, 7, 10, 12],
    placement: "day",
    day: 28,
    window: "4/7/10/12 月下旬（日期不固定）",
    note: "季度经济形势分析与政策定调，常涉及房地产、消费、资本市场等议题。",
    source: "新华社"
  },
  {
    id: "cn-central-econ-work",
    name: "中央经济工作会议",
    short: "中央经济会",
    region: "cn",
    category: "policy",
    importance: "high",
    frequency: "annual",
    months: [12],
    placement: "day",
    day: 15,
    window: "12 月中旬",
    note: "部署次年经济工作总基调、宏观政策取向与重点任务。",
    source: "新华社"
  },
  {
    id: "cn-two-sessions",
    name: "全国两会",
    short: "两会",
    region: "cn",
    category: "policy",
    importance: "high",
    frequency: "annual",
    months: [3],
    placement: "day",
    day: 5,
    window: "3 月上旬",
    note: "政府工作报告、预算、国民经济和社会发展计划；含全年增长目标。",
    source: "全国人大 / 全国政协"
  },
  {
    id: "cn-no1-file",
    name: "中央一号文件",
    short: "一号文件",
    region: "cn",
    category: "policy",
    importance: "medium",
    frequency: "irregular",
    months: [1, 2],
    placement: "irregular",
    window: "通常 1–2 月，具体日期不固定",
    note: "连续多年以三农为主题的纲领性文件，关注乡村振兴与粮食安全表述。",
    source: "中共中央 / 国务院"
  },
  {
    id: "cn-rrr-irregular",
    name: "降准 / 降息等货币政策操作",
    short: "降准/降息",
    region: "cn",
    category: "policy",
    importance: "high",
    frequency: "irregular",
    placement: "irregular",
    window: "不定期",
    note: "降准、政策利率调整、结构性工具落地等，无固定日期，关注央行官网与公告。",
    source: "中国人民银行"
  },

  /* ─────────────── 美国 · 月度数据 ─────────────── */
  {
    id: "us-nonfarm",
    name: "非农就业报告",
    short: "非农",
    region: "us",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "firstWeekday",
    weekday: 5,
    window: "每月第一个周五",
    note: "新增非农就业、失业率、薪资同比；全球资产定价锚之一。",
    source: "美国劳工部（BLS）"
  },
  {
    id: "us-cpi",
    name: "美国CPI",
    short: "美国CPI",
    region: "us",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 10,
    window: "每月 10-13 日",
    note: "CPI同比/环比，核心CPI；影响美联储利率路径预期。",
    source: "美国劳工部（BLS）"
  },
  {
    id: "us-core-pce",
    name: "美国核心PCE",
    short: "核心PCE",
    region: "us",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "day",
    day: 28,
    window: "每月末至次月初",
    note: "美联储偏好的通胀指标；含个人收入与支出分项。",
    source: "美国经济分析局（BEA）"
  },
  {
    id: "us-retail-sales",
    name: "美国零售销售",
    short: "零售销售",
    region: "us",
    category: "data",
    importance: "medium",
    frequency: "monthly",
    placement: "day",
    day: 15,
    window: "每月 13-15 日",
    note: "零售销售环比，消费端景气度高频指标。",
    source: "美国商务部普查局"
  },
  {
    id: "us-michigan-confidence",
    name: "密歇根大学消费者信心指数",
    short: "密歇根信心",
    region: "us",
    category: "data",
    importance: "low",
    frequency: "monthly",
    placement: "day",
    day: 15,
    window: "每月 10-15 日（初值/终值）",
    note: "消费者信心终值与预期差；关注通胀预期分项。",
    source: "密歇根大学 / 汤森路透"
  },
  {
    id: "us-jobless-claims",
    name: "初请失业金人数",
    short: "初请",
    region: "us",
    category: "data",
    importance: "high",
    frequency: "weekly",
    placement: "weeklyWeekday",
    weekday: 4,
    window: "每周四（节假日顺延）",
    note: "高频就业指标，波动较大，常与非农互相验证。",
    source: "美国劳工部"
  },

  /* ─────────────── 美国 · 会议 ─────────────── */
  {
    id: "us-fomc",
    name: "FOMC 议息会议",
    short: "FOMC",
    region: "us",
    category: "meeting",
    importance: "high",
    frequency: "multiple",
    months: [1, 3, 4, 6, 7, 9, 10, 12],
    placement: "day",
    day: 15,
    window: "每年约 8 次，1/3/4/6/7/9/10/12 月",
    note: "联邦基金利率目标区间与声明、鲍威尔发布会；具体日期见美联储官网日程。",
    source: "美联储（Federal Reserve）"
  },
  {
    id: "us-fomc-sep",
    name: "FOMC 经济预期摘要（SEP）",
    short: "FOMC·SEP",
    region: "us",
    category: "meeting",
    importance: "high",
    frequency: "quarterly",
    months: [3, 6, 9, 12],
    placement: "day",
    day: 15,
    window: "3/6/9/12 月 FOMC 会议日（含点阵图）",
    note: "季度发布，含利率点阵图、GDP/通胀/失业率预测，市场波动放大。",
    source: "美联储（Federal Reserve）"
  },

  /* ─────────────── 欧元区 ─────────────── */
  {
    id: "eu-rates",
    name: "欧央行利率决议",
    short: "欧央行",
    region: "eu",
    category: "meeting",
    importance: "high",
    frequency: "multiple",
    months: [1, 3, 4, 6, 7, 9, 10, 12],
    placement: "day",
    day: 15,
    window: "每年约 8 次，1/3/4/6/7/9/10/12 月",
    note: "主要再融资利率、存款便利利率、资产购买计划表态；含拉加德发布会。",
    source: "欧洲中央银行（ECB）"
  },
  {
    id: "eu-cpi",
    name: "欧元区CPI",
    short: "欧元区CPI",
    region: "eu",
    category: "data",
    importance: "high",
    frequency: "monthly",
    placement: "last",
    window: "每月末至次月初（初值）",
    note: "欧元区调和CPI同比/环比，欧央行定价依据。",
    source: "欧盟统计局（Eurostat）"
  },
  {
    id: "eu-pmi",
    name: "欧元区制造业/服务业PMI",
    short: "欧元区PMI",
    region: "eu",
    category: "data",
    importance: "medium",
    frequency: "monthly",
    placement: "day",
    day: 24,
    window: "每月 23-24 日（初值）",
    note: "制造业与服务业PMI初值/终值，关注德国分项。",
    source: "S&P Global"
  },
  {
    id: "eu-unemployment",
    name: "欧元区失业率",
    short: "欧元区失业率",
    region: "eu",
    category: "data",
    importance: "low",
    frequency: "monthly",
    placement: "last",
    window: "每月末至次月初（发布上月值）",
    note: "欧元区月度失业率是欧央行判断劳动力市场的重要参考；薪资增速另按季度发布。",
    source: "欧盟统计局（Eurostat）"
  },

  /* ─────────────── 全球 ─────────────── */
  {
    id: "global-opec",
    name: "OPEC / OPEC+ 产量政策会议",
    short: "OPEC+",
    region: "global",
    category: "meeting",
    importance: "medium",
    frequency: "irregular",
    placement: "irregular",
    window: "不定期（以官方会议公告为准）",
    note: "产量政策与减产履约情况，影响原油供给预期；部长级会议并非每月固定召开。",
    source: "OPEC"
  },
  {
    id: "global-imf-weo",
    name: "IMF《世界经济展望》",
    short: "IMF WEO",
    region: "global",
    category: "data",
    importance: "medium",
    frequency: "semiannual",
    months: [4, 10],
    placement: "day",
    day: 15,
    window: "4 月与 10 月（春季/秋季）",
    note: "全球增长与通胀预测，春季年会（4月）与秋季年会（10月）发布。",
    source: "国际货币基金组织（IMF）"
  }
];
