/* Clinical Compliance Scorecard — shared data + scoring module (used by the Board page and the Deep-dive page).
   Reads the live Google Sheets straight from the browser (gviz), the same way the audit dashboard does.

   SCORE (agreed 2026-10-10):
     Overall = 25% Audit Score + 75% Escalation Score
     Audit Score      = average Attained % of every scored audit (PDS, PDS-Mounjaro, Non Pharma, WLP-Non Pharma)
                        completed in the period (by Date of Audit). Zero-score audits are included and pull it down.
     Escalation Score = average of the three business lines' escalation-free %:
                        100 x (1 - weighted tickets / orders), weighted tickets = 2 x High + 1 x Medium
     Audit coverage   = audits completed / completed consults (D-1), shown against the 2-3% target (not scored). */
(function(root){
  "use strict";

  var CFG = {
    WEIGHT_AUDIT: 0.25, WEIGHT_TICKETS: 0.75,
    HIGH_WEIGHT: 2, MEDIUM_WEIGHT: 1,
    COVERAGE_TARGET_LOW: 2, COVERAGE_TARGET_HIGH: 3,
    /* RAG for the 0-100 scores */
    RAG: { green: 97, amber: 95 },
    FIRST_MONTH: "2026-08",          /* ticket + order data is complete from August 2026 */
    FILE_TICKETS: "1KlB3BOa5VRWux7_6ZTJyP13rA9SRtYoLrBjvtLUcaKU",
    GID_TICKETS_DATA: "0",           /* Consult + Diagnostics tickets */
    GID_TICKETS_MED: "544383008",    /* Medicine tickets */
    GID_ORDERS: "1380383189",        /* bu, Date, Orders */
    FILE_AUDIT: "1GUocnux4UV3hDTs0fgQuRF9HHN1VJo4sj1j2kd4YkMA",
    FILE_WLP: "15S35EFbog1e00UwEByq0bQomvaw5OaBrHCkib_vHXzQ",
    FILE_CANCEL: "1AACuecSEz3JvPZPSwpzCj6XVWEkF8kY6NWlYHGZi7cY", CANCEL_GID: "909502922",
    CANCEL_NEW_TAB: "PDS_Cancellation_Sheet_2", CANCEL_SWITCH_DATE: "2026-09-28",
    FILE_CONSULT: "10uJxWSe0jWpfuJRA5girKGafhm7y_GLEw1tW5zz_hHg", CONSULT_GID: "1752463132"
  };

  var BUS = [
    {key:"consult", label:"Consult", orderBu:"consult"},
    {key:"pharma", label:"Pharmacy", orderBu:"pharma"},
    {key:"diagnostics", label:"Diagnostics", orderBu:"diagnostics"}
  ];

  /* High / Medium mapping. Consult + Medicine follow the ticket sheet's own Dashboard tab; Diagnostics agreed 2026-10-10.
     Anything not listed as High is Medium. Keys are lower-cased. */
  var HIGH = {
    consult: ["issue with prescription", "doctor charging extra", "i havent received my prescription after consultation"],
    pharma: ["adverse event", "cold chain", "cold chain temperature not maintained", "cold chain without ice pack",
             "received expired items", "medicine not as per prescription", "received wrong/different items"],
    diagnostics: ["wrong report received", "hematoma", "report challenge"]
  };
  /* display labels, as written in the sheets */
  var HIGH_LABELS = {
    consult: ["Issue with prescription", "Doctor Charging Extra", "I havent received my prescription after consultation"],
    pharma: ["Adverse event", "Cold Chain", "Cold chain temperature not maintained", "Cold Chain Without ICE PACK", "Received expired items", "Medicine not as per prescription", "Received wrong/different items"],
    diagnostics: ["Wrong Report Received", "Hematoma", "Report Challenge"]
  };
  function severity(bu, cat){ return HIGH[bu].indexOf(String(cat||"").trim().toLowerCase()) !== -1 ? "High" : "Medium"; }

  var AUDIT_SOURCES = [
    {type:"PDS", file:CFG.FILE_AUDIT, sheet:"PDS Audit Sheet", headers:3},
    {type:"Non Pharma", file:CFG.FILE_AUDIT, sheet:"Non Pharma Audit Sheet", headers:3},
    {type:"PDS- Mounjaro", file:CFG.FILE_WLP, sheet:"PDS-Mounjaro", headers:0},
    {type:"WLP - Non Pharma", file:CFG.FILE_WLP, sheet:"BS WLP Audits", headers:0}
  ];
  var PROJECTS = ["PDS","PDS- Mounjaro","PDS Cancellation","Non Pharma","WLP - Non Pharma"];

  /* ---------- helpers ---------- */
  function pad2(n){ n=parseInt(n,10); return n<10?"0"+n:""+n; }
  var MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  function parseAnyDate(s){
    s = String(s||"").trim(); var m;
    if((m = s.match(/^Date\((\d+),(\d+),(\d+)/))) return m[1]+"-"+pad2(parseInt(m[2],10)+1)+"-"+pad2(m[3]);
    if((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1]+"-"+pad2(m[2])+"-"+pad2(m[3]);
    if((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/))){ if(m[3]<"2015"||m[3]>"2099") return null; return m[3]+"-"+pad2(m[1])+"-"+pad2(m[2]); }
    if((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)) && MON[m[2].toLowerCase()]) return m[3]+"-"+pad2(MON[m[2].toLowerCase()])+"-"+pad2(m[1]);
    return null;
  }
  function addDaysIso(iso,n){ var d=new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
  function monthEnd(ym){ var d=new Date(Date.UTC(+ym.slice(0,4), +ym.slice(5,7), 0)); return d.toISOString().slice(0,10); }
  function prevMonth(ym){ var y=+ym.slice(0,4), m=+ym.slice(5,7)-1; if(m<1){m=12;y--;} return y+"-"+pad2(m); }
  function nextMonth(ym){ var y=+ym.slice(0,4), m=+ym.slice(5,7)+1; if(m>12){m=1;y++;} return y+"-"+pad2(m); }
  function monthLabel(ym){ return new Date(ym+"-01T00:00:00Z").toLocaleDateString("en-IN",{month:"short",year:"numeric",timeZone:"UTC"}); }
  function dateLabel(iso){ return iso ? new Date(iso+"T00:00:00Z").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}) : "—"; }
  function shortDate(iso){ return new Date(iso+"T00:00:00Z").toLocaleDateString("en-IN",{day:"2-digit",month:"short",timeZone:"UTC"}); }
  function canonicalAuditorName(raw){
    var s = String(raw||"").trim().replace(/\s+/g," ");
    return s.replace(/^(Dr|Dt)\.?\s+/i, function(m,p1){ return p1.charAt(0).toUpperCase()+p1.slice(1).toLowerCase()+". "; });
  }
  function parsePct(s){ var t=String(s||"").trim(); if(!t) return null; var n=parseFloat(t.replace("%","")); return isNaN(n)?null:n/100; }
  function colLetter(idx){ var n=idx+1,s=""; while(n>0){ var r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; }
  function findIdx(hdr, re){ for(var i=0;i<hdr.length;i++){ if(re.test(hdr[i])) return i; } return -1; }
  function parseCSV(text){
    var rows=[],row=[],field="",q=false;
    for(var i=0;i<text.length;i++){ var ch=text[i];
      if(q){ if(ch==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=ch; }
      else { if(ch==='"') q=true; else if(ch===","){row.push(field);field="";} else if(ch==="\r"){} else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";} else field+=ch; }
    }
    if(field.length||row.length){row.push(field);rows.push(row);}
    return rows;
  }
  function fetchText(url){
    return fetch(url+"&_ts="+Date.now(),{cache:"no-store"}).then(function(r){ if(!r.ok) throw new Error("http "+r.status); return r.text(); });
  }
  function gvizCsv(file, base, tq, headers){
    return fetchText("https://docs.google.com/spreadsheets/d/"+file+"/gviz/tq?tqx=out:csv"+(headers?"&headers="+headers:"")+"&"+base+(tq?"&tq="+encodeURIComponent(tq):"")).then(parseCSV);
  }
  function gvizJson(file, base, tq){
    return fetchText("https://docs.google.com/spreadsheets/d/"+file+"/gviz/tq?tqx=out:json&"+base+"&tq="+encodeURIComponent(tq))
      .then(function(t){ return JSON.parse(t.replace(/^[^\(]*\(/,"").replace(/\);\s*$/,"")); });
  }
  function num(x){ var n=parseFloat(x); return isNaN(n)?null:n; }

  /* ---------- loaders ---------- */
  /* Tickets -> aggregated records {date, bu, cat, sub, sev, status, n, frtSum, frtN, resSum, resN} */
  function loadTicketsData(){
    /* full tab (no query): the ticket_date column mixes real dates and "2026-09-21" text, and a typed gviz
       query would blank the text ones — the plain export keeps both. */
    return gvizCsv(CFG.FILE_TICKETS, "gid="+CFG.GID_TICKETS_DATA, null, 0).then(function(rows){
      var h = rows[0].map(function(x){ return String(x).trim().toLowerCase(); });
      var ix = {date:h.indexOf("ticket_date"), type:h.indexOf("type"), c2:h.indexOf("c2"), c3:h.indexOf("c3"),
                frt:h.indexOf("first_response_time_in_hrs"), res:h.indexOf("resolution_time"), st:h.indexOf("status")};
      if(ix.date<0 || ix.type<0 || ix.c2<0) throw new Error("ticket Data tab columns not found");
      var out=[];
      for(var i=1;i<rows.length;i++){
        var r=rows[i]; if(!r) continue;
        var t=(r[ix.type]||"").trim().toLowerCase();
        var bu = t==="consult" ? "consult" : (t.indexOf("diagno")===0 ? "diagnostics" : null);
        if(!bu) continue;
        var d=parseAnyDate(r[ix.date]); if(!d) continue;
        var cat=(r[ix.c2]||"").trim()||"(blank)", sub=(r[ix.c3]||"").trim(); if(sub==="nan") sub="";
        var frt=num(r[ix.frt]), res=num(r[ix.res]);
        out.push({date:d, bu:bu, cat:cat, sub:sub, sev:severity(bu,cat), status:(r[ix.st]||"").trim(), n:1,
                  frtSum:frt||0, frtN:frt===null?0:1, resSum:res||0, resN:res===null?0:1});
      }
      return out;
    });
  }
  function loadTicketsMedicine(){
    /* summed server-side: one row per day x category x status (the tab has ~25k ticket rows) */
    return gvizJson(CFG.FILE_TICKETS, "gid="+CFG.GID_TICKETS_MED, "select * limit 1").then(function(j){
      var L={}; j.table.cols.forEach(function(c,i){ var l=(c.label||"").trim().toLowerCase(), x=colLetter(i);
        if(l==="ticket_date") L.d=x; else if(l==="category") L.c=x; else if(l==="status") L.s=x; else if(l==="ticket_no") L.n=x;
        else if(l==="first_response_time_in_hrs") L.f=x; else if(l==="resolution_time") L.r=x; });
      if(!L.d||!L.c||!L.n) throw new Error("Medicine tab columns not found");
      return gvizJson(CFG.FILE_TICKETS, "gid="+CFG.GID_TICKETS_MED,
        "select "+L.d+","+L.c+","+(L.s||L.c)+",count("+L.n+")"+(L.f?",sum("+L.f+"),count("+L.f+")":"")+(L.r?",sum("+L.r+"),count("+L.r+")":"")+
        " where "+L.d+" is not null group by "+L.d+","+L.c+(L.s?","+L.s:""));
    }).then(function(j){
      var out=[];
      (j.table.rows||[]).forEach(function(row){
        var c=row.c||[]; function v(i){ return c[i]&&c[i].v!=null ? c[i].v : null; }
        var d=parseAnyDate(v(0)); if(!d) return;
        var cat=String(v(1)||"(blank)").trim();
        out.push({date:d, bu:"pharma", cat:cat, sub:"", sev:severity("pharma",cat), status:String(v(2)||"").trim(), n:v(3)||0,
                  frtSum:v(4)||0, frtN:v(5)||0, resSum:v(6)||0, resN:v(7)||0});
      });
      return out;
    });
  }
  function loadOrders(){
    return gvizCsv(CFG.FILE_TICKETS, "gid="+CFG.GID_ORDERS, null, 0).then(function(rows){
      var h=rows[0].map(function(x){ return String(x).trim().toLowerCase(); });
      var ib=h.indexOf("bu"), id=h.indexOf("date"), io=h.indexOf("orders");
      if(ib<0||id<0||io<0) throw new Error("Orders tab columns not found");
      var out=[];
      for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r) continue;
        var bu=(r[ib]||"").trim().toLowerCase(), d=parseAnyDate(r[id]), o=num(r[io]);
        if(bu && d && o!==null) out.push({bu:bu, date:d, orders:o}); }
      return out;
    });
  }
  /* Scored audits: {type, date, score(0-1)} by Date of Audit */
  function loadChecklist(src){
    var base="sheet="+encodeURIComponent(src.sheet);
    return gvizCsv(src.file, base, "select * limit 1", src.headers).then(function(h){
      var hdr=(h[0]||[]).map(function(x){ return String(x).trim(); });
      var ia=findIdx(hdr,/^date of audit$/i), iu=findIdx(hdr,/^auditor name$/i), is=findIdx(hdr,/^attained %$/i), it=findIdx(hdr,/^doctor type$/i);
      if(ia<0||iu<0||is<0) throw new Error("columns not found in "+src.sheet);
      var sel=[ia,iu,is].concat(it>=0?[it]:[]).map(colLetter).join(",");
      return gvizCsv(src.file, base, "select "+sel, src.headers).then(function(rows){
        var out=[];
        for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r) continue;
          var d=parseAnyDate(r[0]), au=canonicalAuditorName(r[1]); if(!d||!au) continue;
          out.push({type:src.type, date:d, score:parsePct(r[2]), dtype:(it>=0?(r[3]||"").trim():"")||"—"}); }
        return out;
      });
    });
  }
  function loadCancellationTab(base){
    return gvizCsv(CFG.FILE_CANCEL, base, "select *", 0).then(function(rows){
      var hdr=rows[0].map(function(x){ return String(x).trim(); });
      var ia=findIdx(hdr,/^date of audit$/i), ip=findIdx(hdr,/^date of appointment/i), iu=findIdx(hdr,/^auditor name$/i);
      if(ia<0) throw new Error("cancellation columns not found");
      var out=[];
      for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r) continue;
        out.push({a:parseAnyDate(r[ia]), p:ip>=0?parseAnyDate(r[ip]):null, au:iu>=0?(r[iu]||"").trim():""}); }
      return out;
    });
  }
  function loadCancellation(){
    return Promise.all([
      loadCancellationTab("gid="+CFG.CANCEL_GID),
      loadCancellationTab("sheet="+encodeURIComponent(CFG.CANCEL_NEW_TAB)).catch(function(){ return []; })
    ]).then(function(res){
      function basis(r){ return r.p || (r.a ? addDaysIso(r.a,-1) : null); }
      var rows = res[0].filter(function(r){ var b=basis(r); return !b || b < CFG.CANCEL_SWITCH_DATE; })
        .concat(res[1].filter(function(r){ var b=basis(r); return b && b >= CFG.CANCEL_SWITCH_DATE; }));
      return rows.filter(function(r){ return r.a && r.au; }).map(function(r){ return {type:"PDS Cancellation", date:r.a, score:null, dtype:"—"}; });
    });
  }
  /* Completed consults per day x project (same rules as the audit dashboard's Total Consult):
     Completed only; WLP - Non Pharma (GLP) at booked level; PDS Cancellation = PDS consults with Status Cancelled. */
  function loadConsults(){
    return gvizJson(CFG.FILE_CONSULT, "gid="+CFG.CONSULT_GID, "select * limit 1").then(function(j){
      var L={}, isDate=false;
      j.table.cols.forEach(function(c,i){ var l=(c.label||"").trim().toLowerCase(), x=colLetter(i);
        if(l==="date"){ L.d=x; isDate=/^date/.test(c.type||""); } else if(l==="consult_type") L.t=x; else if(l==="status") L.s=x; else if(l==="total_consult") L.n=x; });
      if(!L.d||!L.t||!L.s||!L.n) throw new Error("Extract 1 columns not found");
      var floor="2026-07-01";
      return gvizJson(CFG.FILE_CONSULT, "gid="+CFG.CONSULT_GID,
        "select "+L.d+","+L.t+","+L.s+",sum("+L.n+") where "+L.d+" >= "+(isDate?"date '"+floor+"'":"'"+floor+"'")+" group by "+L.d+","+L.t+","+L.s);
    }).then(function(j){
      var MAP={"PDS":"PDS","PDS Mounjaro":"PDS- Mounjaro","Non Pharma":"Non Pharma","GLP":"WLP - Non Pharma"};
      var out=[];
      (j.table.rows||[]).forEach(function(row){
        var c=row.c||[]; var d=parseAnyDate(c[0]&&(c[0].v!=null?c[0].v:"")); if(!d) return;
        var raw=c[1]&&c[1].v?String(c[1].v):"", st=c[2]&&c[2].v?String(c[2].v).trim():"", n=c[3]&&typeof c[3].v==="number"?c[3].v:0;
        if(raw==="PDS Cancellation") return;
        var type=MAP[raw]; if(!type) return;
        if(raw==="PDS" && /^cancel/i.test(st)) type="PDS Cancellation";
        else if(type!=="WLP - Non Pharma" && !/^completed$/i.test(st)) return;
        out.push({date:d, type:type, n:n});
      });
      return out;
    });
  }

  /* Loads everything. Each source fails on its own (status recorded) so one broken sheet doesn't blank the page. */
  function load(){
    var status={};
    function guard(name, p, fallback){ return p.then(function(v){ status[name]="ok"; return v; }).catch(function(e){ status[name]="error: "+(e&&e.message||e); return fallback; }); }
    return Promise.all([
      guard("Consult & Diagnostics tickets", loadTicketsData(), []),
      guard("Medicine tickets", loadTicketsMedicine(), []),
      guard("Orders", loadOrders(), []),
      guard("Audits", Promise.all(AUDIT_SOURCES.map(function(s){ return loadChecklist(s).catch(function(){ status["Audits"]="partial"; return []; }); })).then(function(a){ return [].concat.apply([],a); }), []),
      guard("PDS Cancellation reviews", loadCancellation(), []),
      guard("Consults (Extract 1)", loadConsults(), [])
    ]).then(function(r){
      var data={tickets:r[0].concat(r[1]), orders:r[2], audits:r[3].concat(r[4]), consults:r[5], status:status, fetchedAt:new Date()};
      /* earliest audit date each project's live sheet still holds — the PDS / Non Pharma audit sheets keep a
         rolling window, so older periods can be missing audits; compute() flags those periods */
      data.auditFrom={};
      data.audits.forEach(function(a){ if(!data.auditFrom[a.type] || a.date<data.auditFrom[a.type]) data.auditFrom[a.type]=a.date; });
      /* ticket tabs: earliest date held, and the Medicine tab's row count (an export capped at 25,000 rows drops old days) */
      data.medicineRows = r[1].reduce(function(s,x){ return s+x.n; },0);
      data.ticketFrom = data.tickets.reduce(function(m,x){ return (!m||x.date<m)?x.date:m; },null);
      /* data-through date: last day that has both tickets and orders */
      var tMax=data.tickets.reduce(function(m,x){ return x.date>m?x.date:m; },"");
      var oMax=data.orders.reduce(function(m,x){ return x.date>m?x.date:m; },"");
      data.through = (tMax && oMax) ? (tMax<oMax?tMax:oMax) : (tMax||oMax||null);
      return data;
    });
  }

  /* ---------- periods ---------- */
  /* Months from FIRST_MONTH to the data-through month. The last one is MTD when it isn't finished. */
  function periods(data){
    var out=[]; if(!data.through) return out;
    var lastYm=data.through.slice(0,7);
    for(var ym=CFG.FIRST_MONTH; ym<=lastYm; ym=nextMonth(ym)){
      var end=monthEnd(ym), partial=end>data.through;
      out.push({key:ym, start:ym+"-01", end:partial?data.through:end, label:monthLabel(ym)+(partial?" (MTD)":""), short:monthLabel(ym), partial:partial});
    }
    return out;
  }
  /* comparison window: the previous full month, or for an MTD window the same days last month (LMTD) */
  function previousOf(p){
    var pm=prevMonth(p.start.slice(0,7)), pmEnd=monthEnd(pm);
    var e = p.partial ? pm+"-"+p.end.slice(8,10) : pmEnd; if(e>pmEnd) e=pmEnd;
    return {key:pm, start:pm+"-01", end:e, label:monthLabel(pm)+(p.partial?" (same days)":""), partial:p.partial};
  }

  /* ---------- scoring ---------- */
  function rag(score){ if(score===null||isNaN(score)) return "none"; return score>=CFG.RAG.green?"green":(score>=CFG.RAG.amber?"amber":"red"); }
  function compute(data, s, e){
    function inR(d){ return d>=s && d<=e; }
    /* audits */
    var byProj={}; PROJECTS.forEach(function(p){ byProj[p]={type:p, audits:0, scored:0, sum:0, zero:0, pass:0, consults:0}; });
    data.audits.forEach(function(a){ if(!inR(a.date)) return; var b=byProj[a.type]; if(!b) return;
      b.audits++; if(a.score!==null){ b.scored++; b.sum+=a.score; if(a.score===0) b.zero++; if(a.score>=0.9) b.pass++; } });
    var cs=addDaysIso(s,-1), ce=addDaysIso(e,-1);   /* D-1: audits on day X cover consults of day X-1 */
    data.consults.forEach(function(c){ if(c.date>=cs && c.date<=ce && byProj[c.type]) byProj[c.type].consults+=c.n; });
    var A={audits:0, scored:0, sum:0, zero:0, pass:0, consults:0};
    PROJECTS.forEach(function(p){ var b=byProj[p]; A.audits+=b.audits; A.scored+=b.scored; A.sum+=b.sum; A.zero+=b.zero; A.pass+=b.pass; A.consults+=b.consults;
      b.avg=b.scored?b.sum/b.scored*100:null; b.coverage=b.consults?b.audits/b.consults*100:null; b.passPct=b.scored?b.pass/b.scored*100:null; });
    A.score = A.scored ? A.sum/A.scored*100 : null;
    A.coverage = A.consults ? A.audits/A.consults*100 : null;
    A.passPct = A.scored ? A.pass/A.scored*100 : null;
    A.projects = PROJECTS.map(function(p){ return byProj[p]; });
    /* projects whose live sheet doesn't reach back to the start of this window */
    A.missing = ["PDS","Non Pharma","PDS- Mounjaro","WLP - Non Pharma"].filter(function(p){ var f=data.auditFrom&&data.auditFrom[p]; return !f || f>s; })
      .map(function(p){ return {type:p, from:data.auditFrom&&data.auditFrom[p]||null}; });
    A.incomplete = A.missing.length>0;

    /* tickets */
    var bus={};
    BUS.forEach(function(b){ bus[b.key]={key:b.key, label:b.label, orders:0, high:0, medium:0, pending:0, cats:{}, frtSum:0, frtN:0, resSum:0, resN:0}; });
    data.orders.forEach(function(o){ if(!inR(o.date)) return; BUS.forEach(function(b){ if(o.bu===b.orderBu) bus[b.key].orders+=o.orders; }); });
    data.tickets.forEach(function(t){ if(!inR(t.date)) return; var b=bus[t.bu]; if(!b) return;
      if(t.sev==="High") b.high+=t.n; else b.medium+=t.n;
      if(/pending|open/i.test(t.status)) b.pending+=t.n;
      b.frtSum+=t.frtSum; b.frtN+=t.frtN; b.resSum+=t.resSum; b.resN+=t.resN;
      var k=t.cat; var c=b.cats[k]||(b.cats[k]={cat:k, sev:t.sev, n:0, pending:0, frtSum:0, frtN:0, resSum:0, resN:0});
      c.n+=t.n; if(/pending|open/i.test(t.status)) c.pending+=t.n; c.frtSum+=t.frtSum; c.frtN+=t.frtN; c.resSum+=t.resSum; c.resN+=t.resN; });
    var T={orders:0, high:0, medium:0, tickets:0, weighted:0, pending:0, lines:[]};
    var scoreSum=0, scoreN=0;
    BUS.forEach(function(bd){ var b=bus[bd.key];
      b.tickets=b.high+b.medium; b.weighted=CFG.HIGH_WEIGHT*b.high+CFG.MEDIUM_WEIGHT*b.medium;
      b.per10k = b.orders ? b.weighted/b.orders*10000 : null;
      b.rawPer10k = b.orders ? b.tickets/b.orders*10000 : null;
      b.score = b.orders ? Math.max(0, 100*(1 - b.weighted/b.orders)) : null;
      b.frt = b.frtN ? b.frtSum/b.frtN : null; b.res = b.resN ? b.resSum/b.resN : null;
      b.catList = Object.keys(b.cats).map(function(k){ var c=b.cats[k]; c.frt=c.frtN?c.frtSum/c.frtN:null; c.res=c.resN?c.resSum/c.resN:null;
        c.per10k=b.orders?c.n/b.orders*10000:null; c.share=b.tickets?c.n/b.tickets*100:null; return c; })
        .sort(function(x,y){ return (x.sev===y.sev?0:(x.sev==="High"?-1:1)) || y.n-x.n; });
      if(b.score!==null){ scoreSum+=b.score; scoreN++; }
      T.orders+=b.orders; T.high+=b.high; T.medium+=b.medium; T.tickets+=b.tickets; T.weighted+=b.weighted; T.pending+=b.pending;
      T.lines.push(b); });
    T.score = scoreN ? scoreSum/scoreN : null;
    T.per10k = T.orders ? T.weighted/T.orders*10000 : null;

    var overall = (A.score!==null && T.score!==null) ? CFG.WEIGHT_AUDIT*A.score + CFG.WEIGHT_TICKETS*T.score
                : (T.score!==null ? T.score : A.score);
    return {start:s, end:e, audit:A, tickets:T, overall:overall, rag:rag(overall), partialInputs:(A.score===null||T.score===null)};
  }

  /* weekly buckets (Mon-Sun) inside a window, for trend tables */
  function weeks(s, e){
    var out=[], d=new Date(s+"T00:00:00Z"); var dow=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-dow);
    while(d.toISOString().slice(0,10)<=e){ var ws=d.toISOString().slice(0,10); var we=addDaysIso(ws,6);
      out.push({start:ws<s?s:ws, end:we>e?e:we}); d.setUTCDate(d.getUTCDate()+7); }
    return out;
  }

  root.CC = { CFG:CFG, BUS:BUS, HIGH:HIGH, HIGH_LABELS:HIGH_LABELS, PROJECTS:PROJECTS, load:load, periods:periods, previousOf:previousOf, compute:compute, weeks:weeks, rag:rag,
    util:{ dateLabel:dateLabel, shortDate:shortDate, monthLabel:monthLabel, addDaysIso:addDaysIso, parseAnyDate:parseAnyDate } };
})(typeof window!=="undefined" ? window : globalThis);
