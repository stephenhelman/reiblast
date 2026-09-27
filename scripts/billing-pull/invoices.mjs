// READ-ONLY: pull invoices only (GET). Output: out/invoices.json
import fs from "node:fs";
for (const l of fs.readFileSync("../../.env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!(m[1] in process.env)) process.env[m[1]]=m[2].replace(/^["']|["']$/g,""); }
const LOC=process.env.GHL_HQ_LOCATION_ID, H={Authorization:`Bearer ${process.env.GHL_HQ_API_KEY}`,Version:"v3",Accept:"application/json"};
let offset=0,limit=100,all=[],total=null,pages=[];
for(;;){
  const r=await fetch(`https://services.leadconnectorhq.com/invoices/?${new URLSearchParams({altId:LOC,altType:"location",limit:String(limit),offset:String(offset)})}`,{headers:H});
  if(r.status===429){await new Promise(x=>setTimeout(x,3000));continue;}
  const t=await r.text(); if(!r.ok){console.log("HTTP",r.status,t.slice(0,300));process.exit(r.status===401?2:1);}
  const b=JSON.parse(t); const rows=b.invoices??b.data??[]; total=b.total??b.totalCount??total;
  all.push(...rows); pages.push({offset,returned:rows.length,keys:Object.keys(b)}); console.log(`offset=${offset} got=${rows.length} total=${total}`);
  if(!rows.length||(total!=null&&all.length>=total)) break; offset+=rows.length;
}
fs.writeFileSync("out/invoices.json",JSON.stringify({totalCount:total,fetched:all.length,pages,data:all},null,2));
console.log("saved",all.length);
