// 攻击 detail.js 的令牌：两条它没覆盖的路径
const fs=require("fs"),path=require("path");
const D=(f)=>JSON.parse(fs.readFileSync(path.join("dist",f),"utf8"));
const snapshot=D("snapshot.json"), chart=D("chart/KS11.json");
let inst=null;
global.Page=(o)=>{inst=Object.assign({},o);inst.data=Object.assign({},o.data);inst.setData=function(x){Object.assign(this.data,x)}};
let delays={};
const stub=async({name,data})=>{
  if(name!=="get-chart") { if(delays.__snap) await new Promise(r=>setTimeout(r,delays.__snap)); return {result:{ok:true,...snapshot}}; }
  const d=delays[data.from]||0; if(d) await new Promise(r=>setTimeout(r,d));
  let {dates,local,usd,cny}=chart; let truncated=false;
  if(data.from){let i=-1;for(let k=0;k<dates.length;k++){if(dates[k]<=data.from)i=k;else break;}
    truncated=i<0; if(i>0){dates=dates.slice(i);local=local.slice(i);if(usd)usd=usd.slice(i);if(cny)cny=cny.slice(i);}}
  return {result:{ok:true,code:data.code,ccy:chart.ccy,n:dates.length,dailyFrom:chart.dailyFrom,truncated,dates,local,usd,cny}};
};
global.wx={cloud:{callFunction:stub},setNavigationBarTitle(){},
  createSelectorQuery:()=>({in:()=>({select:()=>({fields:()=>({exec:()=>{}})})})})};
require(path.resolve("miniprogram/pages/detail/detail.js"));
const asof=snapshot.meta.find(m=>m.code==="KS11").asof;
const mm=(n)=>{const d=new Date(asof+"T00:00:00Z");const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-n);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10)};
const span=(s)=>{const m=s.match(/^(\d{4}-\d\d-\d\d) → (\d{4}-\d\d-\d\d)/); return m?Math.round((new Date(m[2])-new Date(m[1]))/864e5):null;};
const pct=(s)=>{const m=s.match(/([+-][\d.]+%)\s*$/);return m?m[1]:null;};
const grid=(lab)=>(inst.data.wins.find(w=>w.label===lab)||{}).pct;

(async()=>{
  const fails=[];
  // ---- 用例 A：初始 load() 的图表请求慢，用户先切了区间 ----
  // load() 里 this.chart = await loadChart(...) 没有令牌保护
  delays={}; delays[mm(12)]=400;         // 初始的「近1年」慢 400ms
  inst.onLoad({code:"KS11",cur:"cny"});
  await new Promise(r=>setTimeout(r,60));       // 等快照到手、图表还在路上
  await inst.onRange({detail:{value:3}});       // 用户切到「近3年」，它更快
  console.log("A 切换后立即:", `区间=${inst.data.rangeOptions[inst.data.rangeIdx]} 标题「${inst.data.chartStat}」跨度=${span(inst.data.chartStat)}天`);
  await new Promise(r=>setTimeout(r,600));      // 等初始那个慢请求回来
  const a=inst.data;
  console.log("A 慢请求返回后:", `区间=${a.rangeOptions[a.rangeIdx]} 标题「${a.chartStat}」跨度=${span(a.chartStat)}天 格子=${grid("近3年")}`);
  if(span(a.chartStat)!==null && span(a.chartStat)<900)
    fails.push(`❌ A：停在「近3年」，标题跨度却只有 ${span(a.chartStat)} 天 —— load() 的旧曲线覆盖了新曲线`);

  // ---- 用例 B：区间请求在途时切口径 ----
  delete require.cache[require.resolve(path.resolve("miniprogram/pages/detail/detail.js"))];
  require(path.resolve("miniprogram/pages/detail/detail.js"));
  delays={};
  inst.onLoad({code:"KS11",cur:"cny"});
  await new Promise(r=>setTimeout(r,120));
  console.log("\nB 初始:", `区间=${inst.data.rangeOptions[inst.data.rangeIdx]} 标题「${inst.data.chartStat}」跨度=${span(inst.data.chartStat)}天`);
  inst.chartCache={}; delays[mm(36)]=400;       // 「近3年」慢
  const p=inst.onRange({detail:{value:3}});     // 不 await，模拟在途
  await new Promise(r=>setTimeout(r,50));
  inst.onCur({detail:{value:1}});               // 在途时切到美元
  const b=inst.data;
  console.log("B 在途切口径:", `区间=${b.rangeOptions[b.rangeIdx]} 标题「${b.chartStat}」跨度=${span(b.chartStat)}天 格子(近3年)=${grid("近3年")}`);
  // 不变量变了，断言也得变。
  //
  // 原断言是「picker 显示近3年 ⟹ 标题跨度必须是 3 年」。修复之后标题**故意**
  // 跟着曲线走而不是跟着 picker 走——曲线还在路上时，标题理应还是旧区间的，
  // 假装成新区间才是错的。所以这条断言按新设计必然误报。
  //
  // 真正要守的不变量是：标题里的日期跨度和标题里的百分比必须出自同一个区间。
  // 用快照反查这个百分比属于哪个窗口，再看跨度对不对得上。
  const WINDOW_DAYS = { m1: 31, m3: 92, y1: 365, y3: 1096, y5: 1826 };
  const snapRow = snapshot.snapshot.KS11;
  const owner = (pctStr) => {
    for (const k of Object.keys(WINDOW_DAYS))
      for (const cur of ["local", "usd", "cny"]) {
        const v = (snapRow[k] || {})[cur];
        if (v !== null && v !== undefined && ((v > 0 ? "+" : "") + v.toFixed(2) + "%") === pctStr) return k;
      }
    return null;
  };
  const bSpan = span(b.chartStat), bPct = pct(b.chartStat), bWin = bPct && owner(bPct);
  console.log(`   标题里的 ${bPct} 属于窗口 ${bWin}（名义 ${bWin ? WINDOW_DAYS[bWin] : "?"} 天），标题跨度 ${bSpan} 天`);
  if (bSpan !== null && bWin && Math.abs(bSpan - WINDOW_DAYS[bWin]) > 20)
    fails.push(`❌ B：标题跨度 ${bSpan} 天，但里面的 ${bPct} 是 ${bWin} 窗口的数 —— 日期和数字出自不同区间`);
  if (bPct && !bWin)
    fails.push(`❌ B：标题里的 ${bPct} 在快照里找不到对应窗口`);
  await p; await new Promise(r=>setTimeout(r,200));
  console.log("B 最终:", `标题「${inst.data.chartStat}」跨度=${span(inst.data.chartStat)}天`);

  console.log("\n"+(fails.length?fails.join("\n"):"✅ 两条路径都没打穿"));
})();
