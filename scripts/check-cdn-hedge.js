/**
 * cdn.js 的取数对冲逻辑：桩掉 https，验证五种网络情形下的行为与耗时。
 *
 * 为什么要测：免费版云函数 3 秒被杀，而两个源串行各给 2.4 秒共 4.8 秒——
 * 主源一挂起，备源根本发不出去。线上实测 20 次调用只有 5 次成功。
 * 这个文件用假的 https 把「主源挂起 / 主源快速失败 / 两源皆死」都跑一遍，
 * 断言每种情形都在 3 秒预算内收敛，且主源正常时不多发请求。
 */
const https=require("https"); const {EventEmitter}=require("events");
let plan={}, fired=[]; const fails=[];
const BUDGET_MS=3000;
https.get=(url,opts,cb)=>{
  const host=url.split("/")[2]; fired.push([host,Date.now()-T0]);
  const req=new EventEmitter(); req.destroy=()=>{};
  const p=plan[host];
  // 真实 https 在 opts.timeout 到点时会 emit "timeout"，桩要照做
  if(p.hang){ setTimeout(()=>req.emit("timeout"),opts.timeout); return req; }
  setTimeout(()=>{
    if(p.refuse){ req.emit("error",new Error("connect ECONNREFUSED")); return; }
    const res=new EventEmitter(); res.statusCode=200; res.headers={}; res.resume=()=>{};
    cb(res); res.emit("data",Buffer.from(p.body)); res.emit("end");
  },p.ms);
  return req;
};
let T0=Date.now();
const {fetchJSON}=require(require("path").join(__dirname,"..","cloudfunctions","lib","cdn.js"));
const RAW="raw.githubusercontent.com", JSD="cdn.jsdelivr.net";
(async()=>{
  const run=async(name,p)=>{
    plan=p; fired=[]; T0=Date.now();
    const expectSingle = name==="主源快";
    try{ const r=await fetchJSON("x.json");
      const ms=Date.now()-T0;
      console.log(`${name}: 用了 ${r.url.split("/")[2]}，耗时 ${ms}ms，发出请求 ${JSON.stringify(fired)}`);
      if(ms>=BUDGET_MS) fails.push(`${name} 耗时 ${ms}ms，超出函数 3 秒预算`);
      if(expectSingle && fired.length!==1) fails.push(`${name} 主源就绪却发了 ${fired.length} 个请求`);
    }catch(e){ console.log(`${name}: 失败「${e.message}」耗时 ${Date.now()-T0}ms，发出请求 ${JSON.stringify(fired)}`);}
    const n=fired.length; await new Promise(r=>setTimeout(r,1500));
    if(fired.length>n) fails.push(`${name} 结束后又漏发了 ${fired.length-n} 个请求`);
  };
  await run("主源快",      {[RAW]:{ms:200,body:'{"a":1}'}, [JSD]:{ms:100,body:'{"a":2}'}});
  await run("主源挂起",    {[RAW]:{hang:1},                [JSD]:{ms:300,body:'{"a":2}'}});
  await run("主源快速拒绝",{[RAW]:{ms:20,refuse:1},        [JSD]:{ms:300,body:'{"a":2}'}});
  await run("两源皆死",    {[RAW]:{ms:20,refuse:1},        [JSD]:{ms:20,refuse:1}});
  await run("两源皆挂起",  {[RAW]:{hang:1},                [JSD]:{hang:1}});
  console.log(fails.length ? "\n❌ " + fails.join("\n❌ ") : "\n✅ 取数对冲全部符合预期");
  process.exit(fails.length ? 1 : 0);
})();
