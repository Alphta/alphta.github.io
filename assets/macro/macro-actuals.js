/**
 * 宏观日历 · 前值/预期/实际 回填数据（可选组件）
 *
 * 由 scripts/fetch_macro_actuals.py（数据管线骨架，待接入 akshare 等数据源）
 * 定期生成后发布到 /news/macro/macro-actuals.js，
 * 经 <script> 加载为 window.MACRO_ACTUALS，供事件详情弹窗渲染
 * 「前值 / 预期 / 实际」一行。渲染端只展示期号不晚于当前月的数据，
 * 文件缺失或字段为空时该行整体不渲染——日历其余功能完全不受影响。
 *
 * 格式：{ "期号YYYY-MM": { "事件id": { "prev": "前值", "cons": "预期", "actual": "实际" } } }
 * 下面的 2026-09 条目是格式示例（数值为演示，非真实数据），
 * 接入数据管线前可保留空对象，页面按「无数据」处理。
 */
window.MACRO_ACTUALS = {
  /* "2026-09": {
       "cn-cpi":    { prev: "0.4%", cons: "0.5%", actual: "0.1%" },
       "us-cpi":    { prev: "3.0%", cons: "3.1%", actual: "3.0%" },
       "us-nonfarm":{ prev: "22.0万", cons: "17.0万", actual: "11.9万" }
     } */
};
