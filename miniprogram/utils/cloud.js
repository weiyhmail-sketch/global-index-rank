/**
 * 云函数调用封装：超时自动重试。
 *
 * 云开发免费版云函数超时固定 3 秒且不可调（调高需付费版）。
 * 函数冷启动常常吃掉大半时间，导致当天第一次调用必然失败
 * （模拟器实测报 -504003 FUNCTIONS_TIME_LIMIT_EXCEEDED）。
 *
 * 而失败的那次调用本身已经把函数预热了，紧接着重试通常 1-2 秒就返回。
 * 所有读取函数都是纯查询、幂等，重试没有副作用。
 */
const TIMEOUT_CODES = [-504003];

function isTimeout(err) {
  const s = String((err && (err.errMsg || err.message)) || err || "");
  return TIMEOUT_CODES.some((c) => s.includes(String(c))) || /timed out/i.test(s);
}

/**
 * @param name  云函数名
 * @param data  入参
 * @param tries 最多尝试次数（含首次）
 */
async function call(name, data = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await wx.cloud.callFunction({ name, data });
      return res.result;
    } catch (e) {
      last = e;
      // 只对超时重试；参数错误之类重试多少次都一样
      if (!isTimeout(e) || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const msg = isTimeout(last)
    ? "云函数冷启动超时，已重试多次仍未成功，请下拉刷新"
    : ((last && last.errMsg) || String(last));
  throw new Error(msg);
}

module.exports = { call, isTimeout };
