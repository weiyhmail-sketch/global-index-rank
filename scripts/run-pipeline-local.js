/** 本地跑一遍云函数的取数+计算逻辑（不写库），用于计时与结果核对。 */
const { INDICES, CURRENCIES } = require("../cloudfunctions/lib/indices.js");
const { fetchIndex } = require("../cloudfunctions/lib/sources.js");
const { fetchFX } = require("../cloudfunctions/lib/fx.js");
const { buildSnapshot } = require("../cloudfunctions/lib/snapshot.js");

async function pool(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  return out;
}

(async () => {
  const T = {};
  let t = Date.now();

  const series = {}, failed = [];
  await pool(INDICES, 6, async (m) => {
    try { series[m.code] = await fetchIndex(m); }
    catch (e) { failed.push(`${m.code}(${m.src}/${m.sym}): ${e.message}`); }
  });
  T.抓指数 = Date.now() - t; t = Date.now();

  const end = new Date().toISOString().slice(0, 10);
  const fx = await fetchFX(CURRENCIES, end);
  T.抓汇率 = Date.now() - t; t = Date.now();

  const { meta, snapshot } = buildSnapshot(INDICES.filter((m) => series[m.code]), series, fx.rates);
  T.算快照 = Date.now() - t;

  console.log("耗时(ms):", JSON.stringify(T), " 合计", Object.values(T).reduce((a, b) => a + b, 0));
  console.log(`指数 ${meta.length}/${INDICES.length}，国家 ${new Set(meta.map((m) => m.country)).size}，汇率 ${Object.keys(fx.rates).length} 种，缺失 [${fx.missing}]`);
  if (failed.length) { console.log("失败:"); failed.forEach((f) => console.log("  " + f)); }

  const bytes = Buffer.byteLength(JSON.stringify({ meta, snapshot }));
  const seriesBytes = Buffer.byteLength(JSON.stringify(series));
  console.log(`快照体积 ${(bytes / 1024).toFixed(0)} KB（客户端首屏读这个）；全部序列 ${(seriesBytes / 1024 / 1024).toFixed(2)} MB`);

  const rows = meta.filter((m) => m.tier === "core").map((m) => ({ m, v: snapshot[m.code].ytd.cny }))
    .filter((r) => r.v !== null).sort((a, b) => b.v - a.v);
  console.log("\n核心12国 · 今年以来 · 人民币口径:");
  rows.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)} ${r.m.flag} ${r.m.country.padEnd(5)} ${(r.v >= 0 ? "+" : "") + r.v.toFixed(2)}%`));
})();
