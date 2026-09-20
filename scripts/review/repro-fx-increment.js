// 拦截 ./http，模拟「第二天再跑一次构建」，看各币种是否推进
const Module = require("module");
const path = require("path");
const orig = Module._load;
const calls = { frank: [], ccyapi: [] };
Module._load = function (req, parent, isMain) {
  if (req === "./http") {
    return {
      get: async (url) => {
        if (url.includes("frankfurter")) {
          calls.frank.push(url);
          const m = url.match(/v1\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/);
          const [_, from, to] = m;
          const syms = new URL(url).searchParams.get("symbols").split(",");
          // 只返回 ECB 真有的币种（不含 TWD/VND/PKR/EGP/RUB/LKR）
          const ECB = new Set(["EUR","GBP","JPY","CNY","HKD","KRW","INR","IDR","SGD","AUD","NZD","CAD","CHF","BRL","MXN"]);
          const rates = {};
          for (let d = new Date(from+"T00:00:00Z"); d.toISOString().slice(0,10) <= to; d.setUTCDate(d.getUTCDate()+1)) {
            const day = d.toISOString().slice(0,10);
            const wd = d.getUTCDay();
            if (wd === 0 || wd === 6) continue;
            rates[day] = Object.fromEntries(syms.filter(s=>ECB.has(s)).map(s=>[s, 1.234]));
          }
          return JSON.stringify({ rates });
        }
        if (url.includes("currency-api")) {
          calls.ccyapi.push(url);
          return JSON.stringify({ usd: { twd: 31, vnd: 25000, pkr: 280, egp: 48, rub: 90, lkr: 300 } });
        }
        throw new Error("unexpected " + url);
      },
      retry: async (fn) => fn(),
    };
  }
  return orig.apply(this, arguments);
};

(async () => {
  const { fetchFX } = require(path.resolve("cloudfunctions/lib/fx.js"));
  const { CURRENCIES } = require(path.resolve("cloudfunctions/lib/indices.js"));
  const prev = JSON.parse(require("fs").readFileSync("dist/fx.json","utf8")).rates;
  // 只保留 INDICES 实际用到的币种，模拟干净的上一轮
  const prevClean = Object.fromEntries(Object.entries(prev).filter(([c])=>CURRENCIES.includes(c)));
  const before = Object.fromEntries(Object.entries(prevClean).map(([c,s])=>[c,Object.keys(s).sort().pop()]));

  for (const end of ["2026-09-21","2026-10-05","2026-10-25"]) {
    calls.frank.length = 0; calls.ccyapi.length = 0;
    const r = await fetchFX(CURRENCIES, end, prevClean);
    const after = Object.fromEntries(Object.entries(r.rates).map(([c,s])=>[c,Object.keys(s).sort().pop()]));
    const watch = ["TWD","VND","PKR","EGP","RUB","EUR","JPY"];
    console.log(`\n=== 模拟 end=${end}（prev 停在 ${before.TWD}） ===`);
    console.log("currency-api 请求数:", calls.ccyapi.length, " frankfurter 请求数:", calls.frank.length);
    console.log(watch.map(c=>`${c}: ${before[c]||"—"} -> ${after[c]||"【已删除】"}`).join("\n"));
    console.log("missing:", r.missing);
  }
})();
