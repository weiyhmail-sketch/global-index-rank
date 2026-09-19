/**
 * daily-sync —— 每日抓取 + 预计算 + 落库。
 *
 * 客户端只读一张已算好的快照表，不做任何计算：
 * 这既是为了秒开，也是为了不让 33 个数据源请求发生在用户设备上。
 *
 * 入参（均可选）：
 *   codes  只同步指定指数（逗号分隔或数组），用于排障
 *   skipFx 跳过汇率抓取，复用库里已有的
 */
const cloud = require("wx-server-sdk");
const { INDICES, GROUP_NAMES, TIER_NAMES, CURRENCIES } = require("./indices");
const { fetchIndex } = require("./sources");
const { fetchFX } = require("./fx");
const { buildSnapshot } = require("./snapshot");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COL_SERIES = "index_series";
const COL_SNAPSHOT = "index_snapshot";
const COL_FX = "fx_daily";

const ANCHORS = [
  { date: "2020-03-23", label: "疫情底" },
  { date: "2022-10-12", label: "美股熊市底" },
  { date: "2024-09-18", label: "中国行情起点" },
  { date: "2025-04-07", label: "关税冲击日" },
];

async function ensureCollection(name) {
  try { await db.createCollection(name); } catch (e) { /* 已存在 */ }
}

/** 有限并发跑任务，避免同时打爆上游。 */
async function pool(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}

async function upsert(col, id, doc) {
  try {
    await db.collection(col).doc(id).set({ data: doc });
  } catch (e) {
    await db.collection(col).add({ data: { _id: id, ...doc } });
  }
}

exports.main = async (event = {}) => {
  const t0 = Date.now();
  const log = [];
  const only = event.codes
    ? new Set(Array.isArray(event.codes) ? event.codes : String(event.codes).split(","))
    : null;
  const todo = only ? INDICES.filter((i) => only.has(i.code)) : INDICES;

  await Promise.all([COL_SERIES, COL_SNAPSHOT, COL_FX].map(ensureCollection));

  // ---- 1. 抓指数 ----
  const seriesByCode = {};
  const failed = [];
  const results = await pool(todo, 6, async (m) => {
    try {
      const data = await fetchIndex(m);
      seriesByCode[m.code] = data;
      return { code: m.code, n: Object.keys(data).length };
    } catch (e) {
      failed.push({ code: m.code, src: m.src, sym: m.sym, err: String(e.message || e).slice(0, 80) });
      return { code: m.code, err: true };
    }
  });
  log.push(`指数：成功 ${results.filter((r) => !r.err).length} / 失败 ${failed.length}`);

  // ---- 2. 抓汇率 ----
  const end = new Date().toISOString().slice(0, 10);
  let fx;
  const fxDoc = await db.collection(COL_FX).doc("latest").get().catch(() => null);
  const prevRates = (fxDoc && fxDoc.data && fxDoc.data.rates) || null;
  if (event.skipFx) {
    fx = { rates: prevRates || {}, missing: (fxDoc && fxDoc.data && fxDoc.data.missing) || [] };
    log.push("汇率：沿用库内已有，未抓取");
  } else {
    // 传入已有数据做增量。全量回补需约 30 秒（兜底源按日期逐天请求），
    // 只在首次运行时发生；之后每日仅补最近几天，数秒即可。
    fx = await fetchFX(CURRENCIES, end, prevRates);
    await upsert(COL_FX, "latest", { updatedAt: new Date(), asof: end, ...fx });
    const mode = prevRates ? "增量" : "首次全量";
    log.push(`汇率(${mode})：${Object.keys(fx.rates).length} 种，缺失 ${fx.missing.length ? fx.missing.join(",") : "无"}`);
  }

  // ---- 3. 算快照 ----
  const { meta, snapshot, windows } = buildSnapshot(
    todo.filter((m) => seriesByCode[m.code]), seriesByCode, fx.rates);

  // ---- 4. 落库 ----
  await pool(Object.entries(seriesByCode), 8, ([code, data]) => {
    const pairs = Object.entries(data).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return upsert(COL_SERIES, code, { updatedAt: new Date(), n: pairs.length, data: pairs });
  });

  const asofs = meta.map((m) => m.asof).sort();
  await upsert(COL_SNAPSHOT, "latest", {
    generated: new Date(),
    dataAsof: asofs[asofs.length - 1] || null,
    windows, anchors: ANCHORS,
    groupNames: GROUP_NAMES, tierNames: TIER_NAMES,
    fxMissing: fx.missing,
    countries: new Set(meta.map((m) => m.country)).size,
    meta, snapshot,
  });

  log.push(`落库：${Object.keys(seriesByCode).length} 条序列 + 1 份快照`);
  return {
    ok: failed.length === 0,
    ms: Date.now() - t0,
    indices: meta.length,
    countries: new Set(meta.map((m) => m.country)).size,
    dataAsof: asofs[asofs.length - 1] || null,
    fxCount: Object.keys(fx.rates).length,
    fxMissing: fx.missing,
    failed,
    log,
  };
};
