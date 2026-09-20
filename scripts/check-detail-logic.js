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
    // 桩必须忠实复刻 get-chart 的裁剪逻辑。
    // 早先的版本忽略了 data.from、永远返回整份文件，于是「图表与榜单一致性」
    // 那条验证根本没跑到被测代码——对抗性审查正是从这里找到 40pt 的偏差。
    callFunction: async ({ name, data }) => {
      if (name !== "get-chart") return { result: { ok: true, ...snapshot } };
      let { dates, local, usd, cny } = chart;
      let truncated = false;
      if (data.from) {
        let i = -1;
        for (let k = 0; k < dates.length; k++) { if (dates[k] <= data.from) i = k; else break; }
        truncated = i < 0;
        if (i > 0) {
          dates = dates.slice(i); local = local.slice(i);
          if (usd) usd = usd.slice(i);
          if (cny) cny = cny.slice(i);
        }
      }
      return { result: { ok: true, code: data.code, ccy: chart.ccy, n: dates.length,
                         dailyFrom: chart.dailyFrom, truncated, dates, local, usd, cny } };
    },
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

  // 遍历全部 5 个区间 × 3 口径，逐项比对图表标题与格子
  console.log("\n图表标题 vs 各区间涨幅格子（全部区间 × 全部口径）:");
  let mismatch = 0;
  for (let ci = 0; ci < 3; ci++) {
    inst.setData({ curIdx: ci });
    for (let ri = 0; ri < 5; ri++) {
      inst.setData({ rangeIdx: ri });
      await inst.loadChart();
      inst.render();
      const d2 = inst.data;
      const label = d2.rangeOptions[ri];
      const grid = (d2.wins.find((w) => w.label === label) || {}).pct;
      const m = d2.chartStat.match(/([+-][\d.]+%)\s*$/);
      const chartPct = m ? m[1] : null;
      const cur = d2.curOptions[ci];
      if (grid === "—") {
        const okTrunc = /不足/.test(d2.chartStat) || /数据不足/.test(d2.chartStat);
        if (!okTrunc && chartPct) { mismatch++; console.log(`  ✗ ${cur} ${label}: 格子「—」但图表给了 ${chartPct}`); }
      } else if (chartPct && chartPct !== grid) {
        mismatch++; console.log(`  ✗ ${cur} ${label}: 图表 ${chartPct} vs 格子 ${grid}`);
      }
    }
  }
  check(mismatch === 0, `图表与格子有 ${mismatch} 处不一致`);
  console.log(mismatch === 0 ? "  15 个组合全部一致 ✅" : "");

  console.log();
  if (fail.length) { console.log("❌ 问题:"); fail.forEach((f) => console.log("  " + f)); process.exit(1); }
  console.log("✅ 详情页逻辑全部通过");
})();
