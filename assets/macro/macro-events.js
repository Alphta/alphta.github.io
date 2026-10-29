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
 * datesByYear 可选官方日程：{ 2026: ["01-28", "03-18"] }；该年优先于通常日期规则，
 *              多日会议记录结果公布日（通常为会议第二日），而非起止两日均占位
 * timeCST    可选，北京时间发布时点（美欧事件），冬令时备选值用「（冬令时 …）」标注
 * focus      可选，本次发布「看什么」的提示（详情弹窗展示）
 * sourceUrl  可选，发布机构 / 官方日程页链接（详情弹窗直达）
 * newsMatch  可选，与新闻聚合联动：{ src: ["人民银行"], kw: "降准|降息" }
 *              在 window.NF.data 的公告标题上匹配 kw，且发文机关（s 字段）在 src 内；
 *              命中的公告会作为「相关公告」列进事件详情弹窗
 * window     通常发布窗口（文字说明）
 * note       口径 / 备注
 * source     发布机构
 *
 * 重要口径声明
 * ------------
 * 这里是「通常发布窗口」，不是官方排期。同一指标在不同年份、不同年份的节假日安排下，
 * 实际发布日会在窗口内浮动 1-3 天（例如 CPI 有时 9 日、有时 10 日；PMI 偶有因节假日
 * 顺延）。会议类（FOMC、欧央行）若配置 datesByYear 则优先使用官方日程；未配置年份
 * 只在对应月份给出「通常时点」作为参考。使用前请以国家统计局、央行、美国劳工部等官方公告为准。
 *
 * 维护备忘
 * --------
 * - 每年 6-8 月：美联储公布次年 tentative 日历后，补 us-fomc / us-fomc-sep 的次年
 *   datesByYear；欧央行通常一次公布两年，补齐 eu-rates 缺的年份。
 *   未配置的年份自动回退「通常时点」推算，不会报错，只是变成近似值（锚定 15 日）。
 * - 每年 1 月：抽查一次数据发布窗口口径（节假日顺延可能改变惯例，如进出口 7-13 日浮动）。
 * - timeCST 的冬令时备选值：美东数据 11 月-次年 3 月用冬令时，欧央行 10 月末-次年 3 月末用冬令时。
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
    focus: "50 荣枯线得失与环比方向；生产、新订单分项的强弱组合；购进价格对下月 PPI 的领先意义。",
    note: "制造业采购经理指数，50 为荣枯线；同日发布非制造业PMI与综合PMI。",
    source: "国家统计局",
    sourceUrl: "https://www.stats.gov.cn/sj/zxfb/"
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
    focus: "与官方 PMI 的背离方向（中小/出口型企业景气差异）；新出口订单分项反映外需。",
    note: "财新/S&P Global 编制的制造业PMI，与官方PMI互补，更反映中小出口型企业。",
    source: "财新 / S&P Global",
    sourceUrl: "https://pmi.caixin.com/"
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
    focus: "经营活动指数与投入/收费价格分项；服务业就业与新订单能否延续扩张。",
    note: "财新服务业PMI与经营活动指数，关注服务业景气度。",
    source: "财新 / S&P Global",
    sourceUrl: "https://pmi.caixin.com/"
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
    window: "每月 7-13 日左右",
    focus: "出口同比及对美/东盟/欧盟的分国别结构；顺差规模对汇率与流动性环境的含义。",
    note: "以美元计价的进出口总额、贸易顺差/逆差；出口链相关度高。",
    source: "海关总署",
    sourceUrl: "http://www.customs.gov.cn/"
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
    focus: "环比变动的方向与连续性；剔除汇率/资产价格估值因素后的真实增减。",
    note: "官方外汇储备余额及变动，观察汇率压力与干预。",
    source: "国家外汇管理局",
    sourceUrl: "https://www.safe.gov.cn/"
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
    focus: "核心 CPI 同环比能否企稳回升；食品（猪价/菜价）与能源分项的拉动或拖累。",
    note: "同比/环比涨幅，核心CPI单独关注；是货币政策的重要输入。",
    source: "国家统计局",
    sourceUrl: "https://www.stats.gov.cn/sj/zxfb/"
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
    focus: "环比转正或降幅收窄的拐点确认；上游（黑色/有色/化工）向下游的传导程度。",
    note: "出厂价格同比/环比，与CPI一起反映通胀链条上中下游。",
    source: "国家统计局",
    sourceUrl: "https://www.stats.gov.cn/sj/zxfb/"
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
    focus: "政府债与信贷对增量的拉动结构；M1–M2 剪刀差反映资金活化程度；信贷票据冲量与否。",
    note: "社会融资规模存量/增量，M1、M2 增速；M1 口径已调整，注意同比口径。",
    source: "中国人民银行",
    sourceUrl: "http://www.pbc.gov.cn/",
    newsMatch: { src: ["人民银行"], kw: "社会融资|金融统计|货币供应|M1|M2" }
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
    focus: "社零环比与商品/餐饮结构（以旧换新政策效应）；固投里制造业与地产的分化；青年失业率备注。",
    note: "月度国民经济运行主要指标，与季度GDP同源。",
    source: "国家统计局",
    sourceUrl: "https://www.stats.gov.cn/sj/zxfb/"
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
    focus: "环比上涨城市个数（广度比涨幅重要）；一线与三线的分化；二手房对新房的领先。",
    note: "70个大中城市商品住宅销售价格变动，房地产景气度高频代理。",
    source: "国家统计局",
    sourceUrl: "https://www.stats.gov.cn/sj/zxfb/"
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
    focus: "报价是否跟随政策利率联动；1 年期与 5 年期以上的非对称调整（地产/内需信号）。",
    note: "1年期与5年期以上LPR报价；房贷利率定价基准。",
    source: "全国银行间同业拆借中心 / 中国人民银行",
    sourceUrl: "https://www.chinamoney.com.cn/chinese/bklpr/",
    newsMatch: { src: ["人民银行"], kw: "贷款市场报价利率|LPR" }
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
    focus: "当月同比与累计同比的剪刀差；营收利润率与产成品库存（库存周期位置）。",
    note: "工业企业利润总额累计同比与当月同比，反映工业盈利周期。",
    source: "国家统计局",
    sourceUrl: "https://www.stats.gov.cn/sj/zxfb/"
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
    focus: "季调环比（比同比更敏感）；第二/三产业与社零、固投、出口数据的勾稽一致性。",
    note: "季度GDP同比增速及三次产业、需求端分项；全年数据在次年1月发布。",
    source: "国家统计局",
    sourceUrl: "https://www.stats.gov.cn/sj/zxfb/"
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
    focus: "对流动性、利率、汇率的措辞变化；新增专栏（往往是政策信号）；下一阶段思路的删改。",
    note: "季度货币政策取向、流动性判断与下一阶段思路，措辞变化是重点。",
    source: "中国人民银行",
    sourceUrl: "http://www.pbc.gov.cn/",
    newsMatch: { src: ["人民银行"], kw: "货币政策执行报告" }
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
    focus: "对地产、消费、资本市场、「反内卷」等议题的表述顺序与力度变化；与上季定调的差异。",
    note: "季度经济形势分析与政策定调，常涉及房地产、消费、资本市场等议题。",
    source: "新华社",
    sourceUrl: "http://www.news.cn/"
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
    focus: "次年财政/货币基调（积极→适度？）；重点任务排序；超预期的增量表述。",
    note: "部署次年经济工作总基调、宏观政策取向与重点任务。",
    source: "新华社",
    sourceUrl: "http://www.news.cn/"
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
    focus: "增长目标与赤字率组合；超长期特别国债/专项债额度；消费、科技、地产政策着墨。",
    note: "政府工作报告、预算、国民经济和社会发展计划；含全年增长目标。",
    source: "全国人大 / 全国政协",
    sourceUrl: "http://www.npc.gov.cn/"
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
    focus: "粮食安全与种业振兴的措辞；土地制度、乡村振兴的边际变化。",
    note: "连续多年以三农为主题的纲领性文件，关注乡村振兴与粮食安全表述。",
    source: "中共中央 / 国务院",
    sourceUrl: "https://www.gov.cn/"
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
    focus: "落地的量与资金面反应；是否形成「降准—降息」组合；结构性工具的指向。",
    note: "降准、政策利率调整、结构性工具落地等，无固定日期，关注央行官网与公告。",
    source: "中国人民银行",
    sourceUrl: "http://www.pbc.gov.cn/",
    newsMatch: { src: ["人民银行"], kw: "降准|降息|政策利率|公开市场业务" }
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
    timeCST: "20:30（冬令时 21:30）",
    window: "每月第一个周五",
    focus: "新增非农与失业率的组合（萨姆规则视角）；时薪环比；前值的大幅修正方向。",
    note: "新增非农就业、失业率、薪资同比；全球资产定价锚之一。",
    source: "美国劳工部（BLS）",
    sourceUrl: "https://www.bls.gov/news.release/empsit.toc.htm"
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
    timeCST: "20:30（冬令时 21:30）",
    window: "每月 10-13 日",
    focus: "核心服务（剔除住房）环比；超级核心通胀；对美联储降息路径定价的重估。",
    note: "CPI同比/环比，核心CPI；影响美联储利率路径预期。",
    source: "美国劳工部（BLS）",
    sourceUrl: "https://www.bls.gov/news.release/cpi.toc.htm"
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
    timeCST: "20:30（冬令时 21:30）",
    window: "每月末至次月初",
    focus: "核心 PCE 环比（3/6/12 个月年化）；实际个人消费支出反映的景气动能。",
    note: "美联储偏好的通胀指标；含个人收入与支出分项。",
    source: "美国经济分析局（BEA）",
    sourceUrl: "https://www.bea.gov/data/personal-consumption-expenditures-price-index"
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
    timeCST: "20:30（冬令时 21:30）",
    window: "每月 13-15 日",
    focus: "控制组零售（剔除汽车/建材/加油站）更能代表核心消费；环比与通胀相除后的实际消费。",
    note: "零售销售环比，消费端景气度高频指标。",
    source: "美国商务部普查局",
    sourceUrl: "https://www.census.gov/retail/sales.html"
  },
  {
    id: "us-michigan-confidence",
    name: "密歇根大学消费者信心指数初值",
    short: "密歇根初值",
    region: "us",
    category: "data",
    importance: "low",
    frequency: "monthly",
    placement: "day",
    day: 11,
    timeCST: "22:00（冬令时 23:00）",
    window: "每月约 10-12 日（初值）",
    focus: "现状与预期分项的背离；一年期通胀预期初值对市场的扰动往往大于信心本身。",
    note: "消费者信心初值与通胀预期分项，关注消费者对经济前景的早期反馈。",
    source: "密歇根大学 / 汤森路透",
    sourceUrl: "http://www.sca.isr.umich.edu/"
  },
  {
    id: "us-michigan-confidence-final",
    name: "密歇根大学消费者信心指数终值",
    short: "密歇根终值",
    region: "us",
    category: "data",
    importance: "low",
    frequency: "monthly",
    placement: "day",
    day: 24,
    timeCST: "22:00（冬令时 23:00）",
    window: "每月约 24-25 日（终值）",
    focus: "终值对初值的修订幅度；通胀预期的二次确认。",
    note: "消费者信心终值与预期差；关注终值修订及通胀预期分项。",
    source: "密歇根大学 / 汤森路透",
    sourceUrl: "http://www.sca.isr.umich.edu/"
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
    timeCST: "20:30（冬令时 21:30）",
    window: "每周四（节假日顺延）",
    focus: "四周均值平滑后的趋势比单周波动重要；续请人数反映再就业难度。",
    note: "高频就业指标，波动较大，常与非农互相验证。",
    source: "美国劳工部",
    sourceUrl: "https://www.bls.gov/news.release/claims.toc.htm"
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
    datesByYear: {
      2026: ["01-28", "03-18", "04-29", "06-17", "07-29", "09-16", "10-28", "12-09"],
      2027: ["01-27", "03-17", "04-28", "06-09", "07-28", "09-15", "10-27", "12-08"]
    },
    placement: "day",
    day: 15,
    timeCST: "决议与声明于会议次日凌晨 2:00（冬令时 3:00），鲍威尔发布会 2:30/3:30",
    window: "每年约 8 次，1/3/4/6/7/9/10/12 月",
    focus: "声明措辞与点阵图（SEP 月份）的变化；发布会对利率路径与缩表的表述。",
    note: "联邦基金利率目标区间与声明、鲍威尔发布会；具体日期见美联储官网日程。",
    source: "美联储（Federal Reserve）",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
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
    datesByYear: {
      2026: ["03-18", "06-17", "09-16", "12-09"],
      2027: ["03-17", "06-09", "09-15", "12-08"]
    },
    placement: "day",
    day: 15,
    timeCST: "随 FOMC 决议于次日凌晨 2:00（冬令时 3:00）发布",
    window: "3/6/9/12 月 FOMC 会议日（含点阵图）",
    focus: "点阵图中值隐含的年内降息次数；GDP/通胀/失业率预测的修正方向。",
    note: "季度发布，含利率点阵图、GDP/通胀/失业率预测，市场波动放大。",
    source: "美联储（Federal Reserve）",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
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
    months: [2, 3, 4, 6, 7, 9, 10, 12],
    datesByYear: {
      2026: ["02-05", "03-19", "04-30", "06-11", "07-23", "09-10", "10-29", "12-17"],
      2027: ["02-04", "03-18", "04-29", "06-10", "07-22", "09-09", "10-28", "12-16"],
      2028: ["02-03", "03-23", "05-04", "06-08", "07-20", "09-07", "10-12", "12-07"]
    },
    placement: "day",
    day: 15,
    timeCST: "决议 20:15（冬令时 21:15），拉加德发布会 20:45（冬令时 21:45）",
    window: "每年约 8 次，2/3/4/6/7/9/10/12 月",
    focus: "存款便利利率决议与前瞻指引措辞；「数据依赖」路径下对通胀进展的评估。",
    note: "主要再融资利率、存款便利利率、资产购买计划表态；含拉加德发布会。",
    source: "欧洲中央银行（ECB）",
    sourceUrl: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html"
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
    timeCST: "17:00（冬令时 18:00）",
    window: "每月末至次月初（初值）",
    focus: "核心通胀与服务业通胀的粘性；德法两大成员国的分项初值。",
    note: "欧元区调和CPI同比/环比，欧央行定价依据。",
    source: "欧盟统计局（Eurostat）",
    sourceUrl: "https://ec.europa.eu/eurostat/"
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
    focus: "德法分国别数据；制造业新订单能否企稳回升。",
    note: "制造业与服务业PMI初值/终值，关注德国分项。",
    source: "S&P Global",
    sourceUrl: "https://www.pmi.spglobal.com/"
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
    focus: "失业率与季度工资增速的联动（欧央行关注薪资→通胀传导）。",
    note: "欧元区月度失业率是欧央行判断劳动力市场的重要参考；薪资增速另按季度发布。",
    source: "欧盟统计局（Eurostat）",
    sourceUrl: "https://ec.europa.eu/eurostat/"
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
    focus: "实际增产/减产执行率与配额调整；对油价是供给冲击还是价格管理信号。",
    note: "产量政策与减产履约情况，影响原油供给预期；部长级会议并非每月固定召开。",
    source: "OPEC",
    sourceUrl: "https://www.opec.org/"
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
    focus: "对中美欧三大经济体增长的预测调整；风险章节关于地缘与贸易的表述。",
    note: "全球增长与通胀预测，春季年会（4月）与秋季年会（10月）发布。",
    source: "国际货币基金组织（IMF）",
    sourceUrl: "https://www.imf.org/en/Publications/WEO"
  }
];
