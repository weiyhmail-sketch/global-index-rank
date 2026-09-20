/**
 * get-series —— 单个指数的日线序列，供详情页走势图使用。
 *
 * 按指数分片取（19-144 KB），而不是整包 series.json：
 * 后者 gzip 后仍有 329 KB、实测 2.57 秒，离 3 秒超时太近。
 */
const { fetchJSON } = require("./cdn");

exports.main = async (event = {}) => {
  const code = String(event.code || "").replace(/[^A-Z0-9]/gi, "");
  if (!code) return { ok: false, error: "缺少 code 参数" };
  try {
    const { data, ms, bytes } = await fetchJSON(`series/${code}.json`);
    let rows = data.data || [];
    // from/to 可选，用于只取需要的区间，减小回传体积
    if (event.from) rows = rows.filter((r) => r[0] >= event.from);
    if (event.to) rows = rows.filter((r) => r[0] <= event.to);
    return { ok: true, ms, bytes, code, n: rows.length, data: rows };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
