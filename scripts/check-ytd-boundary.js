/**
 * 跨年那几天，「今年以来」不能把去年全年当成今年。
 *
 * 第三轮审计发现：ytd 起点原先按各指数自己的 asof 取年份。1 月 2 日构建时
 * 东京（1/1–1/3 休市）和 A 股还停在去年 12 月，它们的「今年以来」其实是
 * 去年全年——把数据截到 2026-01-02 实测，日本 +22.05%、中国 +18.41%
 * 占住核心榜前两名，其余市场都在 ±3% 以内。一年只有两三天会出事，
 * 所以日常构建永远走不到，必须把数据截到年初逼它触发。
 */
const fs = require("fs");
const path = require("path");
const { buildSnapshot } = require(path.join(__dirname, "..", "cloudfunctions", "lib", "snapshot.js"));

const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist", f), "utf8"));
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const seriesRaw = D("series.json").data;
const fx = D("fx.json");
const indices = D("snapshot.json").meta.map((m) => ({ ...m }));

// 取数据里最近一个完整的年初：那一年的 1 月 2 日
const lastYear = Object.values(seriesRaw).map((a) => a[a.length - 1][0]).sort().pop().slice(0, 4);
const CUT = `${lastYear}-01-02`;
const series = Object.fromEntries(Object.entries(seriesRaw).map(([c, a]) =>
  [c, Object.fromEntries(a.filter((p) => p[0] <= CUT))]));
const s = buildSnapshot(indices, series, fx.rates, { fxStale: [] });

const behind = s.meta.filter((m) => m.asof.slice(0, 4) < lastYear);
console.log(`把数据截到 ${CUT}：${behind.length} 个指数今年还没开市（${behind.map((m) => m.country + " " + m.asof).join("、")}）`);
check(behind.length > 0, `截到 ${CUT} 后没有一个指数停在去年，这个用例没测到东西`);

for (const m of behind) {
  const r = s.snapshot[m.code].ytd;
  check(r.local === null && r.usd === null && r.cny === null,
    `${m.country} ${m.name} 今年还没开市（asof ${m.asof}），「今年以来」却有值 ${r.cny}——那是去年全年`);
  check(r.why === "notyet", `${m.country} 的 ytd 缺值原因应为 notyet，实际 ${r.why}`);
}
// 已经开市的指数不受影响
const opened = s.meta.filter((m) => m.asof.slice(0, 4) === lastYear);
check(opened.every((m) => s.snapshot[m.code].ytd.local !== null || s.snapshot[m.code].ytd.why),
  "已开市的指数 ytd 无值也无原因");

// 平时（不截断）不应出现 notyet
const full = buildSnapshot(indices,
  Object.fromEntries(Object.entries(seriesRaw).map(([c, a]) => [c, Object.fromEntries(a)])), fx.rates, { fxStale: [] });
const nNot = Object.values(full.snapshot).filter((r) => r.ytd.why === "notyet").length;
check(nNot === 0, `完整数据上仍有 ${nNot} 个指数被判为今年未开市`);

// 客户端要把原因说出来，而不是一个光秃秃的「—」
let inst = null;
global.Page = (o) => { inst = Object.assign({}, o); inst.data = Object.assign({}, o.data); inst.setData = function (x) { Object.assign(this.data, x); }; };
const snap = { ok: true, ...D("snapshot.json"), ...s };
global.wx = { cloud: { callFunction: async () => ({ result: snap }) }, stopPullDownRefresh() {} };
require(path.join(__dirname, "..", "miniprogram", "pages", "index", "index.js"));
(async () => {
  await inst.load();
  inst.setData({ tierIdx: 2 }); inst.render();
  const top = inst.data.rows[0];
  console.log(`  今年以来·全部 榜首：${top.country} ${top.pct}`);
  check(!behind.some((m) => m.code === top.code), `榜首 ${top.country} 是一个今年还没开市的指数`);
  const na = inst.data.naRows.find((r) => r.code === behind[0].code);
  console.log(`  ${behind[0].country} 显示为：「${na && na.naNote}」`);
  check(na && /尚未开市/.test(na.naNote), `${behind[0].country} 落进了数据不足区，但没说是今年尚未开市`);

  console.log(fails.length ? "\n❌ " + fails.join("\n❌ ") : "\n✅ 跨年时「今年以来」不会把去年全年算进来");
  process.exit(fails.length ? 1 : 0);
})();
