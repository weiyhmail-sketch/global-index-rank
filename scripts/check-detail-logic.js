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
  let mismatch = 0, compared = 0;   // 必须数「比过几次」：只断言 mismatch===0，
                                    // 标题全空时零次比较也是零个不一致，测试照样绿
  for (let ci = 0; ci < 3; ci++) {
    inst.setData({ curIdx: ci });
    for (let ri = 0; ri < 5; ri++) {
      await inst.onRange({ detail: { value: ri } });
      const d2 = inst.data;
      const label = d2.rangeOptions[ri];
      const grid = (d2.wins.find((w) => w.label === label) || {}).pct;
      const m = d2.chartStat.match(/([+-][\d.]+%)\s*$/);
      const chartPct = m ? m[1] : null;
      const cur = d2.curOptions[ci];
      if (grid === "—") {
        const okTrunc = /不足/.test(d2.chartStat) || /数据不足/.test(d2.chartStat);
        if (!okTrunc && chartPct) { mismatch++; console.log(`  ✗ ${cur} ${label}: 格子「—」但图表给了 ${chartPct}`); }
      } else if (!chartPct) {
        mismatch++; console.log(`  ✗ ${cur} ${label}: 格子 ${grid}，图表标题却取不出数字「${d2.chartStat}」`);
      } else {
        compared++;
        if (chartPct !== grid) { mismatch++; console.log(`  ✗ ${cur} ${label}: 图表 ${chartPct} vs 格子 ${grid}`); }
      }
    }
  }
  check(mismatch === 0, `图表与格子有 ${mismatch} 处不一致`);
  // 格子为「—」的组合不参与比对，所以下限不是 15；但必须真的比过，否则
  // 「标题永远为空」这种改坏方式会零比较、零不一致地混过去。
  check(compared >= 12, `只真正比对了 ${compared} 个组合（应 ≥12）——标题没取出数字`);
  console.log(`  ${compared} 个组合逐项比对，${mismatch} 处不一致 ${mismatch === 0 && compared >= 12 ? "✅" : "❌"}`);


  // 快速连点区间：先发的请求后返回时，不能把旧曲线配上新窗口的数值
  console.log("\n快速切换区间（旧请求后返回）:");
  const realCall = global.wx.cloud.callFunction;
  const delays = {};                      // from → 该请求人为延迟的毫秒数
  global.wx.cloud.callFunction = async (args) => {
    const d = delays[args.data && args.data.from] || 0;
    if (d) await new Promise((r) => setTimeout(r, d));
    return realCall(args);
  };
  inst.chartCache = {};                   // 清缓存，逼出真实请求
  inst.setData({ curIdx: 0 });
  const asof = snapshot.meta.find((m) => m.code === "KS11").asof;
  const mm = (n) => { const dt = new Date(asof + "T00:00:00Z"); const day = dt.getUTCDate();
    dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() - n);
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(day, last)); return dt.toISOString().slice(0, 10); };
  delays[mm(3)] = 300;                    // 「近3月」慢，会在「近3年」之后才返回
  const slow = inst.onRange({ detail: { value: 1 } });   // 近3月
  const fast = inst.onRange({ detail: { value: 3 } });   // 近3年
  await Promise.all([slow, fast]);
  await new Promise((r) => setTimeout(r, 500));
  const finalLabel = inst.data.rangeOptions[inst.data.rangeIdx];
  const finalGrid = (inst.data.wins.find((w) => w.label === finalLabel) || {}).pct;
  const fm = inst.data.chartStat.match(/([+-][\d.]+%)\s*$/);
  console.log(`  最终区间 ${finalLabel} · 标题「${inst.data.chartStat}」· 格子 ${finalGrid}`);
  check(finalLabel === "近3年", `连点后停在 ${finalLabel}，应为近3年`);
  check(!fm || fm[1] === finalGrid, `连点后图表 ${fm && fm[1]} 与格子 ${finalGrid} 不符`);
  const span = inst.data.chartStat.match(/^(\d{4}-\d\d-\d\d) → (\d{4}-\d\d-\d\d)/);
  if (span) {
    const days = (new Date(span[2]) - new Date(span[1])) / 86400000;
    console.log(`  标题跨度 ${Math.round(days)} 天`);
    check(days > 900, `标题跨度只有 ${Math.round(days)} 天，曲线仍是旧区间的`);
  }
  global.wx.cloud.callFunction = realCall;


  // 加载失败后留在页面上直接切区间：令牌若在 load() 里初始化，
  // 此时它还是 undefined，++undefined 得到 NaN，而 NaN !== NaN 恒真，
  // onRange 会把每一次切换都当成过期请求丢掉——选了没反应，也不报错。
  console.log("\n加载失败后直接切区间:");
  // 真实场景是一个全新的页面实例，之前那次成功加载留下的 snap/m 不该还在
  inst.snap = undefined; inst.m = undefined; inst.chart = undefined;
  inst.rangeToken = undefined; inst.setData({ rangeIdx: 2, chartStat: "" });
  inst.onLoad({ code: "不存在的指数", cur: "cny" });   // load() 在 meta.find 之后抛出
  await new Promise((r) => setTimeout(r, 400));
  check(!!inst.data.error, "未找到指数时应显示错误");
  const beforeIdx = inst.data.rangeIdx;
  let threw = "";
  try { await inst.onRange({ detail: { value: 4 } }); }
  catch (e) { threw = e.message || String(e); }
  await new Promise((r) => setTimeout(r, 200));
  console.log(`  令牌=${inst.rangeToken} 区间 ${beforeIdx}→${inst.data.rangeIdx} 标题「${inst.data.chartStat}」${threw ? " 抛出:" + threw : ""}`);
  // 令牌必须在 onLoad 里就位。若等到 load() 内部才初始化，加载一抛异常它就是
  // undefined，之后 ++undefined 得到 NaN，NaN !== NaN 恒真，切区间会静默失效。
  check(typeof inst.rangeToken === "number" && !Number.isNaN(inst.rangeToken),
        `令牌是 ${inst.rangeToken} —— 加载失败后每次切区间都会被当成过期请求丢弃`);
  check(!threw, `onRange 抛出未捕获异常: ${threw}`);

  console.log();
  if (fail.length) { console.log("❌ 问题:"); fail.forEach((f) => console.log("  " + f)); process.exit(1); }
  console.log("✅ 详情页逻辑全部通过");
})();
