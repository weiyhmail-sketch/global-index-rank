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
  const truncated = {};   // code -> { srcStart, cut, dropped }，写进 meta 供界面说明
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
    // 截到密度真正转折的那一天，而不是下一个日历年的年初。
    //
    // 原来取 `d.slice(0,4) > cutYear` 的第一个观测，注释却写着「观测密度正常的
    // 日期」—— 两者不是一回事。巴基斯坦源里日频其实从 2023-11-16 就开始了，
    // 按日历年切会把 11-16 到 12-29 那约 30 个完全正常的日频点一起丢掉，
    // 代价是「近3年」要晚一个半月才恢复。
    const after = ks.filter((d) => d.slice(0, 4) > cutYear);
    if (!after.length) continue;
    let cut = after[0];
    // 在稀疏年内部找日频真正开始的那一点。
    //
    // 判据用「窗口内每一个间隔都 ≤5 天」，不用平均间隔：平均会把转折点前
    // 那个大缺口一起吞进来。巴基斯坦的序列是 … 2023-11-01, 2023-11-16,
    // 2023-11-17, 2023-11-20 …，11-01 是最后一个月频点，它到 11-16 隔了 15 天。
    // 按平均判会从 11-01 起算（20 个点跨 30 天，均值 1.5 天，看着很密），
    // 于是序列开头挂着一个 15 天的缺口 —— 而回溯上限正是按观测间隔自适应的，
    // 这个缺口会把它撑大，等于自己给自己松了闸。
    // 5 天的容忍度覆盖周末加一个假日。
    const inCut = ks.filter((d) => d.slice(0, 4) === cutYear);
    const W = 20, MAX_OK_GAP = 5;
    const gapAt = (a, b) => (new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000;
    for (let i = 0; i + W < inCut.length; i++) {
      let dense = true;
      for (let k = i; k < i + W; k++) if (gapAt(inCut[k], inCut[k + 1]) > MAX_OK_GAP) { dense = false; break; }
      if (dense) { cut = inCut[i]; break; }
    }
    const dropped = ks.filter((d) => d < cut).length;
    const srcStart = ks[0];
    series[m.code] = Object.fromEntries(ks.filter((d) => d >= cut).map((d) => [d, raw[d]]));
    // 截断这件事必须记下来并展示。不记的话 meta.start 会变成一句关于数据源的
    // 假话：界面写「数据自 2024-01-01 起」，而源里其实有 2020 年起的数据，
    // 是我们丢掉的。用户无从得知，也无从判断这个判断合不合理。
    truncated[m.code] = { srcStart, cut, dropped, cutYear, perYear: byYear[cutYear] };
    freqNotes.push(`${m.country} ${m.name}: ${cutYear} 年及以前为月频（每年 ${byYear[cutYear]} 条），已截断，丢弃 ${dropped} 条（源自 ${srcStart}），日频自 ${cut} 起`);
  }
  if (freqNotes.length) {
    console.log("\n频率校验：");
    freqNotes.forEach((n) => console.log("  ⚠️ " + n));
  }

  const got = INDICES.filter((m) => series[m.code]);
  const { meta, snapshot, windows, anchorMeta } = buildSnapshot(got, series, fx.rates, { anchors: ANCHORS, fxStale: fx.fxStale });
  // 把频率截断挂到 meta 上。meta.start 只说「我们手里的数据从哪天起」，
  // 不说「源里只有这么多」—— 差别要让用户看得见，否则那就是一句假话。
  for (const m of meta) {
    const t = truncated[m.code];
    if (t) { m.srcStart = t.srcStart; m.truncNote = `${t.cutYear} 年及以前源数据为月频，已剔除；日频自 ${t.cut} 起`; }
  }
  const rankDelta = buildRankDelta(got, series, fx.rates, { days: 7, anchors: ANCHORS, fxStale: fx.fxStale });
  const monthly = buildMonthly(got, series, fx.rates, { years: 6, fxStale: fx.fxStale });
  const yearly = buildYearly(monthly, { years: 6 });
  const asofs = meta.map((m) => m.asof).sort();

  // 一次构建一个时间戳，所有产物共用。
  //
  // 原先每个产物各调一次 new Date()，毫秒都不一样，跨产物比对永远不相等——
  // 而客户端正需要比对：对冲取数之后，快照可能来自 raw(今天)、
  // 走势图可能来自 jsDelivr(上一版)，于是详情页标题的涨幅和曲线来自不同构建。
  // 统一成一个 id，客户端才能发现并如实说明。
  const GENERATED = new Date().toISOString();

  fs.writeFileSync(fxPath, JSON.stringify(fx));
  fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify({
    generated: GENERATED,
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
    generated: GENERATED, dataAsof: asofs[asofs.length - 1] || null, ...monthly,
  }));
  // 整包 series.json 保留（便于本地调试），但云函数不用它：
  // gzip 后仍有 329 KB、实测 2.57 秒，离 3 秒超时太近。
  fs.writeFileSync(path.join(OUT, "series.json"), JSON.stringify({
    generated: GENERATED,
    data: Object.fromEntries(Object.entries(series).map(([c, d]) =>
      [c, Object.entries(d).sort((a, b) => (a[0] < b[0] ? -1 : 1))])),
  }));

  // 按指数拆分：单个 19-144 KB，云函数可按需取单个（详情图）
  // 或并行取全部（自定义区间）。
  const seriesDir = path.join(OUT, "series");
  fs.mkdirSync(seriesDir, { recursive: true });
  for (const [code, d] of Object.entries(series)) {
    const pairs = Object.entries(d).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    fs.writeFileSync(path.join(seriesDir, code + ".json"), JSON.stringify({ generated: GENERATED, code, n: pairs.length, data: pairs }));
  }
  // 走势图分片：近 5 年 × 三种口径，供详情页使用
  const chartDir = path.join(OUT, "chart");
  fs.mkdirSync(chartDir, { recursive: true });
  const fxPairs = Object.fromEntries(Object.entries(fx.rates).map(([c, s]) => [c, toPairs(s)]));
  for (const m of got) {
    const c = buildChart(m, series[m.code], fxPairs, { years: 5, fxStale: fx.fxStale });
    fs.writeFileSync(path.join(chartDir, m.code + ".json"),
      JSON.stringify({ generated: GENERATED, code: m.code, ccy: m.ccy, n: c.dates.length, ...c }));
  }

  // 索引文件，供客户端/云函数知道有哪些可取
  fs.writeFileSync(path.join(seriesDir, "_index.json"), JSON.stringify({
    generated: GENERATED,
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
  //
  // 这道守卫上一轮写完就没运行过：prev-snapshot.json 没人写、workflow 也不下载，
  // existsSync 恒为 false。第二轮审查逐条查出来的第三个「写了防护但防护够不着」。
  // 现在 daily.yml 会把上一轮的 snapshot.json 下载成 prev-snapshot.json，
  // 本地跑则用上一次构建自己留下的副本；两边都取不到才跳过。
  const prevSnapPath = path.join(OUT, "prev-snapshot.json");
  if (!fs.existsSync(prevSnapPath)) {
    console.log("\n⚠️  没有上一轮产物可比对（prev-snapshot.json 不存在），本次跳过数量守卫");
  } else {
    try {
      const prev = JSON.parse(fs.readFileSync(prevSnapPath, "utf8"));
      if (prev.meta && prev.meta.length > meta.length) {
        const lost = prev.meta.filter((a) => !meta.some((b) => b.code === a.code));
        console.error(`\n❌ 指数数量下降：${prev.meta.length} → ${meta.length}`);
        lost.forEach((m) => console.error(`   丢失 ${m.flag} ${m.country} ${m.name} (${m.code})`));
        process.exit(1);
      }
      console.log(`\n数量守卫：上一轮 ${prev.meta.length} 个指数，本轮 ${meta.length} 个 ✓`);
    } catch (e) {
      console.log(`\n⚠️  上一轮产物无法解析（${e.message}），本次跳过数量守卫`);
    }
  }

  // 留给下一轮比对用。本地连跑两次就能形成闭环，不依赖 workflow。
  fs.copyFileSync(path.join(OUT, "snapshot.json"), prevSnapPath);

  if (meta.length === 0) process.exit(1);
})();
