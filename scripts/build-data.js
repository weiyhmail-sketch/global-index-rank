#!/usr/bin/env node
/**
 * 在 GitHub Actions 中跑完整管线，产出两个供云函数取用的 JSON。
 *
 * 为什么放在 Actions 而不是云函数里：
 * 云开发免费版云函数超时固定 3 秒且不可调（调高需付费版），
 * 33 个指数 + 汇率跑不完。Actions 无此限制，且新浪四条线在 Azure 出口 IP 均可达。
 * 云函数因此退化成「取 JSON 写库」的轻活，稳落在 3 秒内。
 *
 * 跑的是 cloudfunctions/lib 下与云函数完全相同的代码，不维护第二套实现。
 *
 * 输出：
 *   dist/snapshot.json  约 19 KB —— 排行榜首屏，客户端直接读
 *   dist/series.json    约 1 MB  —— 日线序列，供云函数算自定义区间与详情图
 */
const fs = require("fs");
const path = require("path");
const { INDICES, GROUP_NAMES, TIER_NAMES, CURRENCIES } = require("../cloudfunctions/lib/indices.js");
const { fetchIndex } = require("../cloudfunctions/lib/sources.js");
const { fetchFX } = require("../cloudfunctions/lib/fx.js");
const { buildSnapshot, buildRankDelta, buildMonthly, buildChart, buildYearly, toPairs } = require("../cloudfunctions/lib/snapshot.js");

const OUT = path.join(__dirname, "..", "dist");
const ANCHORS = [
  { date: "2020-03-23", label: "疫情底" },
  { date: "2022-10-12", label: "美股熊市底" },
  { date: "2024-09-18", label: "中国行情起点" },
  { date: "2025-04-07", label: "关税冲击日" },
];

async function pool(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  return out;
}

(async () => {
  const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });

  // 复用上一轮的汇率做增量：全量回补约 30 秒、900 次 CDN 请求，每天重跑是纯浪费
  let prevFx = null;
  const fxPath = path.join(OUT, "fx.json");
  if (fs.existsSync(fxPath)) {
    try { prevFx = JSON.parse(fs.readFileSync(fxPath, "utf8")).rates; } catch (e) { /* 损坏则全量重建 */ }
  }

  const series = {}, failed = [];
  await pool(INDICES, 6, async (m) => {
    try {
      series[m.code] = await fetchIndex(m);
      console.log(`  ✅ ${m.flag} ${m.country} ${m.name} — ${Object.keys(series[m.code]).length} 条`);
    } catch (e) {
      failed.push({ code: m.code, src: m.src, sym: m.sym, err: String(e.message || e).slice(0, 80) });
      console.log(`  ❌ ${m.flag} ${m.country} ${m.name} — ${e.message}`);
    }
  });

  const end = new Date().toISOString().slice(0, 10);
  const fx = await fetchFX(CURRENCIES, end, prevFx);
  console.log(`汇率：${Object.keys(fx.rates).length} 种${fx.missing.length ? "，缺失 " + fx.missing.join(",") : ""}`);

  // A6：频率校验。抓到不等于抓对——新浪对巴基斯坦 KSE100 在 2023-11 之前
  // 每月只给一条，混进日频榜单后「近3年」的起点会偏 17 天，而且它当时就是榜首。
  // 完整年份（非首尾年）观测数低于 180 条即判为非日频，把该指数的历史
  // 截断到日频开始那天，让更早的窗口显示「—」。
  const SPARSE_THRESHOLD = 180;
  const freqNotes = [];
  for (const m of INDICES) {
    const raw = series[m.code];
    if (!raw) continue;
    const ks = Object.keys(raw).sort();
    const byYear = {};
    ks.forEach((d) => (byYear[d.slice(0, 4)] = (byYear[d.slice(0, 4)] || 0) + 1));
    const years = Object.keys(byYear).sort();
    if (years.length < 3) continue;
    // 从后往前找第一个稀疏的完整年份，其后一年的年初即为日频起点
    let cutYear = null;
    for (let i = years.length - 2; i >= 1; i--) {
      if (byYear[years[i]] < SPARSE_THRESHOLD) { cutYear = years[i]; break; }
    }
    if (!cutYear) continue;
    // 截到该稀疏年之后第一个观测密度正常的日期
    const after = ks.filter((d) => d.slice(0, 4) > cutYear);
    if (!after.length) continue;
    const cut = after[0];
    const dropped = ks.filter((d) => d < cut).length;
    series[m.code] = Object.fromEntries(ks.filter((d) => d >= cut).map((d) => [d, raw[d]]));
    freqNotes.push(`${m.country} ${m.name}: ${cutYear} 年及以前为月频（每年 ${byYear[cutYear]} 条），已截断，丢弃 ${dropped} 条，日频自 ${cut} 起`);
  }
  if (freqNotes.length) {
    console.log("\n频率校验：");
    freqNotes.forEach((n) => console.log("  ⚠️ " + n));
  }

  const got = INDICES.filter((m) => series[m.code]);
  const { meta, snapshot, windows, anchorMeta } = buildSnapshot(got, series, fx.rates, { anchors: ANCHORS });
  const rankDelta = buildRankDelta(got, series, fx.rates, { days: 7, anchors: ANCHORS });
  const monthly = buildMonthly(got, series, fx.rates, { years: 6 });
  const yearly = buildYearly(monthly, { years: 6 });
  const asofs = meta.map((m) => m.asof).sort();

  fs.writeFileSync(fxPath, JSON.stringify(fx));
  fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify({
    generated: new Date().toISOString(),
    dataAsof: asofs[asofs.length - 1] || null,
    countries: new Set(meta.map((m) => m.country)).size,
    windows, anchors: ANCHORS.map((a) => {
      const am = anchorMeta.find((x) => x.key === "anchor:" + a.date) || {};
      return { ...a, days: am.days, n: am.n };
    }),
    fxStale: fx.fxStale || [], groupNames: GROUP_NAMES, tierNames: TIER_NAMES,
    fxMissing: fx.missing, rankDeltaDays: 7,
    meta, snapshot, rankDelta, yearly,
  }));
  // monthly 占快照六成体积，而首屏用不到它（只有自定义区间需要），
  // 单独成文件以保证每日 ingest 轻快。
  fs.writeFileSync(path.join(OUT, "monthly.json"), JSON.stringify({
    generated: new Date().toISOString(), dataAsof: asofs[asofs.length - 1] || null, ...monthly,
  }));
  // 整包 series.json 保留（便于本地调试），但云函数不用它：
  // gzip 后仍有 329 KB、实测 2.57 秒，离 3 秒超时太近。
  fs.writeFileSync(path.join(OUT, "series.json"), JSON.stringify({
    generated: new Date().toISOString(),
    data: Object.fromEntries(Object.entries(series).map(([c, d]) =>
      [c, Object.entries(d).sort((a, b) => (a[0] < b[0] ? -1 : 1))])),
  }));

  // 按指数拆分：单个 19-144 KB，云函数可按需取单个（详情图）
  // 或并行取全部（自定义区间）。
  const seriesDir = path.join(OUT, "series");
  fs.mkdirSync(seriesDir, { recursive: true });
  for (const [code, d] of Object.entries(series)) {
    const pairs = Object.entries(d).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    fs.writeFileSync(path.join(seriesDir, code + ".json"), JSON.stringify({ code, n: pairs.length, data: pairs }));
  }
  // 走势图分片：近 5 年 × 三种口径，供详情页使用
  const chartDir = path.join(OUT, "chart");
  fs.mkdirSync(chartDir, { recursive: true });
  const fxPairs = Object.fromEntries(Object.entries(fx.rates).map(([c, s]) => [c, toPairs(s)]));
  for (const m of got) {
    const c = buildChart(m, series[m.code], fxPairs, { years: 5 });
    fs.writeFileSync(path.join(chartDir, m.code + ".json"),
      JSON.stringify({ code: m.code, ccy: m.ccy, n: c.dates.length, ...c }));
  }

  // 索引文件，供客户端/云函数知道有哪些可取
  fs.writeFileSync(path.join(seriesDir, "_index.json"), JSON.stringify({
    generated: new Date().toISOString(),
    codes: Object.keys(series).sort(),
  }));

  const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
  console.log(`\n指数 ${meta.length}/${INDICES.length}，国家 ${new Set(meta.map((m) => m.country)).size}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const nSeries = fs.readdirSync(path.join(OUT, "series")).length - 1;
  const chartSizes = fs.readdirSync(path.join(OUT, "chart")).map((f) => fs.statSync(path.join(OUT, "chart", f)).size);
  console.log(`snapshot.json ${kb("snapshot.json")} KB · monthly.json ${kb("monthly.json")} KB · series.json ${(kb("series.json") / 1024).toFixed(2)} MB · fx.json ${kb("fx.json")} KB · series/ ${nSeries} 个分片 · chart/ ${chartSizes.length} 个（${(Math.max(...chartSizes) / 1024).toFixed(0)} KB 最大）`);
  if (failed.length) {
    console.log("\n失败明细：");
    failed.forEach((f) => console.log(`  ${f.code} (${f.src}/${f.sym}): ${f.err}`));
  }
  // 与上一轮比对指数数量。
  //
  // 「全挂才失败」太宽松：单个指数抓取失败会被静默过滤掉，快照里直接少一行，
  // 副标题的国家数跟着变，没有任何人会注意到。拿上一轮的产物比一下最便宜。
  const prevSnapPath = path.join(OUT, "prev-snapshot.json");
  if (fs.existsSync(prevSnapPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevSnapPath, "utf8"));
      if (prev.meta && prev.meta.length > meta.length) {
        const lost = prev.meta.filter((a) => !meta.some((b) => b.code === a.code));
        console.error(`\n❌ 指数数量下降：${prev.meta.length} → ${meta.length}`);
        lost.forEach((m) => console.error(`   丢失 ${m.flag} ${m.country} ${m.name} (${m.code})`));
        process.exit(1);
      }
    } catch (e) { /* 上一轮产物损坏则跳过比对 */ }
  }

  if (meta.length === 0) process.exit(1);
})();
