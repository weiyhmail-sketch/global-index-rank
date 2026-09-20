/**
 * 用真实云端快照，在 Node 里跑一遍小程序首页的 render() 逻辑。
 *
 * 模拟器验证依赖 IDE 自动化通道，该通道在 app.json 变更后不稳定；
 * 而页面的风险主要在 JS 计算而非 WXML 渲染，这里把 Page/setData 打桩，
 * 直接检查 setData 出来的展示字段是否正确。
 */
const fs = require("fs");
const path = require("path");

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist", "snapshot.json"), "utf8"));
const monthly = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist", "monthly.json"), "utf8"));

let inst = null;
global.Page = (opts) => {
  inst = Object.assign({}, opts);
  inst.data = Object.assign({}, opts.data);
  inst.setData = function (o) { Object.assign(this.data, o); };
};
global.wx = {
  cloud: {
    callFunction: async ({ name }) =>
      name === "get-monthly" ? { result: { ok: true, ...monthly } }
                             : { result: { ok: true, ...snapshot } },
  },
  stopPullDownRefresh() {},
  navigateTo() {},
};

// utils/cloud.js 内部用 wx.cloud.callFunction，这里的桩已覆盖
require("../miniprogram/pages/index/index.js");

(async () => {
  await inst.load();
  const d = inst.data;
  const fail = [];
  const check = (cond, msg) => { if (!cond) fail.push(msg); };

  console.log("副标题:", d.sub);
  console.log("结论条:", d.ledeHead);
  console.log(`  领涨 ${d.top.flag} ${d.top.country} ${d.top.pct} (${d.top.cls})`);
  console.log(`  垫底 ${d.bottom.flag} ${d.bottom.country} ${d.bottom.pct} (${d.bottom.cls})`);
  console.log("  " + d.stats);
  if (d.moves.length) console.log("  近7日名次: " + d.moves.map((m) => `${m.country}${m.delta}`).join("  "));
  console.log(`\n榜单（默认 核心12国 · 人民币 · 今年以来）${d.rows.length} 行:`);
  d.rows.forEach((r) => console.log(
    `  ${String(r.rank).padStart(2)} ${r.flag} ${r.country.padEnd(5)} ${r.pct.padStart(9)} ${(r.delta || "").padEnd(3)} ${r.name}`));

  check(d.rows.length === 12, `核心层应为 12 行，实际 ${d.rows.length}`);
  check(d.top && d.top.pct.includes("%"), "领涨格式异常");
  check(d.rows.every((r) => r.pct !== undefined && r.cls), "存在缺字段的行");
  check(d.rows.filter((r) => r.rank).every((r, i, a) => i === 0 || +a[i - 1].rank <= +r.rank), "名次未递增");

  // 切到美元口径
  inst.setData({ curIdx: 1 }); inst.render();
  console.log("\n切美元口径，前3:");
  inst.data.rows.slice(0, 3).forEach((r) => console.log(`  ${r.rank} ${r.flag} ${r.country} ${r.pct}`));
  check(inst.data.ledeHead.includes("美元"), "口径标题未更新");

  // 切到事件锚点
  const ai = inst.wins.findIndex((w) => w.key.startsWith("anchor:2025-04-07"));
  check(ai >= 0, "未找到关税冲击日锚点");
  inst.setData({ curIdx: 0, winIdx: ai }); inst.render();
  console.log("\n切「关税冲击日以来」，前3:");
  inst.data.rows.slice(0, 3).forEach((r) => console.log(`  ${r.rank} ${r.flag} ${r.country} ${r.pct}`));
  check(inst.data.divNote.length > 0, "长周期未提示股息口径");

  // 切全部 + 展开某行看汇率拆解
  inst.setData({ winIdx: inst.wins.findIndex((w) => w.key === "ytd"), tierIdx: 2 }); inst.render();
  console.log(`\n切「全部」：${inst.data.rows.length} 行`);
  check(inst.data.rows.length === snapshot.meta.length, `全部层应为 ${snapshot.meta.length} 行`);

  const usRow = inst.data.rows.find((r) => r.code === "NDX");
  inst.onTapRow({ currentTarget: { dataset: { code: "NDX" } } });
  const c = inst.data.detail.calc;
  console.log(`\n展开 纳斯达克100：${c.total} = 原币 ${c.local} × 汇率 ${c.fx}`);
  // 校验乘法关系确实成立
  const lhs = 1 + parseFloat(c.total) / 100;
  const rhs = (1 + parseFloat(c.local) / 100) * (1 + parseFloat(c.fx) / 100);
  check(Math.abs(lhs - rhs) < 0.0002, `拆解乘法不成立: ${lhs} vs ${rhs}`);
  console.log(`  乘法校验 ${lhs.toFixed(6)} ≈ ${rhs.toFixed(6)}  ${Math.abs(lhs - rhs) < 0.0002 ? "✅" : "❌"}`);

  // 自定义月度区间：选「去年12月末 → 最新」，结果应与预置的今年以来一致
  inst.setData({ tierIdx: 0, curIdx: 0, expanded: "" });
  await inst.onWin({ detail: { value: inst.wins.length } });
  check(inst.data.isCustom, "未进入自定义模式");
  const prevDec = String(+snapshot.dataAsof.slice(0, 4) - 1) + "-12";
  inst.setData({ m0Idx: monthly.months.indexOf(prevDec), m1Idx: monthly.months.length - 1 });
  inst.render();
  console.log(`\n自定义区间「${prevDec} 月末 → 最新」前3:`);
  inst.data.rows.slice(0, 3).forEach((r) => console.log(`  ${r.rank} ${r.flag} ${r.country} ${r.pct}`));
  check(inst.data.ledeHead.includes(prevDec), "自定义标题未反映所选月份");
  check(!inst.data.rows.some((r) => r.delta), "自定义区间不应显示名次变化角标");

  // 与预置「今年以来」逐项比对
  const ytdRows = {};
  inst.setData({ winIdx: inst.wins.findIndex((w) => w.key === "ytd"), isCustom: false });
  inst.render();
  inst.data.rows.forEach((r) => (ytdRows[r.code] = r.pct));
  await inst.onWin({ detail: { value: inst.wins.length } });
  inst.setData({ m0Idx: monthly.months.indexOf(prevDec), m1Idx: monthly.months.length - 1 });
  inst.render();
  let diffN = 0;
  inst.data.rows.forEach((r) => {
    const a = parseFloat(r.pct), b = parseFloat(ytdRows[r.code]);
    if (!isNaN(a) && !isNaN(b) && Math.abs(a - b) > 0.02) {
      diffN++; if (diffN <= 3) console.log(`  ✗ ${r.country}: 自定义 ${r.pct} vs 今年以来 ${ytdRows[r.code]}`);
    }
  });
  check(diffN === 0, `自定义区间与预置今年以来有 ${diffN} 处不一致`);
  console.log(diffN === 0 ? "  与预置「今年以来」逐项一致 ✅" : "");

  // ---- 自定义月度区间：穷举两个 picker 的每一种选择 ----
  //
  // 上一轮的「互相约束」是事后夹紧，留了两个洞：终点选第一项 → m0Idx = -1 →
  // 标题「undefined 月末」+ 空榜 + 零提示；起点选最后一项 → 被压回去变成起止同月。
  // 现在两个 picker 各有自己的 range，非法项不出现在列表里。
  // 穷举比举例可靠——这两个洞当初就是「看起来两边都夹了」才漏掉的。
  console.log("\n自定义月度区间 · 穷举 picker 选择:");
  const mn = inst.data.monthOptions.length;
  let bad = 0;
  const audit = (how) => {
    const d = inst.data;
    if (d.m0Idx < 0 || d.m0Idx > mn - 2) { bad++; if (bad <= 3) console.log(`  ✗ ${how}: m0Idx=${d.m0Idx} 越界`); return; }
    if (d.m1Idx <= d.m0Idx || d.m1Idx > mn - 1) { bad++; if (bad <= 3) console.log(`  ✗ ${how}: m1Idx=${d.m1Idx} 不晚于起点或越界`); return; }
    if (d.m1Sel !== d.m1Idx - d.m0Idx - 1) { bad++; if (bad <= 3) console.log(`  ✗ ${how}: m1Sel 与 m1Idx 对不上`); return; }
    if (d.m1Options[d.m1Sel] !== d.monthOptions[d.m1Idx]) { bad++; if (bad <= 3) console.log(`  ✗ ${how}: 终点 picker 显示的月份不是实际起算月份`); return; }
    inst.render();
    if (/undefined/.test(inst.data.sub + inst.data.ledeHead)) { bad++; if (bad <= 3) console.log(`  ✗ ${how}: 标题里出现 undefined「${inst.data.ledeHead}」`); return; }
    if (!inst.data.rows.length && !inst.data.naRows.length) { bad++; if (bad <= 3) console.log(`  ✗ ${how}: 榜单为空且无任何解释`); }
  };
  for (let i = 0; i < inst.data.m0Options.length; i++) { inst.onM0({ detail: { value: i } }); audit(`起点选第 ${i} 项`); }
  inst.onM0({ detail: { value: 0 } });
  for (let j = 0; j < inst.data.m1Options.length; j++) { inst.onM1({ detail: { value: j } }); audit(`终点选第 ${j} 项`); }
  // picker 给的值本不该越界，但组件行为不归我们管，兜一下
  [-1, mn, mn + 5].forEach((v) => { inst.onM0({ detail: { value: v } }); audit(`起点收到越界值 ${v}`); });
  [-1, mn, mn + 5].forEach((v) => { inst.onM1({ detail: { value: v } }); audit(`终点收到越界值 ${v}`); });
  check(bad === 0, `月度区间 picker 有 ${bad} 种选择会产生非法状态`);
  console.log(bad === 0 ? `  ${inst.data.m0Options.length} + ${mn - 1} 种选择 + 6 个越界值，全部合法 ✅` : "");

  // ---- 口径说明页与代码是否还对得上 ----
  //
  // 加这一节是因为：修复时新写了「口径不完整的市场」一节，旧的「汇率缺失」一节
  // 忘了删，于是同一个页面对「缺汇率的市场参不参与排名」给出了两个相反的答案——
  // 而这恰好是整个产品被讨论最多的一个设计决策。
  // 文案会漂，这几条断言丑但会红。
  console.log("\n口径说明页 vs 代码:");
  const about = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "about", "about.wxml"), "utf8");
  const docFail = [];
  if (/仍参与排名/.test(about) && /不参与排名/.test(about))
    docFail.push("about 页同时出现「仍参与排名」和「不参与排名」——自相矛盾");
  // 代码确实把缺口径的行移出排序（index.js 的三分法），说明页必须这么写
  if (!/不参与排名/.test(about))
    docFail.push("代码把缺口径的行移出了排名，说明页却没说");
  // 回溯上限会让「明明有数据」的区间显示「—」，说明页不提的话用户无从理解
  if (!/回溯|长假|休市/.test(about))
    docFail.push("代码有起点回溯上限，说明页没有任何解释");
  // 频率校验会丢弃源里存在的数据，不说的话 meta.start 就是一句关于数据源的假话
  if (!/剔除|密度|月频/.test(about))
    docFail.push("构建会剔除月频数据，说明页没说");
  docFail.forEach((f) => { fail.push(f); console.log("  ✗ " + f); });
  if (!docFail.length) console.log("  说明页与代码一致 ✅");

  console.log();
  if (fail.length) { console.log("❌ 发现问题:"); fail.forEach((f) => console.log("  " + f)); process.exit(1); }
  console.log("✅ 页面逻辑全部检查通过");
})();
