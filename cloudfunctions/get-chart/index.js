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
    let truncated = false;
    // from 可选：只回传需要的区间，减小体积
    if (event.from) {
      // 取「from 当天或之前最近的那个点」作为起点，与 snapshot.js 的 at() 同一语义。
      // 用 findIndex(x => x >= from) 会取到区间内第一个点，方向相反，
      // 实测会让图表标题与榜单格子差到 40 个百分点。
      let i = -1;
      for (let k = 0; k < dates.length; k++) { if (dates[k] <= event.from) i = k; else break; }
      truncated = i < 0;               // from 早于全部数据
      if (i > 0) {
        dates = dates.slice(i);
        local = local.slice(i);
        if (usd) usd = usd.slice(i);
        if (cny) cny = cny.slice(i);
      }
    }
    // generated 原样回传：对冲取数之后，快照可能来自 raw(今天)、
    // 这份走势图可能来自 jsDelivr(上一版)。客户端比一下就知道两者是否同源。
    // 只检测不重取 —— 重取要再走一次云函数往返，冷启动时直接撞 3 秒。
    return { ok: true, ms, bytes, code, ccy: d.ccy, n: dates.length,
             generated: d.generated || null,
             dailyFrom: d.dailyFrom, truncated, dates, local, usd, cny };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
