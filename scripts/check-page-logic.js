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

  console.log();
  if (fail.length) { console.log("❌ 发现问题:"); fail.forEach((f) => console.log("  " + f)); process.exit(1); }
  console.log("✅ 页面逻辑全部检查通过");
})();
