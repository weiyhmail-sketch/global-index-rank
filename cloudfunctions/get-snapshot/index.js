/**
 * get-snapshot —— 客户端首屏数据入口。
 *
 * 走云函数而不是让客户端直连数据库：集合默认权限是「仅创建者可读写」，
 * 而这份数据是云函数写入的，客户端直读会被拒；走函数既免去权限配置，
 * 也留出了裁剪返回体的余地。
 *
 * 返回体约 20 KB，客户端零计算直接渲染。
 */
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event = {}) => {
  const doc = await db.collection("index_snapshot").doc("latest").get().catch(() => null);
  if (!doc || !doc.data) {
    return { ok: false, error: "快照尚未生成，请等待每日同步或手动执行 ingest" };
  }
  const d = doc.data;

  // meta 用于调试与状态展示，默认不回传全部字段
  if (event.metaOnly) {
    return {
      ok: true, generated: d.generated, dataAsof: d.dataAsof,
      ingestedAt: d.ingestedAt, countries: d.countries,
      indices: (d.meta || []).length, fxMissing: d.fxMissing,
    };
  }

  return {
    ok: true,
    generated: d.generated, dataAsof: d.dataAsof, ingestedAt: d.ingestedAt,
    countries: d.countries, windows: d.windows, anchors: d.anchors,
    groupNames: d.groupNames, tierNames: d.tierNames, fxMissing: d.fxMissing,
    meta: d.meta, snapshot: d.snapshot,
  };
};
