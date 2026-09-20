/**
 * cdn.js 的取数对冲逻辑：桩掉 https，验证各种网络情形下的行为、耗时与返回值。
 *
 * 为什么要测：免费版云函数 3 秒被杀，而两个源串行各给 2.4 秒共 4.8 秒——
 * 主源一挂起，备源根本发不出去。线上实测 20 次调用只有 5 次成功。
 *
 * 这个文件自己踩过的三个坑（第二轮审查找出来的），都已修正，别再踩回去：
 *   1. 预算常数写死成 3000，而 cdn.js 的 BUDGET 是 2500 —— 等于允许被测代码
 *      超出自己的预算 500ms。而 3000 是函数被杀的硬线，不是设计线。
 *      现在直接从 cdn.js 源码里读，对不上就红。
 *   2. 失败分支只 console.log、不断言 —— 而失败情形正是线上 5/20 的那一类。
 *      现在每个用例都带 expectFail，成败与耗时都断言。
 *   3. 桩从不设 content-encoding —— 而实测两个源都返回 gzip，也就是说
 *      **唯一跑在生产的分支是唯一没被测的分支**，且那条分支上有过一个
 *      会让云函数直接挂掉的 bug（res 上没有 error 监听器）。
 *      现在默认走 gzip，并单测重定向、4xx、响应中途断流。
 */
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

const CDN = path.join(__dirname, "..", "cloudfunctions", "lib", "cdn.js");

let plan = {}, fired = [], T0 = Date.now();
const fails = [];

https.get = (url, opts, cb) => {
  const host = url.split("/")[2];
  fired.push([host, Date.now() - T0]);
  // 桩按 host 索引，而重定向目标同 host，不特判的话会一直重定向到自己
  // （第一版就这么错过，四次重定向后退到备源，看起来像代码 bug 其实是桩的锅）
  const redirected = url.includes("/redirected/");
  const req = new EventEmitter();
  req.destroy = () => {};
  const p = redirected ? { ms: plan[host].ms, body: plan[host].redirectBody } : plan[host];
  // 真实 https 在 opts.timeout 到点时会 emit "timeout"，桩要照做
  if (p.hang) { setTimeout(() => req.emit("timeout"), opts.timeout); return req; }
  setTimeout(() => {
    if (p.refuse) { req.emit("error", new Error("connect ECONNREFUSED")); return; }
    // res 必须是真正的可读流：gzip 分支要对它调 pipe()，
    // 裸 EventEmitter 跑不到那里（这正是旧桩漏掉整条生产分支的原因）
    const res = new PassThrough();
    res.statusCode = p.status || 200;
    if (p.location) { res.headers = { location: p.location }; cb(res); res.end(); return; }
    // 生产实测两个源都是 gzip，所以桩默认也走 gzip
    const gzip = p.plain ? false : true;
    res.headers = gzip ? { "content-encoding": "gzip" } : {};
    cb(res);
    const body = gzip ? zlib.gzipSync(Buffer.from(p.body || "")) : Buffer.from(p.body || "");
    if (p.cutAfterFirstChunk) {
      // 先吐半截再让 res 出错：pipe() 不转发源流的错误，
      // 若 res 上没有 error 监听器，这里会抛未捕获异常把整个进程带走
      res.write(body.slice(0, Math.max(1, body.length >> 1)));
      setTimeout(() => res.destroy(new Error("socket hang up")), 5);
      return;
    }
    res.end(body);
  }, p.ms);
  return req;
};

const { fetchJSON, budgets, HARD_LIMIT } = require(CDN);
// 预算直接从被测代码里拿，不另写一份：各写各的会让断言画在死亡线(3000)
// 而不是设计线上，于是「超出自己预算 500ms」这种事测不出来。
// 每个用例前读一次 —— cdn.js 首次调用用的是收紧过的冷启动预算。
const RAW = "raw.githubusercontent.com", JSD = "cdn.jsdelivr.net";

(async () => {
  const run = async (name, p, opt = {}) => {
    plan = p; fired = []; T0 = Date.now();
    const { BUDGET } = budgets();
    let ok = false, ms = 0;
    try {
      const r = await fetchJSON("x.json");
      ms = Date.now() - T0; ok = true;
      console.log(`${name}: 用了 ${r.url.split("/")[2]}，耗时 ${ms}ms，请求 ${JSON.stringify(fired)}`);
      if (opt.expectFail) fails.push(`${name} 应当失败却成功了`);
      if (opt.wantData !== undefined && JSON.stringify(r.data) !== JSON.stringify(opt.wantData))
        fails.push(`${name} 返回内容不对：${JSON.stringify(r.data)} ≠ ${JSON.stringify(opt.wantData)}`);
      if (opt.wantHost && r.url.split("/")[2] !== opt.wantHost)
        fails.push(`${name} 用了 ${r.url.split("/")[2]}，应当用 ${opt.wantHost}`);
    } catch (e) {
      ms = Date.now() - T0;
      console.log(`${name}: 失败「${e.message}」耗时 ${ms}ms，请求 ${JSON.stringify(fired)}`);
      if (!opt.expectFail) fails.push(`${name} 不该失败：${e.message}`);
    }
    // 成败都要卡预算：失败得太慢，函数会被杀，用户连这条报错都拿不到
    // 成败都要卡：失败得太慢，函数会被杀，用户连这条报错都拿不到
    if (ms >= BUDGET) fails.push(`${name} 耗时 ${ms}ms，超出 cdn.js 当前预算 ${BUDGET}ms`);
    if (ms >= HARD_LIMIT) fails.push(`${name} 耗时 ${ms}ms，已越过函数 ${HARD_LIMIT}ms 硬超时`);
    if (opt.wantRequests !== undefined && fired.length !== opt.wantRequests)
      fails.push(`${name} 发了 ${fired.length} 个请求，应当 ${opt.wantRequests} 个`);
    const n = fired.length;
    await new Promise((r) => setTimeout(r, 1500));
    if (fired.length > n) fails.push(`${name} 结束后又漏发了 ${fired.length - n} 个请求`);
  };

  const good = { body: '{"a":1}' }, alt = { body: '{"a":2}' };

  await run("主源快",       { [RAW]: { ms: 200, ...good }, [JSD]: { ms: 100, ...alt } },
            { wantData: { a: 1 }, wantHost: RAW, wantRequests: 1 });
  await run("主源挂起",     { [RAW]: { hang: 1 },          [JSD]: { ms: 300, ...alt } },
            { wantData: { a: 2 }, wantHost: JSD });
  await run("主源快速拒绝", { [RAW]: { ms: 20, refuse: 1 }, [JSD]: { ms: 300, ...alt } },
            { wantData: { a: 2 }, wantHost: JSD });
  await run("两源皆死",     { [RAW]: { ms: 20, refuse: 1 }, [JSD]: { ms: 20, refuse: 1 } },
            { expectFail: true });
  await run("两源皆挂起",   { [RAW]: { hang: 1 },           [JSD]: { hang: 1 } },
            { expectFail: true });

  // ---- 生产真实走的那些分支 ----
  await run("非 gzip 响应", { [RAW]: { ms: 50, plain: 1, ...good }, [JSD]: { ms: 50, ...alt } },
            { wantData: { a: 1 }, wantHost: RAW });
  await run("主源 404 退备源", { [RAW]: { ms: 20, status: 404, body: "not found" }, [JSD]: { ms: 100, ...alt } },
            { wantData: { a: 2 }, wantHost: JSD });
  await run("主源重定向",   { [RAW]: { ms: 20, status: 302, location: `https://${RAW}/redirected/x.json`,
                                        redirectBody: '{"a":1}' },
                              [JSD]: { ms: 900, ...alt } },
            { wantData: { a: 1 }, wantHost: RAW });
  // res 上若没有 error 监听器，这一条会让进程直接崩掉（退出码非 0），而不是走到断言
  await run("响应中途断流", { [RAW]: { ms: 20, cutAfterFirstChunk: 1, ...good }, [JSD]: { ms: 200, ...alt } },
            { wantData: { a: 2 }, wantHost: JSD });

  console.log(fails.length ? "\n❌ " + fails.join("\n❌ ")
    : `\n✅ 取数对冲全部符合预期（热预算 ${budgets().BUDGET}ms / 硬超时 ${HARD_LIMIT}ms）`);
  process.exit(fails.length ? 1 : 0);
})();
