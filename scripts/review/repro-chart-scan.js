// 复现：详情页「走势图标题涨幅」与「各区间涨幅」是否一致
const fs = require("fs");
const snap = JSON.parse(fs.readFileSync("dist/snapshot.json","utf8"));
function minusMonths(iso,n){const d=new Date(iso+"T00:00:00Z");const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);}
const RANGES=[["1m",1,"m1"],["3m",3,"m3"],["1y",12,"y1"],["3y",36,"y3"],["5y",60,"y5"]];
const bad=[];
for (const m of snap.meta) {
  let c; try { c = JSON.parse(fs.readFileSync(`dist/chart/${m.code}.json`,"utf8")); } catch(e){ continue; }
  for (const cur of ["cny","usd","local"]) {
    const series = c[cur]; if (!series) continue;
    for (const [key,months,winKey] of RANGES) {
      const from = minusMonths(m.asof, months);
      // get-chart 的裁剪
      const i = c.dates.findIndex(x=>x>=from);
      const st = i>0 ? i : 0;
      const pts=[];
      for (let k=st;k<c.dates.length;k++) if (series[k]!==null) pts.push([c.dates[k],series[k]]);
      if (pts.length<2) continue;
      const chartPct = (pts[pts.length-1][1]/pts[0][1]-1)*100;
      const snapPct = (snap.snapshot[m.code][winKey]||{})[cur];
      if (snapPct===null||snapPct===undefined) continue;
      const diff = chartPct - snapPct;
      if (Math.abs(diff) > 0.02) bad.push({code:m.code,country:m.country,cur,win:key,
        chartFrom:pts[0][0], wantFrom:from, chart:+chartPct.toFixed(2), snap:snapPct, diff:+diff.toFixed(2)});
    }
  }
}
console.log("不一致条目数:", bad.length);
console.table(bad.filter(b=>b.cur==="cny").slice(0,25));
const byWin={}; bad.forEach(b=>byWin[b.win]=(byWin[b.win]||0)+1);
console.log("按区间统计:", byWin);
console.log("最大偏差:", bad.map(b=>Math.abs(b.diff)).sort((a,b)=>b-a).slice(0,5));
