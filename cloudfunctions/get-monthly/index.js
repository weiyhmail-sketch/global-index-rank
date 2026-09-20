/**
 * get-monthly —— 各月末点位，供客户端自算任意月度区间。
 *
 * 单独成文件而不并入快照：它占快照六成体积，而只有用户打开
 * 「自定义区间」时才需要，塞进首屏会拖慢所有人。
 *
 * 客户端拿到后自算：涨幅 = 终点月末点位 / 起点月末点位 - 1。
 * 月末点位取「该月末或之前最近一个交易日」的真实收盘价，不是近似。
 */
const { fetchJSON } = require("./cdn");

exports.main = async () => {
  try {
    const { data: d, ms, bytes } = await fetchJSON("monthly.json");
    return { ok: true, ms, bytes, generated: d.generated, dataAsof: d.dataAsof,
             months: d.months, levels: d.levels };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
