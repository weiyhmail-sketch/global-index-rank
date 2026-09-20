// 10 天回溯上限对台湾农历新年的误伤，走到界面上是什么样
const fs=require("fs"),path=require("path");
const {INDICES}=require(path.resolve("cloudfunctions/lib/indices.js"));
const {buildSnapshot,buildRankDelta,buildMonthly,buildYearly}=require(path.resolve("cloudfunctions/lib/snapshot.js"));
const ser=JSON.parse(fs.readFileSync("dist/series.json","utf8")).data;
const series=Object.fromEntries(Object.entries(ser).map(([c,a])=>[c,Object.fromEntries(a)]));
const fx=JSON.parse(fs.readFileSync("dist/fx.json","utf8")).rates;
const A=[{date:"2020-03-23",label:"疫情底"},{date:"2022-10-12",label:"美股熊市底"},{date:"2024-09-18",label:"中国行情起点"},{date:"2025-04-07",label:"关税冲击日"}];
const got=INDICES.filter(m=>series[m.code]);
// 命中日：名义起点 2026-02-22 落在台湾农历新年休市里 → m3 被判 tooFar
// 2026-02-22 + 3 个月 = 2026-05-22 那一天打开 App
const K=(new Date("2026-09-18")-new Date("2026-05-22"))/864e5;
const {meta,snapshot,windows,anchorMeta}=buildSnapshot(got,series,fx,{anchors:A,endShiftDays:-Math.round(K)});
const monthly=buildMonthly(got,series,fx,{years:6});
const snap={ok:true,generated:new Date().toISOString(),dataAsof:meta.map(m=>m.asof).sort().pop(),
  countries:new Set(meta.map(m=>m.country)).size,windows,anchors:A.map((a,i)=>({...a,days:anchorMeta[i].days,n:anchorMeta[i].n})),
  groupNames:{asia:"亚太",europe:"欧洲",americas:"美洲",oceania:"大洋洲"},tierNames:{},fxMissing:[],
  meta,snapshot,rankDelta:buildRankDelta(got,series,fx,{days:7,anchors:A}),yearly:buildYearly(monthly,{years:6})};
let inst=null;
global.Page=(o)=>{inst=Object.assign({},o);inst.data=Object.assign({},o.data);inst.setData=function(x){Object.assign(this.data,x)}};
global.wx={cloud:{callFunction:async({name})=>name==="get-monthly"?{result:{ok:true,...monthly,dataAsof:snap.dataAsof}}:{result:{ok:true,...snap}}},stopPullDownRefresh(){},navigateTo(){}};
require(path.resolve("miniprogram/pages/index/index.js"));
(async()=>{
  await inst.load();
  const i=inst.wins.findIndex(w=>w.key==="m3");
  inst.setData({winIdx:i,tierIdx:2}); inst.render();
  const tw=snap.meta.find(m=>m.code==="TWII");
  console.log(`模拟「今天」= ${tw.asof}（台湾最近交易日），窗口 = 近3月，数据其实完整（自 ${tw.start} 起）`);
  console.log("台湾 近3月 快照值:", JSON.stringify(snap.snapshot.TWII.m3));
  console.log("\n界面上台湾这一行出现在哪里：");
  const inOk=inst.data.rows.find(r=>r.code==="TWII");
  const inNa=inst.data.naRows.find(r=>r.code==="TWII");
  const inFb=inst.data.fbRows.find(r=>r.code==="TWII");
  if(inOk) console.log("  排名区:",JSON.stringify(inOk.pct));
  if(inFb) console.log("  仅原币区:",JSON.stringify(inFb.pct));
  if(inNa) console.log(`  数据不足区 → 「以下 ${inst.data.naRows.length} 个市场在本区间数据不足」`);
  // 读页面真正渲染的 naNote，别自己拼一句 —— 自己拼的话，代码改对了脚本也看不见
  if(inNa) console.log(`            行内文案：中国台湾 · 台湾加权指数（${inNa.naNote}） —`);
  const lying = inNa && /数据自/.test(inNa.naNote || "");
  console.log(lying
    ? "\n  ↑ 这句话是假的：台湾数据自 " + tw.start + " 起，近3月绰绰有余。\n    真实原因是起点落在农历新年休市，被回溯上限判了死刑。"
    : "\n  ↑ 文案说出了真实原因，没有假装是「数据不够长」。");
  console.log("");
  console.log("\n结论条:", inst.data.stats);
})();
