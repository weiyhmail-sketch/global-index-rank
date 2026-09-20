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
const sources = (f) => [
  `https://cdn.jsdelivr.net/gh/${REPO}@data/${f}`,
  `https://raw.githubusercontent.com/${REPO}/data/${f}`,
];

function get(url, timeout = 2400, depth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "index-rank", "Accept-Encoding": "gzip" }, timeout,
    }, (res) => {
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

/** 依次尝试 jsDelivr 与 raw.githubusercontent，返回 { data, url, ms, bytes }。 */
async function fetchJSON(file) {
  const t0 = Date.now();
  let last;
  for (const url of sources(file)) {
    try {
      const body = await get(url);
      return { data: JSON.parse(body), url, ms: Date.now() - t0, bytes: Buffer.byteLength(body) };
    } catch (e) { last = e; }
  }
  throw new Error(`各源均取不到 ${file}：${last && last.message}`);
}

/** 构建时间是否在 36 小时内（每日构建 + 容忍一天失败）。 */
const freshEnough = (generated) =>
  !!generated && Date.now() - new Date(generated).getTime() < 36 * 3600 * 1000;

module.exports = { fetchJSON, freshEnough };
