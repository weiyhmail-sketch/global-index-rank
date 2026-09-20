/**
 * get-snapshot —— 客户端首屏数据入口。
 *
 * 直接从 CDN 取构建产物，不走数据库：引入 wx-server-sdk 会让冷启动
 * 撞上 3 秒超时（实测连续失败），而零依赖函数首次调用即在 1.4 秒内返回。
 *
 * 约 40 KB，客户端零计算直接渲染。
 */
const { fetchJSON, freshEnough } = require("./cdn");

exports.main = async (event = {}) => {
  try {
    const { data: d, ms, bytes } = await fetchJSON("snapshot.json");
    const base = {
      ok: true, ms, bytes,
      generated: d.generated, dataAsof: d.dataAsof, countries: d.countries,
      stale: !freshEnough(d.generated) ? "数据超过 36 小时未更新" : null,
    };
    if (event.metaOnly) return { ...base, indices: (d.meta || []).length, fxMissing: d.fxMissing };
    return {
      ...base,
      windows: d.windows, anchors: d.anchors, fxStale: d.fxStale, groupNames: d.groupNames,
      tierNames: d.tierNames, fxMissing: d.fxMissing,
      meta: d.meta, snapshot: d.snapshot, rankDelta: d.rankDelta, yearly: d.yearly,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
