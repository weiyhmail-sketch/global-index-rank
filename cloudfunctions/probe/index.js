/**
 * 国际数据源连通性探测（第三轮）
 *
 * 前两轮证明云函数(境内)能访问 Frankfurter、jsDelivr 等境外站点，
 * 说明"境内云函数只能用国内源"这个假设是错的。
 * 本轮专测国际源 —— 若 Yahoo 可用，它单独就能覆盖全部 14 个缺失市场，
 * 外加此前写死放弃的沙特/土耳其/南非/阿根廷/以色列。
 */
const https = require("https");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 2500;

function get(url, referer) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const headers = { "User-Agent": UA, Accept: "*/*" };
    if (referer) headers.Referer = referer;
    const req = https.get(url, { headers, timeout: TIMEOUT }, (res) => {
      // 跟随重定向一层
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, referer));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        ok: true, status: res.statusCode, ms: Date.now() - t0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, err: "timeout", ms: Date.now() - t0 }); });
    req.on("error", (e) => resolve({ ok: false, err: e.code || e.message, ms: Date.now() - t0 }));
  });
}

const yahooChart = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1mo&interval=1d`;

const checkYahoo = (b) => {
  const j = JSON.parse(b);
  const c = j.chart;
  if (c.error) return `API错误: ${c.error.code}`;
  const r = c.result[0];
  const cl = r.indicators.quote[0].close.filter((x) => x != null);
  return `${r.meta.shortName || r.meta.symbol} ${cl.length}条 末=${cl[cl.length - 1]} ${r.meta.currency}`;
};

const PROBES = [
  // --- 带 key 的正规数据商: 只测可达性(无 key 时应返回 401/错误 JSON 而非超时) ---
  { name: "Twelve Data (免费800次/日)", url: "https://api.twelvedata.com/time_series?symbol=SPX&interval=1day&outputsize=3",
    check: (b) => `响应: ${b.slice(0, 90)}` },
  { name: "EODHD", url: "https://eodhd.com/api/eod/GSPC.INDX?fmt=json&period=d",
    check: (b) => `响应: ${b.slice(0, 90)}` },
  { name: "Alpha Vantage", url: "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=SPY&apikey=demo",
    check: (b) => `响应: ${b.slice(0, 90)}` },
  { name: "Marketstack", url: "https://api.marketstack.com/v1/eod?symbols=AAPL",
    check: (b) => `响应: ${b.slice(0, 90)}` },

  // --- GitHub / CDN 通道(用于"境外预处理 + 境内读取"方案) ---
  { name: "GitHub raw", url: "https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore",
    check: (b) => `可达 ${b.length}字节` },
  { name: "GitHub API", url: "https://api.github.com/repos/github/gitignore",
    check: (b) => `可达 ${JSON.parse(b).full_name}` },
  { name: "jsDelivr gh 通道", url: "https://cdn.jsdelivr.net/gh/github/gitignore@main/Node.gitignore",
    check: (b) => `可达 ${b.length}字节` },
  { name: "Cloudflare Pages 示例(静态托管可达性)", url: "https://cloudflare.com/cdn-cgi/trace",
    check: (b) => `可达 ${b.split(chr(10))[0]}` },

  // --- 对照 ---
  { name: "Frankfurter (已知可用)", url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY",
    check: (b) => JSON.stringify(JSON.parse(b).rates) },
];

exports.main = async () => {
  const results = await Promise.all(PROBES.map(async (p) => {
    const r = await get(p.url, p.referer);
    const row = { name: p.name, ms: r.ms };
    if (!r.ok) { row.result = `连接失败: ${r.err}`; row.pass = false; return row; }
    row.status = r.status;
    try {
      row.result = p.check(r.body);
      row.pass = !/意外|解析失败/.test(row.result);
    } catch (e) {
      row.result = `解析失败: ${e.message} | 前100字: ${r.body.slice(0, 100)}`;
      row.pass = false;
    }
    return row;
  }));
  return {
    runAt: new Date().toISOString(),
    summary: results.map((r) => `${r.pass ? "OK  " : "FAIL"} [${String(r.ms).padStart(4)}ms] ${r.name} → ${r.result}`),
  };
};
