/**
 * 从 data 分支读构建产物。零依赖 —— 这一点很关键。
 *
 * 实测：带 wx-server-sdk 的云函数冷启动常常撑爆 3 秒超时（连续 4 次失败），
 * 而零依赖的函数首次调用即在 1.4 秒返回。免费版超时不可调，
 * 因此数据读取一律走 CDN 直取，不引入数据库依赖。
 */
const https = require("https");
const zlib = require("zlib");

const REPO = "weiyhmail-sketch/global-index-rank";

/**
 * 预算分冷热两档。
 *
 * 函数总超时 3 秒，不可调。原先写死 2500，注释说「留 300ms 给冷启动与
 * JSON.parse」——但这算错了：BUDGET 是从 fetchJSON **开始**计时的，
 * 冷启动发生在它之前，根本不在这 2500ms 里面。于是冷启动那次
 * 2500 + 冷启动 + parse 会摸到甚至越过 3000，函数被杀。
 * （自测也印证了：「两源皆挂起」实测 2501ms，热调用还行，冷调用必死。）
 *
 * 热调用：3000 − 2500 = 500ms 留给 parse 与回包，够。
 * 冷调用：零依赖函数首次调用实测 1.0–1.8 秒返回，其中取数本身约 0.5 秒，
 *         所以冷启动开销大致 0.5–1.3 秒。按上界留位置 → 1400ms。
 * HEDGE_AT 同比例收紧，否则冷调用时备源刚点火函数就被杀了。
 */
const HARD_LIMIT = 3000;
let warm = false;
const budgets = () => (warm ? { BUDGET: 2500, HEDGE_AT: 900 } : { BUDGET: 1400, HEDGE_AT: 500 });

/**
 * 源顺序：raw.githubusercontent 优先，jsDelivr 兜底。
 *
 * jsDelivr 会把分支名 `@data` 解析到的 commit 缓存住，purge 单个文件
 * 并不会让它重新解析分支 HEAD —— 实测 purge 返回 finished、两个 provider
 * 都清了、cache 显示 MISS 确实回源，内容仍是上一版。
 * 分支型 jsDelivr URL 不适合频繁更新的数据，只能退居兜底。
 */
const sources = (f) => [
  `https://raw.githubusercontent.com/${REPO}/data/${f}`,
  `https://cdn.jsdelivr.net/gh/${REPO}@data/${f}`,
];

function get(url, timeout, depth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "index-rank", "Accept-Encoding": "gzip" }, timeout,
    }, (res) => {
      // 必须挂在 res 上，不能只挂在下面的 st 上。gzip 时 st 是 gunzip 流，
      // 而 pipe() 不转发源流的错误——res 上一个监听器都没有的话，
      // 响应中途断流(socket hang up / ECONNRESET)会抛未捕获异常，整个云函数挂掉。
      // 而实测两个源都返回 content-encoding: gzip，也就是说生产 100% 走那条分支。
      // 函数挂掉返回的错误不匹配 isTimeout()，utils/cloud.js 连重试都不会做。
      res.on("error", reject);
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (depth >= 3) return reject(new Error("重定向过多"));
        return resolve(get(res.headers.location, timeout, depth + 1));
      }
      const chunks = [];
      const st = res.headers["content-encoding"] === "gzip" ? res.pipe(zlib.createGunzip()) : res;
      st.on("data", (c) => chunks.push(c));
      st.on("end", () => {
        const b = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 400) return reject(new Error("HTTP " + res.statusCode));
        resolve(b);
      });
      st.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

/**
 * 取数据：主源优先，但不为主源干等——谁先成功用谁。
 *
 * 为什么不能串行：免费版函数 3 秒被杀，两个源串行各给 2.4 秒共 4.8 秒。
 * 主源一旦挂起(而不是快速失败)，函数在备源还没发出去时就已经死了。
 * 实测 20 次调用只 5 次成功，其中 11 次就是这种「写了兜底却够不着」的超时。
 *
 * 三条触发线：
 *   主源失败  → 立刻点燃备源，不等 HEDGE_AT
 *   主源超时未回 → HEDGE_AT 时并发点燃备源，两条腿一起跑
 *   主源正常   → 备源一次请求都不发
 *
 * 仍然偏向主源：备源晚 HEDGE_AT 起跑，主源只要不是明显更慢就会先到。
 * 这点偏向是必要的——jsDelivr 可能回上一版数据(见上方 sources 注释)。
 */
/** 取第一个成功的；全部失败才失败。Promise.race 遇到第一个 reject 就结束，不能用。 */
function firstSuccess(ps) {
  return new Promise((resolve, reject) => {
    let left = ps.length;
    ps.forEach((p) => p.then(resolve, (e) => --left === 0 && reject(e)));
  });
}

async function fetchJSON(file) {
  const t0 = Date.now();
  const { BUDGET, HEDGE_AT } = budgets();
  warm = true; // 下一次调用起用宽预算
  const [primary, backup] = sources(file);
  const errs = [];
  // 减 SETTLE 是为了让 BUDGET 真的成为上限。不减的话，最后一次尝试的超时
  // 恰好落在 BUDGET 那一刻，fetchJSON 会在 BUDGET+ε 才返回——预算线形同虚设
  // （自测「两源皆挂起」实测 2501ms > 2500 就是这么来的）。
  const SETTLE = 60;
  const left = () => BUDGET - SETTLE - (Date.now() - t0);

  const attempt = (url) =>
    // 下限 200：当前调用路径下 left() 恒 ≥1600，但只要有人调大 HEDGE_AT、
    // 加第三条腿，或者事件循环被阻塞过 BUDGET，它就会变成负数
    // （实测拆掉对冲定时器时 Node 打过 TimeoutNegativeWarning: -3）。
    get(url, Math.max(200, left())).then(
      (body) => ({ url, body }),
      (e) => {
        errs.push(`${url.split("/")[2]} ${e.message}`);
        throw e;
      }
    );

  // 备源的位置先占住再说：它可能由超时点燃，也可能由主源失败提前点燃，
  // 而竞速要在它起跑之前就把这个位置排进去，否则提前点燃的备源赢了也没人接。
  let slotDone, slotFail;
  const backupSlot = new Promise((res, rej) => ((slotDone = res), (slotFail = rej)));
  backupSlot.catch(() => {}); // 主源赢时这个位置永不兑现，先挂一个空 catch

  let started = false, settled = false;
  const startBackup = () => {
    if (started || settled) return;
    started = true;
    attempt(backup).then(slotDone, slotFail);
  };

  const pPrimary = attempt(primary);
  pPrimary.catch(startBackup); // 主源快速失败就立刻起跑，不必等满 HEDGE_AT
  const timer = setTimeout(startBackup, HEDGE_AT);

  let won;
  try {
    won = await firstSuccess([pPrimary, backupSlot]);
  } catch (e) {
    throw new Error(`各源均取不到 ${file}：${errs.join(" / ")}`);
  } finally {
    settled = true;
    clearTimeout(timer); // 主源赢了就别再多发一次请求
  }
  return {
    data: JSON.parse(won.body),
    url: won.url,
    ms: Date.now() - t0,
    bytes: Buffer.byteLength(won.body),
  };
}

/** 构建时间是否在 36 小时内（每日构建 + 容忍一天失败）。 */
const freshEnough = (generated) =>
  !!generated && Date.now() - new Date(generated).getTime() < 36 * 3600 * 1000;

// budgets 导出给 scripts/check-cdn-hedge.js：测试必须和被测代码用同一个数，
// 各写各的会让断言画在死亡线(3000)而不是设计线上。
module.exports = { fetchJSON, freshEnough, budgets, HARD_LIMIT };
