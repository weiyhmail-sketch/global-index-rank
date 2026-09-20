/**
 * 用真实数据在 Node 里跑详情页的 render()，检查逐年涨幅、各区间涨幅、
 * 图表区间裁剪等展示字段。
 *
 * 模拟器交互验证不稳定（点击时有时无），而这些风险都在 JS 计算侧。
 */
const fs = require("fs");
const path = require("path");
const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist", f), "utf8"));
const snapshot = D("snapshot.json");
const chart = D("chart/KS11.json");

let inst = null;
global.Page = (opts) => { inst = Object.assign({}, opts); inst.data = Object.assign({}, opts.data);
  inst.setData = function (o) { Object.assign(this.data, o); }; };
global.wx = {
  cloud: {
    callFunction: async ({ name, data }) =>
      name === "get-chart"
        ? { result: { ok: true, code: data.code, ccy: chart.ccy, n: chart.dates.length,
                      dailyFrom: chart.dailyFrom, dates: chart.dates,
                      local: chart.local, usd: chart.usd, cny: chart.cny } }
        : { result: { ok: true, ...snapshot } },
  },
  setNavigationBarTitle() {},
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }) }),
};

require("../miniprogram/pages/detail/detail.js");

(async () => {
  const fail = [];
  const check = (c, m) => { if (!c) fail.push(m); };

  inst.onLoad({ code: "KS11", cur: "cny" });
  await new Promise((r) => setTimeout(r, 400));
  const d = inst.data;

  console.log(`${d.flag} ${d.country} · ${d.name}   点位 ${d.level}  截至 ${d.asof}`);
  console.log(`  ${d.metaLine}`);
  console.log(`\n各区间涨幅（${d.curOptions[d.curIdx]}口径）:`);
  d.wins.forEach((w) => console.log(`  ${w.label.padEnd(12)} ${w.pct.padStart(10)}`));

  console.log(`\n逐年涨幅（${d.years.length} 行）:`);
  d.years.forEach((y) => console.log(`  ${y.label.padEnd(14)} ${y.pct.padStart(10)}  条宽 ${y.barW.toFixed(1)}%`));

  console.log(`\n图表: ${d.chartStat}${d.sampleNote ? "  [" + d.sampleNote + "]" : ""}`);

  check(d.years.length > 0, "逐年涨幅为空");
  check(d.years[0].label.includes("年初至今"), "首行应为当年年初至今");
  // 当年那行必须与各区间里的「今年以来」一致
  const ytdWin = d.wins.find((w) => w.label === "今年以来");
  check(ytdWin && ytdWin.pct === d.years[0].pct,
    `逐年首行 ${d.years[0].pct} 与各区间「今年以来」${ytdWin && ytdWin.pct} 不一致`);
  check(d.years.every((y) => y.barW >= 0 && y.barW <= 46), "条宽越界");
  check(d.wins.length === snapshot.windows.length + snapshot.anchors.length, "区间行数不对");

  // 切口径后逐年也要跟着变
  const before = d.years[1].pct;
  inst.onCur({ detail: { value: 2 } });          // 原币种
  check(inst.data.years[1].pct !== before, "切口径后逐年涨幅未更新");
  console.log(`\n切原币种后，${inst.data.years[1].label}: ${before} → ${inst.data.years[1].pct}`);

  console.log();
  if (fail.length) { console.log("❌ 问题:"); fail.forEach((f) => console.log("  " + f)); process.exit(1); }
  console.log("✅ 详情页逻辑全部通过");
})();
