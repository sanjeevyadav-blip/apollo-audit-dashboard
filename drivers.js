(function(){
  var U=APP.util, f1=UI.f1, fi=UI.fi, esc=UI.esc, CFG=APP.CFG;
  var BU_ORDER=["pharma","consult","diagnostics"];
  var BU_WHAT={ pharma:"PDS + PDS&ndash;Mounjaro (WLP) + WLP&ndash;Non Pharma (GLP) audits + Pharmacy tickets",
                consult:"Non Pharma audits + Consult tickets", diagnostics:"Diagnostics tickets only (no audits)" };
  var COMP={critical:"Critical errors (audits)", others:"Other audit misses", high:"High-severity tickets", medium:"Medium-severity tickets"};
  var COMP_SHORT={critical:"critical errors", others:"other audit misses", high:"High tickets", medium:"Medium tickets"};
  var COMP_COL={critical:"var(--sev-critical)", others:"var(--sev-others)", high:"var(--sev-high)", medium:"var(--sev-medium)"};
  var KEYS=["critical","others","high","medium"];

  function sgn(v,d){ if(v==null||isNaN(v)) return "&mdash;"; var t=f1(Math.abs(v),d==null?1:d); return (v>0.0001?"+":(v<-0.0001?"&minus;":""))+t; }
  function effCls(v){ return v==null?"":(v>0.05?"up":(v<-0.05?"down":"flat")); }
  function effSpan(v,d){ return '<span class="delta '+effCls(v)+'">'+sgn(v,d)+'</span>'; }

  /* effect of each part on the score: points lost before minus points lost now (positive = helped the score) */
  function parts(cur, prev){
    var out={}; KEYS.forEach(function(k){ var a=prev&&prev.ded[k].pts, b=cur.ded[k].pts; out[k]=(a==null||b==null)?null:(a-b); }); return out;
  }
  /* per ticket category: points = weight x tickets per 1,000 orders of that line */
  function catPts(line){
    var o={}; if(!line||!line.orders) return o;
    Object.keys(line.cats).forEach(function(k){ var c=line.cats[k], w=c.sev==="High"?CFG.D_HIGH:CFG.D_MEDIUM; o[k]={cat:k, sev:c.sev, n:c.n, per1k:c.n/line.orders*1000, pts:w*c.n/line.orders*1000}; });
    return o;
  }
  function catEffects(cur, prev){
    var a=catPts(prev&&prev.line), b=catPts(cur.line), keys={}; Object.keys(a).concat(Object.keys(b)).forEach(function(k){ keys[k]=1; });
    return Object.keys(keys).map(function(k){ var p=a[k]||{n:0,per1k:0,pts:0,sev:(b[k]||{}).sev}, c=b[k]||{n:0,per1k:0,pts:0,sev:p.sev};
      return {cat:k, sev:c.sev||p.sev, nPrev:p.n, nCur:c.n, rPrev:p.per1k, rCur:c.per1k, eff:(prev&&prev.line&&prev.line.orders)?(p.pts-c.pts):null}; })
      .sort(function(x,y){ return Math.abs(y.eff||0)-Math.abs(x.eff||0); });
  }
  /* per audit type inside a line: share of the line's critical-error and other-miss points */
  function typeEffects(cur, prev){
    function contrib(bu){ var o={}; if(!bu) return o; var au=bu.audit;
      au.types.forEach(function(p){ o[p.type]={type:p.type, scored:p.scored, zero:p.zero, crit: au.scored ? CFG.D_CRITICAL*p.zero/au.scored*100 : null,
        oth: au.nzN ? CFG.D_OTHERS*(p.nzN-p.nzSum)/au.nzN*100 : null, critPct: p.scored? p.zero/p.scored*100 : null, avgNz: p.nzN? p.nzSum/p.nzN*100 : null }; });
      return o; }
    var a=contrib(prev), b=contrib(cur);
    return Object.keys(b).map(function(t){ var p=a[t]||{}, c=b[t];
      return {type:t, c:c, p:p, effCrit:(p.crit==null||c.crit==null)?null:p.crit-c.crit, effOth:(p.oth==null||c.oth==null)?null:p.oth-c.oth}; });
  }
  function paramChanges(D, k, cur, prev){
    var types=APP.BU_AUDITS[k]||[]; if(!types.length) return [];
    var A=APP.parameters(D, cur.start, cur.end), B=APP.parameters(D, prev.start, prev.end), out=[];
    types.forEach(function(t){ var pb={}; (B[t]||[]).forEach(function(x){ pb[x.name]=x; });
      (A[t]||[]).forEach(function(x){ var y=pb[x.name]; if(!y||x.n<10||y.n<10||x.pct==null||y.pct==null) return;
        out.push({type:t, name:x.name, group:x.group, cur:x.pct, prev:y.pct, d:x.pct-y.pct, n:x.n}); }); });
    return out;
  }
  function verdict(bu, cur, prev, pe, ce){
    if(cur.score==null) return "Not enough data to score this line for this period.";
    if(!prev || prev.score==null) return "No earlier period to compare with.";
    var d=cur.score-prev.score, list=KEYS.filter(function(k){ return pe[k]!=null; }).sort(function(a,b){ return Math.abs(pe[b])-Math.abs(pe[a]); });
    if(!list.length) return "";
    var main=list[0], dir=d>=0.05?"up":(d<=-0.05?"down":"flat");
    var txt = dir==="flat" ? "Score is about the same" : ("Score is "+dir+" <b>"+f1(Math.abs(d))+"</b> points");
    var aud=(pe.critical||0)+(pe.others||0), tic=(pe.high||0)+(pe.medium||0);
    txt += ", driven mainly by <b>"+(Math.abs(tic)>=Math.abs(aud)?"tickets":"audits")+"</b> (tickets "+sgn(tic)+", audits "+sgn(aud)+"). ";
    txt += "Biggest single move: <b>"+COMP_SHORT[main]+"</b> "+sgn(pe[main])+" pts";
    if((main==="high"||main==="medium") && ce.length){ var top=ce.filter(function(c){ return c.sev===(main==="high"?"High":"Medium") && c.eff!=null; })[0];
      if(top) txt += " &mdash; led by <b>"+esc(top.cat)+"</b> ("+f1(top.rPrev,2)+" &rarr; "+f1(top.rCur,2)+" per 1,000 orders, "+sgn(top.eff)+" pts)"; }
    if(main==="critical"||main==="others"){ var cr=cur.ded.critical.rate, pr=prev.ded.critical.rate, ca=cur.audit, pa=prev.audit;
      if(main==="critical") txt += " &mdash; critical-error rate "+f1(pr,2)+"% &rarr; "+f1(cr,2)+"% ("+fi(pa.zero)+" &rarr; "+fi(ca.zero)+" zero-score audits)";
      else txt += " &mdash; average of non-zero audits "+f1(100-prev.ded.others.rate,1)+"% &rarr; "+f1(100-cur.ded.others.rate,1)+"%"; }
    return txt+".";
  }

  function waterfall(cur, prev, pe){
    if(!prev||prev.score==null||cur.score==null) return '';
    var rows='<div class="wfl">'+'<div class="r"><span>'+'Earlier score'+'</span><b>'+f1(prev.score)+'</b></div>';
    KEYS.forEach(function(k){ var v=pe[k]; if(v==null) return; var w=Math.min(100,Math.abs(v)/Math.max(1,maxAbs(pe))*100);
      rows+='<div class="r"><span><i style="background:'+COMP_COL[k]+'"></i>'+COMP[k]+'</span><em><u class="'+(v>=0?'pos':'neg')+'" style="width:'+w.toFixed(1)+'%"></u></em><b class="'+effCls(v)+'">'+sgn(v)+'</b></div>'; });
    rows+='<div class="r tot"><span>Score now</span><b>'+f1(cur.score)+'</b></div></div>';
    return rows;
  }
  function maxAbs(pe){ var m=0; KEYS.forEach(function(k){ if(pe[k]!=null) m=Math.max(m,Math.abs(pe[k])); }); return m; }

  var NAV = window.__AUDIT_NAV__;
  UI.page({
    navHtml: NAV, pageLabel: "Page 7 · Score Drivers.",
    title: "Score Drivers · why each business line moved",
    subtitle: "Page 7 &middot; month on month, by business line: was it audits or tickets, and which part",
    intro: "Each business line has its own score (same weights as the overall score: critical errors &times;6, High tickets &times;4, Medium tickets &times;2, other audit misses &times;1). This page splits each line&rsquo;s change against the comparison period into audits and tickets, then shows exactly which ticket categories, audit types and checklist items made the difference.",
    render: function(c){
      var M=c.M, PM=c.PM, D=c.D, h='';
      if(!PM){ return '<div class="panel empty">There is no earlier period to compare with for this range. Pick a later month (comparison needs data from August 2026 onwards).</div>'; }
      var pvLab=esc(c.pv.label);
      /* 01 summary cards */
      h+='<div class="section-label"><span class="n">01</span>What moved each business line&rsquo;s score &middot; '+esc(c.p.label)+' vs '+pvLab+'</div><div class="bucards">';
      BU_ORDER.forEach(function(k){ var cur=M.bu[k], prev=PM.bu[k], pe=parts(cur,prev), ce=catEffects(cur,prev);
        var d=(cur.score!=null&&prev.score!=null)?cur.score-prev.score:null;
        h+='<div class="bucard"><div class="t"><b>'+esc(cur.label)+'</b><span class="rag '+APP.rag(cur.score)+'" style="font-size:10.5px">'+UI.ragLabel(APP.rag(cur.score))+'</span></div>'+
          '<div style="font-size:11px;color:var(--ink-soft);margin-top:4px">'+BU_WHAT[k]+'</div>'+
          '<div class="big tnum">'+f1(prev.score)+' &rarr; '+f1(cur.score)+' <small>'+(d==null?'':UI.delta(cur.score,prev.score,1,true))+'</small></div>'+
          waterfall(cur,prev,pe)+
          '<p class="vtxt">'+verdict(k,cur,prev,pe,ce)+'</p></div>';
      });
      h+='</div><p class="desc" style="margin:10px 0 0;font-size:11.5px">Bars to the right (green) helped the score; bars to the left (red) pulled it down. Audit parts compare like with like only when both periods have complete audit data'+(c.auditCmp?'':' &mdash; <b>audit data is incomplete for one of the periods, so read audit parts with care</b>')+'.</p>';

      /* 02 ticket reasons */
      h+='<div class="section-label"><span class="n">02</span>Ticket reasons &middot; which categories moved the score</div><div class="stack">';
      BU_ORDER.forEach(function(k){ var cur=M.bu[k], prev=PM.bu[k], ce=catEffects(cur,prev).filter(function(x){ return x.nCur||x.nPrev; }).slice(0,8), L=cur.line, PL=prev.line;
        h+='<div class="panel"><h3 class="ph">'+esc(cur.label)+' tickets</h3><p class="desc">Orders '+fi(PL.orders)+' &rarr; '+fi(L.orders)+'. High '+f1(PL.highPer1k,2)+' &rarr; '+f1(L.highPer1k,2)+' and Medium '+f1(PL.medPer1k,2)+' &rarr; '+f1(L.medPer1k,2)+' per 1,000 orders.</p>'+
          '<div class="tbl-wrap"><table><thead><tr><th>Category</th><th>Sev</th><th class="num">Tickets</th><th class="num">Per 1,000</th><th class="num">Effect</th></tr></thead><tbody>'+
          (ce.length?ce.map(function(x){ return '<tr><td>'+esc(x.cat)+'</td><td><span class="sev '+esc(x.sev||"")+'">'+esc(x.sev||"")+'</span></td><td class="num tnum">'+fi(x.nPrev)+' &rarr; '+fi(x.nCur)+'</td><td class="num tnum">'+f1(x.rPrev,2)+' &rarr; '+f1(x.rCur,2)+'</td><td class="num tnum">'+effSpan(x.eff,2)+'</td></tr>'; }).join(""):'<tr><td colspan="5" class="empty">No tickets in either period.</td></tr>')+
          '</tbody></table></div></div>';
      });
      h+='</div><p class="desc" style="margin:10px 0 0;font-size:11.5px"><b>Effect</b> = points this category cost before minus points it costs now (weight &times; tickets per 1,000 orders). <span class="delta up">+</span> helped the score, <span class="delta down">&minus;</span> pulled it down. A category can rise in tickets and still help if orders grew faster.</p>';

      /* 03 audit reasons */
      h+='<div class="section-label"><span class="n">03</span>Audit reasons &middot; which audit types and checklist items moved the score</div><div class="stack">';
      ["pharma","consult"].forEach(function(k){ var cur=M.bu[k], prev=PM.bu[k], te=typeEffects(cur,prev), pc=paramChanges(D,k,{start:c.s,end:c.e},c.pv);
        var drops=pc.filter(function(x){ return x.d<0; }).sort(function(a,b){ return a.d-b.d; }).slice(0,6), ups=pc.filter(function(x){ return x.d>0; }).sort(function(a,b){ return b.d-a.d; }).slice(0,4);
        h+='<div class="panel"><h3 class="ph">'+esc(cur.label)+' audits</h3>'+
          '<div class="tbl-wrap"><table><thead><tr><th>Audit type</th><th class="num">Audits</th><th class="num">Critical errors</th><th class="num">Effect</th><th class="num">Avg of non-zero</th><th class="num">Effect</th></tr></thead><tbody>'+
          te.map(function(x){ return '<tr><td>'+esc(x.type)+'</td><td class="num tnum">'+fi(x.p.scored||0)+' &rarr; '+fi(x.c.scored)+'</td><td class="num tnum">'+fi(x.p.zero||0)+' &rarr; '+fi(x.c.zero)+' <span style="color:var(--ink-soft)">('+f1(x.c.critPct,2)+'%)</span></td><td class="num tnum">'+effSpan(x.effCrit,2)+'</td><td class="num tnum">'+f1(x.p.avgNz,1)+'% &rarr; '+f1(x.c.avgNz,1)+'%</td><td class="num tnum">'+effSpan(x.effOth,2)+'</td></tr>'; }).join("")+
          '</tbody></table></div>'+
          '<h4 class="ph2">Checklist items that dropped most</h4>'+
          (drops.length?'<div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Type</th><th class="num">Score</th><th class="num">Change</th><th class="num">Audits</th></tr></thead><tbody>'+
            drops.map(function(x){ return '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.type)+'</td><td class="num tnum">'+f1(x.prev,1)+'% &rarr; '+f1(x.cur,1)+'%</td><td class="num tnum"><span class="delta down">'+sgn(x.d,1)+'</span></td><td class="num tnum">'+fi(x.n)+'</td></tr>'; }).join("")+'</tbody></table></div>':'<p class="desc">No checklist item fell.</p>')+
          (ups.length?'<h4 class="ph2">Improved most</h4><div class="tbl-wrap"><table><tbody>'+ups.map(function(x){ return '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.type)+'</td><td class="num tnum">'+f1(x.prev,1)+'% &rarr; '+f1(x.cur,1)+'%</td><td class="num tnum"><span class="delta up">'+sgn(x.d,1)+'</span></td><td class="num tnum">'+fi(x.n)+'</td></tr>'; }).join("")+'</tbody></table></div>':'')+
          '</div>';
      });
      h+='</div><p class="desc" style="margin:10px 0 0;font-size:11.5px">Diagnostics has no audits. Audit-type <b>Effect</b> is that type&rsquo;s share of the line&rsquo;s critical-error points (&times;6) and other-miss points (&times;1), before minus now. Checklist score = points given &divide; maximum points for that item; items with fewer than 10 audits in either period are left out.</p>';

      /* 04 month on month */
      var months=c.periods, rows='';
      months.forEach(function(m,i){
        var cur=APP.metrics(D,m.start,m.end), pv=APP.previousOf(m), prev=(pv.start>=CFG.FIRST_MONTH+"-01")?APP.metrics(D,pv.start,pv.end,APP.ticketEndFor(D,m,pv)):null;
        rows+='<tr><td><b>'+esc(m.short)+'</b>'+(m.partial?' <span style="color:var(--ink-soft)">(MTD)</span>':'')+'</td>';
        BU_ORDER.forEach(function(k){ var cb=cur.bu[k], pb=prev?prev.bu[k]:null, pe=pb?parts(cb,pb):null;
          var main=pe?KEYS.filter(function(x){ return pe[x]!=null; }).sort(function(a,b){ return Math.abs(pe[b])-Math.abs(pe[a]); })[0]:null, extra='';
          if(main==="high"||main==="medium"){ var top=catEffects(cb,pb).filter(function(x){ return x.sev===(main==="high"?"High":"Medium")&&x.eff!=null; })[0]; if(top) extra=' &middot; '+esc(top.cat); }
          rows+='<td class="num tnum"><span class="rag '+APP.rag(cb.score)+'" style="font-size:11px">'+f1(cb.score)+'</span> '+(pb&&pb.score!=null&&cb.score!=null?UI.delta(cb.score,pb.score,1,true):'')+'</td>'+
            '<td style="font-size:11.5px;color:var(--ink-soft)">'+(main?COMP_SHORT[main]+' '+sgn(pe[main])+extra:'&mdash;')+'</td>';
        });
        rows+='</tr>';
      });
      h+='<div class="section-label"><span class="n">04</span>Month on month &middot; score, change and the main reason</div><div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Month</th>'+
        BU_ORDER.map(function(k){ return '<th class="num">'+esc(M.bu[k].label)+'</th><th>Main reason</th>'; }).join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
        '<p class="desc" style="margin:10px 0 0;font-size:11.5px">Each month is compared with the month before (a month-to-date is compared with the same days of the month before). &ldquo;Main reason&rdquo; is the part that moved the score most, with the ticket category behind it when that part is tickets.</p></div>';
      return h;
    },
    explain: function(c){
      return { steps:[
        {t:"01 &middot; Cards", see:"Each business line&rsquo;s score before and now, a bar per part and a one-line reason.", mean:"Green bars helped the score, red bars pulled it down. The bars add up to the change.", look:"The longest bar is the main reason for the change."},
        {t:"02 &middot; Ticket reasons", see:"Ticket categories with tickets and tickets per 1,000 orders before &rarr; now.", mean:"Effect shows how many score points each category moved.", look:"Big red effects: categories growing faster than orders."},
        {t:"03 &middot; Audit reasons", see:"Each audit type&rsquo;s critical errors and average score, then the checklist items that fell or rose most.", mean:"Shows whether audits pulled the score down and which checklist items explain it.", look:"Checklist items with large drops on many audits."},
        {t:"04 &middot; Month on month", see:"Every month&rsquo;s score per line, its change and the main reason.", mean:"A quick history of what drove each month.", look:"Reasons that repeat month after month."}],
        terms:[
          ["Effect","Score points a part moved between the two periods.","Points lost before &minus; points lost now. Positive = helped.",UI.SRC.calc],
          ["Business line score","Score for one line using only its audits and tickets.","100 &minus; 6&times;critical-error % &minus; 4&times;High per 1,000 &minus; 2&times;Medium per 1,000 &minus; 1&times;other misses.",UI.SRC.calc],
          ["Checklist score","How well an item is done in audits.","Points given &divide; maximum points for that item &times; 100.",UI.SRC.audit]] };
    },
    guide: '<div class="hcard"><h3><span class="no">A</span>Read top to bottom</h3><p>Start with the cards: they tell you whether audits or tickets moved each line. Then go to the matching section for the detail.</p></div>'+
           '<div class="hcard"><h3><span class="no">B</span>Signs</h3><p><span class="delta up">+</span> helped the score, <span class="delta down">&minus;</span> pulled it down.</p></div>'+
           '<div class="hcard"><h3><span class="no">C</span>Period</h3><p>Pick a month (or any range) with the chips at the top; it is compared with the period before.</p></div>'
  });
})();
