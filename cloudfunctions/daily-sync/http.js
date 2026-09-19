const https = require("https");
const zlib = require("zlib");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** GET 一个 URL，跟随最多 3 层重定向，自动解 gzip。 */
function get(url, { referer, timeout = 20000, depth = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "User-Agent": UA, Accept: "*/*", "Accept-Encoding": "gzip, deflate" };
    if (referer) headers.Referer = referer;
    const req = https.get(url, { headers, timeout }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (depth >= 3) return reject(new Error("重定向过多"));
        return resolve(get(res.headers.location, { referer, timeout, depth: depth + 1 }));
      }
      const chunks = [];
      const enc = res.headers["content-encoding"];
      const stream = enc === "gzip" ? res.pipe(zlib.createGunzip())
                   : enc === "deflate" ? res.pipe(zlib.createInflate()) : res;
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 80)}`));
        resolve(body);
      });
      stream.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

/** 带指数退避的重试。 */
async function retry(fn, times = 3, baseMs = 500) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i < times - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

module.exports = { get, retry };
