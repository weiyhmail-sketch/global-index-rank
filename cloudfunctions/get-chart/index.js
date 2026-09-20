/**
 * get-chart —— 单指数走势图数据：近 5 年日线，三种计价口径。
 *
 * 不用 series/{code}.json：那份只有原币收盘价，而榜单可切到
 * 美元/人民币口径，图与榜单口径不一致说不通。客户端又拿不到汇率表
 * （gzip 254 KB，云函数取它必超时），所以换算在构建侧就做完了。
 *
 * 约 20-52 KB/指数。
 */
const { fetchJSON } = require("./cdn");

exports.main = async (event = {}) => {
  const code = String(event.code || "").replace(/[^A-Z0-9]/gi, "");
  if (!code) return { ok: false, error: "缺少 code 参数" };
  try {
    const { data: d, ms, bytes } = await fetchJSON(`chart/${code}.json`);
    let { dates, local, usd, cny } = d;
    // from 可选：只回传需要的区间，减小体积
    if (event.from) {
      const i = dates.findIndex((x) => x >= event.from);
      if (i > 0) {
        dates = dates.slice(i);
        local = local.slice(i);
        if (usd) usd = usd.slice(i);
        if (cny) cny = cny.slice(i);
      }
    }
    return { ok: true, ms, bytes, code, ccy: d.ccy, n: dates.length,
             dailyFrom: d.dailyFrom, dates, local, usd, cny };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
