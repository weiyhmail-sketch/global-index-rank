/**
 * 汇率停更时，外币口径必须置空并说明原因。
 *
 * 为什么单独写：fx.js 算出 fxStale、经 build-data.js 写进快照、由 get-snapshot
 * 回传，一路传了三层，而客户端零引用、buildSnapshot 也完全不看它——
 * 注释里承诺的「诚实退回原币」在计算侧和展示侧都没实现，只产出了一个列表。
 * 这是第二轮审查找出的第四个「写了防护但防护够不着」。
 *
 * 线上 fxStale 平时是空的，所以这条路不会被日常构建走到。
 * 必须主动注入一个停更货币，逼它触发。
 *
 * 阈值余量（实测 dist/fx.json，20 个币种 3002 个观测）：
 *   历史最大发布间隔 5 天（2015 年复活节），SOFT_STALE_DAYS=7 有 2 天余量。
 *   审查担心的「欧洲圣诞长假误报」在真实数据里不成立。
 */
const fs = require("fs");
const path = require("path");
const { buildSnapshot, buildMonthly, buildYearly, buildChart, toPairs } =
  require(path.join(__dirname, "..", "cloudfunctions", "lib", "snapshot.js"));

const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist", f), "utf8"));
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const seriesRaw = D("series.json").data;
const series = Object.fromEntries(Object.entries(seriesRaw).map(([c, a]) => [c, Object.fromEntries(a)]));
const fx = D("fx.json");
const snapMeta = D("snapshot.json").meta;
const indices = snapMeta.map((m) => ({ ...m }));

// 挑一个非美元、非人民币的货币来做停更实验
const victim = snapMeta.find((m) => m.ccy !== "USD" && m.ccy !== "CNY" && m.canFx);
console.log(`实验对象：${victim.country} · ${victim.name}（本币 ${victim.ccy}）`);

const base = buildSnapshot(indices, series, fx.rates, { fxStale: [] });
const stale = buildSnapshot(indices, series, fx.rates, { fxStale: [{ ccy: victim.ccy, lag: 12 }] });

const b = base.snapshot[victim.code].ytd, s = stale.snapshot[victim.code].ytd;
console.log(`  正常时  今年以来: local=${b.local} usd=${b.usd} cny=${b.cny}`);
console.log(`  停更后  今年以来: local=${s.local} usd=${s.usd} cny=${s.cny}`);

check(b.cny !== null && b.usd !== null, "实验对象在正常情况下就没有外币口径，换一个");
check(s.usd === null && s.cny === null, "汇率停更后外币口径仍有值——还在拿陈旧汇率硬算");
check(s.local === b.local, "汇率停更不该影响原币口径");

// 停更货币的 meta 必须显示为不可换算，客户端据此把它归进「仅原币」分区
const vm = stale.meta.find((m) => m.code === victim.code);
check(vm && vm.canFx === false, "停更货币的 canFx 仍为 true");
console.log(`  canFx: ${base.meta.find((m) => m.code === victim.code).canFx} → ${vm && vm.canFx}`);

// 只影响该货币，不能波及别人
const other = snapMeta.find((m) => m.ccy !== victim.ccy && m.ccy !== "CNY" && m.canFx);
const ob = base.snapshot[other.code].ytd, os = stale.snapshot[other.code].ytd;
check(os.cny === ob.cny, `波及了无关市场 ${other.country}：${ob.cny} → ${os.cny}`);
console.log(`  无关市场 ${other.country}（${other.ccy}）: ${ob.cny} → ${os.cny}`);

// 人民币自己停更 → 所有外币口径都不可信
const cnyStale = buildSnapshot(indices, series, fx.rates, { fxStale: [{ ccy: "CNY", lag: 9 }] });
const nCny = Object.values(cnyStale.snapshot).filter((r) => r.ytd && r.ytd.cny !== null).length;
console.log(`  人民币汇率停更时，仍有人民币口径的市场数: ${nCny}`);
check(nCny === 0, `人民币汇率停更，却还有 ${nCny} 个市场给出了人民币涨幅`);

// ---- 另外三份产物：月末点位、逐年、走势图 ----
//
// 第三轮审计发现这道防护只做在了快照上：同一个停更货币，快照是「—」，
// 自定义区间却拿陈旧汇率算出数来参与排名，详情页逐年列表和走势图也照画。
// 所以这里直接看产物，并把自定义区间的排名逻辑也跑一遍。
const stl = [{ ccy: victim.ccy, lag: 12 }];
const monBase = buildMonthly(indices, series, fx.rates, {});
const monStale = buildMonthly(indices, series, fx.rates, { fxStale: stl });
const L = monStale.levels[victim.code];
check(monBase.levels[victim.code].cny.some((v) => v !== null), "正常情况下月末点位就没有人民币口径，实验无效");
check(L.cny.every((v) => v === null) && L.usd.every((v) => v === null),
  "月末点位仍用陈旧汇率算出了外币口径——自定义区间会拿它参与排名");
check(JSON.stringify(L.local) === JSON.stringify(monBase.levels[victim.code].local), "汇率停更不该影响月末原币点位");
const yr = buildYearly(monStale)[victim.code] || [];
check(yr.every((r) => r.cny === null && r.usd === null), "逐年涨幅仍用陈旧汇率给出了外币口径");
const fxPairs = Object.fromEntries(Object.entries(fx.rates).map(([c, s]) => [c, toPairs(s)]));
const vIdx = indices.find((m) => m.code === victim.code);
check(!!buildChart(vIdx, series[victim.code], fxPairs, {}).cny, "正常情况下走势图就没有人民币口径，实验无效");
const ch = buildChart(vIdx, series[victim.code], fxPairs, { fxStale: stl });
check(!ch.cny && !ch.usd, "走势图仍用陈旧汇率画出了外币口径曲线");
console.log(`  月末点位 cny 非空 ${L.cny.filter((v) => v !== null).length} 个 · 逐年 cny 非空 ${yr.filter((r) => r.cny !== null).length} 个 · 走势图 cny ${ch.cny ? "有" : "无"}`);

// 客户端自定义区间：停更市场必须落进「仅原币」分区，不能出现在排名里
let inst = null;
global.Page = (o) => { inst = Object.assign({}, o); inst.data = Object.assign({}, o.data); inst.setData = function (x) { Object.assign(this.data, x); }; };
const snapStale = { ok: true, ...D("snapshot.json"), ...buildSnapshot(indices, series, fx.rates, { fxStale: stl }), fxStale: stl };
global.wx = { cloud: { callFunction: async ({ name }) => ({ result: name === "get-monthly"
  ? { ok: true, dataAsof: snapStale.dataAsof, ...monStale } : snapStale }) }, stopPullDownRefresh() {} };
require(path.join(__dirname, "..", "miniprogram", "pages", "index", "index.js"));
(async () => {
  await inst.load();
  inst.setData({ tierIdx: 2 });
  await inst.onWin({ detail: { value: inst.wins.length } });
  const ranked = inst.data.rows.some((r) => r.code === victim.code);
  const fbRow = inst.data.fbRows.some((r) => r.code === victim.code);
  console.log(`  自定义区间：${victim.country} ${ranked ? "参与了排名" : fbRow ? "在「仅原币」分区" : "不在榜上"}`);
  check(!ranked && fbRow, `自定义区间里 ${victim.country} 仍拿陈旧汇率参与排名`);

  console.log(fails.length ? "\n❌ " + fails.join("\n❌ ") : "\n✅ 汇率停更时会如实退回原币口径");
process.exit(fails.length ? 1 : 0);
})();
