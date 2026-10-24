(function(){
  var U=APP.util, f1=UI.f1, fi=UI.fi, esc=UI.esc, CFG=APP.CFG, SLA=CFG.SLA;
  var BU=[{k:"pharma",l:"Pharmacy"},{k:"consult",l:"Consult"},{k:"diagnostics",l:"Diagnostics"}];
  var COL={pharma:"var(--sev-high)", consult:"var(--accent)", diagnostics:"var(--sev-others)"};

  function hrs(h){ if(h==null||isNaN(h)) return "&mdash;"; if(h<1) return Math.round(h*60)+"m"; if(h<48) return f1(h,1)+"h"; return f1(h/24,1)+"d"; }
  function pctv(v){ return v==null?"&mdash;":f1(v,1)+"%"; }
  function quant(a,q){ if(!a.length) return null; var i=(a.length-1)*q, lo=Math.floor(i), hi=Math.ceil(i); return a[lo]+(a[hi]-a[lo])*(i-lo); }
  function isPend(t){ return /pending|open/i.test(t.status); }
  function inRange(D,s,e){ return D.tickets.filter(function(t){ return t.date>=s && t.date<=e; }); }

  /* one group of tickets -> response / resolution figures */
  function stats(list, asOf){
    var fr=[], rs=[], fIn=0, rIn=0, pend=0, aged=0, ages=[0,0,0,0,0];
    list.forEach(function(t){ var sla=SLA[t.sev]||SLA.Medium;
      if(t.frt!=null){ fr.push(t.frt); if(t.frt<=sla.frt) fIn++; }
      if(isPend(t)){ pend++; var age=APP.util.daysBetween(t.date, asOf); if(age*24>sla.res) aged++;
        ages[age<=1?0:(age<=3?1:(age<=7?2:(age<=14?3:4)))]++; }
      else if(t.res!=null){ rs.push(t.res); if(t.res<=sla.res) rIn++; } });
    fr.sort(function(a,b){ return a-b; }); rs.sort(function(a,b){ return a-b; });
    function avg(a){ return a.length? a.reduce(function(x,y){ return x+y; },0)/a.length : null; }
    return {n:list.length, frtN:fr.length, frtAvg:avg(fr), frtMed:quant(fr,.5), frtP90:quant(fr,.9), frtSla: fr.length? fIn/fr.length*100 : null,
            resN:rs.length, resAvg:avg(rs), resMed:quant(rs,.5), resP90:quant(rs,.9), resSla: rs.length? rIn/rs.length*100 : null,
            pending:pend, aged:aged, agedPct: list.length? aged/list.length*100 : null, ages:ages, fr:fr, rs:rs};
  }
  function by(list, keyFn){ var o={}; list.forEach(function(t){ var k=keyFn(t); (o[k]||(o[k]=[])).push(t); }); return o; }
  function buckets(arr, edges){ var out=edges.map(function(){ return 0; }); out.push(0); arr.forEach(function(v){ for(var i=0;i<edges.length;i++){ if(v<=edges[i]){ out[i]++; return; } } out[edges.length]++; }); return out; }
  function tile(label, cur, prev, fmt, betterLow, sub, suf, noCmpTxt){
    var d = (cur!=null && prev!=null) ? UI.delta(cur, prev, 1, !betterLow, suf||'')+' <span style="color:var(--ink-soft)">vs before</span>' : '<span class="delta flat">'+(noCmpTxt||'no comparison')+'</span>';
    return '<div class="dtile"><div class="rank">'+label+'</div><div class="pts tnum" style="font-size:30px">'+fmt(cur)+'</div><div class="rate">'+(sub||'')+'</div><div class="chg">'+d+'</div></div>';
  }

  UI.page({
    navHtml: window.__AUDIT_NAV__, pageLabel: "Page 8 · Ticket Times.",
    title: "Ticket Times · first response and resolution",
    subtitle: "Page 8 &middot; how fast patient tickets are answered and closed, by business line, severity and category",
    intro: "First response time (FRT) is how long a patient waits for the first reply; resolution time is how long until the ticket is closed. Targets: <b>High</b> &mdash; first reply within <b>"+SLA.High.frt+"h</b>, closed within <b>"+SLA.High.res+"h</b>; <b>Medium</b> &mdash; first reply within <b>"+SLA.Medium.frt+"h</b>, closed within <b>"+SLA.Medium.res+"h</b>.",
    usesAudits: false,
    render: function(c){
      var D=c.D, asOf=D.through||c.e, cur=inRange(D,c.s,c.e), prv=c.PM?inRange(D,c.pv.start,c.pv.end):null;
      var S=stats(cur, asOf), P=prv?stats(prv, c.pv.end):null, h='';
      /* 01 tiles */
      h+='<div class="section-label"><span class="n">01</span>Headline &middot; '+fi(S.n)+' tickets, '+esc(c.p.label)+(P?' vs '+esc(c.pv.label):'')+'</div><div class="tiles4" style="grid-template-columns:repeat(6,minmax(0,1fr))">'+
        tile("AVG FIRST RESPONSE", S.frtAvg, P&&P.frtAvg, hrs, true, "median "+hrs(S.frtMed)+" &middot; 90% within "+hrs(S.frtP90), "h")+
        tile("FIRST REPLY WITHIN TARGET", S.frtSla, P&&P.frtSla, pctv, false, fi(S.frtN)+" tickets with a reply time", " pts")+
        tile("AVG RESOLUTION", S.resAvg, P&&P.resAvg, hrs, true, "median "+hrs(S.resMed)+" &middot; 90% within "+hrs(S.resP90), "h")+
        tile("CLOSED WITHIN TARGET", S.resSla, P&&P.resSla, pctv, false, fi(S.resN)+" closed tickets", " pts")+
        tile("STILL PENDING", S.pending, null, fi, true, "of "+fi(S.n)+" raised in the range", "", "open today &mdash; not compared")+
        tile("PENDING PAST TARGET", S.aged, null, fi, true, pctv(S.agedPct)+" of tickets, as of "+U.dateLabel(asOf), "", "open today &mdash; not compared")+
        '</div>';

      /* 02 business line x severity */
      var rows='', gb=by(cur, function(t){ return t.bu; });
      BU.forEach(function(b){ var L=gb[b.k]||[], st=stats(L,asOf), sv=by(L,function(t){ return t.sev; });
        function row(lbl, x, strong){ return '<tr'+(strong?' style="font-weight:600"':'')+'><td>'+lbl+'</td><td class="num tnum">'+fi(x.n)+'</td><td class="num tnum">'+hrs(x.frtAvg)+'</td><td class="num tnum">'+hrs(x.frtMed)+'</td><td class="num tnum">'+hrs(x.frtP90)+'</td><td class="num tnum">'+pctv(x.frtSla)+'</td><td class="num tnum">'+hrs(x.resAvg)+'</td><td class="num tnum">'+hrs(x.resMed)+'</td><td class="num tnum">'+hrs(x.resP90)+'</td><td class="num tnum">'+pctv(x.resSla)+'</td><td class="num tnum">'+fi(x.pending)+'</td><td class="num tnum">'+fi(x.aged)+'</td></tr>'; }
        rows+=row('<b>'+b.l+'</b>', st, true);
        ["High","Medium"].forEach(function(sv0){ if(sv[sv0]) rows+=row('&nbsp;&nbsp;<span class="sev '+sv0+'">'+sv0+'</span>', stats(sv[sv0],asOf)); });
      });
      h+='<div class="section-label"><span class="n">02</span>By business line and severity</div><div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Line</th><th class="num">Tickets</th><th class="num">FRT avg</th><th class="num">FRT median</th><th class="num">FRT 90%</th><th class="num">Reply in target</th><th class="num">Resolution avg</th><th class="num">Res. median</th><th class="num">Res. 90%</th><th class="num">Closed in target</th><th class="num">Pending</th><th class="num">Past target</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
        '<p class="desc" style="margin:10px 0 0;font-size:11.5px"><b>90%</b> = 9 in 10 tickets were answered / closed within this time. Resolution uses closed tickets only; still-open tickets are counted under Pending, and <b>Past target</b> = still open longer than the resolution target.</p></div>';

      /* 03 monthly trend */
      var months=c.periods, labs=months.map(function(m){ return m.short.replace(/ 20\d\d$/,"")+(m.partial?"*":""); });
      var frtS=[], slaS=[], resS=[];
      BU.forEach(function(b){ var fv=[], sv=[], rv=[];
        months.forEach(function(m){ var x=stats(inRange(D,m.start,m.end).filter(function(t){ return t.bu===b.k; }), m.end<asOf?m.end:asOf); fv.push(x.frtAvg); sv.push(x.resSla); rv.push(x.frtSla); });
        frtS.push({name:b.l, color:COL[b.k], vals:fv}); slaS.push({name:b.l, color:COL[b.k], vals:sv}); resS.push({name:b.l, color:COL[b.k], vals:rv}); });
      var leg=UI.legend(BU.map(function(b){ return [b.l, COL[b.k]]; }));
      h+='<div class="section-label"><span class="n">03</span>Month by month</div><div class="grid3">'+
        '<div class="panel"><h3 class="ph">Average first response (hours)</h3>'+UI.lineChart("tFrt", labs, frtS, {w:420,h:220,min:0,fmt:function(v){ return hrs(v); }})+leg+'</div>'+
        '<div class="panel"><h3 class="ph">First reply within target (%)</h3>'+UI.lineChart("tFrtSla", labs, resS, {w:420,h:220,min:0,max:100,fmt:function(v){ return f1(v,1)+"%"; }})+leg+'</div>'+
        '<div class="panel"><h3 class="ph">Closed within target (%)</h3>'+UI.lineChart("tResSla", labs, slaS, {w:420,h:220,min:0,max:100,fmt:function(v){ return f1(v,1)+"%"; }})+leg+'</div>'+
        '</div><p class="desc" style="margin:10px 0 0;font-size:11.5px">* = month to date.</p>';

      /* 04 distribution */
      var FE=[1,2,4,8,24], RE=[24,48,72,168];
      var dist='';
      BU.forEach(function(b){ var L=gb[b.k]||[], st=stats(L,asOf), fb=buckets(st.fr,FE), rb=buckets(st.rs,RE), n=L.length||1, noRep=L.length-st.frtN;
        function cell(v){ return '<td class="num tnum">'+fi(v)+' <span style="color:var(--ink-soft)">('+f1(v/n*100,0)+'%)</span></td>'; }
        dist+='<tr><td><b>'+b.l+'</b></td>'+fb.map(cell).join("")+cell(noRep)+'</tr>';
        dist+='<tr class="sub"><td style="color:var(--ink-soft)">&nbsp;&nbsp;closed in</td>'+rb.map(cell).join("")+cell(st.pending)+'<td></td></tr>'; });
      h+='<div class="section-label"><span class="n">04</span>How long patients wait &middot; spread of tickets</div><div class="panel"><div class="tbl-wrap"><table><thead><tr><th></th><th class="num">&le;1h / &le;24h</th><th class="num">1&ndash;2h / 1&ndash;2d</th><th class="num">2&ndash;4h / 2&ndash;3d</th><th class="num">4&ndash;8h / 3&ndash;7d</th><th class="num">8&ndash;24h / &gt;7d</th><th class="num">&gt;24h / pending</th><th class="num">No reply yet</th></tr></thead><tbody>'+dist+'</tbody></table></div>'+
        '<p class="desc" style="margin:10px 0 0;font-size:11.5px">First row per line = first-response time (&le;1h, 1&ndash;2h, 2&ndash;4h, 4&ndash;8h, 8&ndash;24h, &gt;24h, no reply recorded). Second row = resolution time of closed tickets (&le;24h, 1&ndash;2 days, 2&ndash;3 days, 3&ndash;7 days, &gt;7 days) and tickets still pending.</p></div>';

      /* 05 categories */
      var gc=by(cur, function(t){ return t.bu+"|"+t.cat; }), cats=Object.keys(gc).map(function(k){ var L=gc[k], st=stats(L,asOf), pp=prv?stats(prv.filter(function(t){ return t.bu+"|"+t.cat===k; }), c.pv.end):null;
        return {bu:L[0].bu, cat:L[0].cat, sev:L[0].sev, st:st, pp:pp}; }).sort(function(a,b){ return b.st.n-a.st.n; });
      h+='<div class="section-label"><span class="n">05</span>By ticket category</div><div class="panel"><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><span class="lbl" style="font-size:11px;color:var(--ink-soft)">LINE</span>'+
        '<button type="button" class="chip on" data-cbu="all">All</button>'+BU.map(function(b){ return '<button type="button" class="chip" data-cbu="'+b.k+'">'+b.l+'</button>'; }).join("")+
        '<span style="margin-left:auto;font-size:11px;color:var(--ink-soft)">Sort</span><button type="button" class="chip on" data-csort="n">Most tickets</button><button type="button" class="chip" data-csort="aged">Most past target</button><button type="button" class="chip" data-csort="frt">Slowest reply</button></div>'+
        '<div class="tbl-wrap"><table id="catTimes"><thead><tr><th>Category</th><th>Line</th><th>Sev</th><th class="num">Tickets</th><th class="num">FRT avg</th><th class="num">Reply in target</th><th class="num">Resolution avg</th><th class="num">Closed in target</th><th class="num">Pending</th><th class="num">Past target</th><th class="num">FRT vs before</th></tr></thead><tbody></tbody></table></div></div>';
      window.__CAT_TIMES__ = cats;

      /* 06 pending ageing */
      var age='';
      BU.forEach(function(b){ var st=stats(gb[b.k]||[],asOf); age+='<tr><td><b>'+b.l+'</b></td>'+st.ages.map(function(v){ return '<td class="num tnum">'+fi(v)+'</td>'; }).join("")+'<td class="num tnum" style="font-weight:600">'+fi(st.pending)+'</td></tr>'; });
      h+='<div class="section-label"><span class="n">06</span>Open tickets by age &middot; as of '+U.dateLabel(asOf)+'</div><div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Line</th><th class="num">&le;1 day</th><th class="num">1&ndash;3 days</th><th class="num">3&ndash;7 days</th><th class="num">7&ndash;14 days</th><th class="num">&gt;14 days</th><th class="num">Total pending</th></tr></thead><tbody>'+age+'</tbody></table></div>'+
        '<p class="desc" style="margin:10px 0 0;font-size:11.5px">Tickets raised in the selected range that are still pending, by how many days ago they were raised.</p></div>';
      return h;
    },
    after: function(){
      var state={bu:"all", sort:"n"};
      function draw(){ var cats=(window.__CAT_TIMES__||[]).filter(function(x){ return state.bu==="all"||x.bu===state.bu; }).slice();
        cats.sort(function(a,b){ if(state.sort==="aged") return b.st.aged-a.st.aged; if(state.sort==="frt") return (b.st.frtAvg||0)-(a.st.frtAvg||0); return b.st.n-a.st.n; });
        var lab={pharma:"Pharmacy",consult:"Consult",diagnostics:"Diagnostics"};
        document.querySelector("#catTimes tbody").innerHTML = cats.slice(0,30).map(function(x){ var s=x.st, p=x.pp;
          return '<tr><td>'+esc(x.cat)+'</td><td>'+lab[x.bu]+'</td><td><span class="sev '+esc(x.sev)+'">'+esc(x.sev)+'</span></td><td class="num tnum">'+fi(s.n)+'</td><td class="num tnum">'+hrs(s.frtAvg)+'</td><td class="num tnum">'+pctv(s.frtSla)+'</td><td class="num tnum">'+hrs(s.resAvg)+'</td><td class="num tnum">'+pctv(s.resSla)+'</td><td class="num tnum">'+fi(s.pending)+'</td><td class="num tnum">'+fi(s.aged)+'</td><td class="num tnum">'+(p&&p.frtAvg!=null&&s.frtAvg!=null?UI.delta(s.frtAvg,p.frtAvg,1,false,'h'):'&mdash;')+'</td></tr>'; }).join("") || '<tr><td colspan="11" class="empty">No tickets.</td></tr>'; }
      Array.prototype.forEach.call(document.querySelectorAll("[data-cbu]"), function(b){ b.addEventListener("click", function(){ state.bu=b.dataset.cbu; document.querySelectorAll("[data-cbu]").forEach(function(x){ x.classList.toggle("on", x===b); }); draw(); }); });
      Array.prototype.forEach.call(document.querySelectorAll("[data-csort]"), function(b){ b.addEventListener("click", function(){ state.sort=b.dataset.csort; document.querySelectorAll("[data-csort]").forEach(function(x){ x.classList.toggle("on", x===b); }); draw(); }); });
      draw();
    },
    explain: function(c){
      return { steps:[
        {t:"01 &middot; Headline", see:"Six tiles for the selected range with the change from the period before.", mean:"How fast patients get a first reply and a fix, and how many are still waiting.", look:"Reply / closed within target going down, or Pending past target going up."},
        {t:"02 &middot; By line and severity", see:"Average, median and 90% times per line, split into High and Medium.", mean:"Shows which line and severity is slow.", look:"High tickets with a low % within target: these are the serious ones."},
        {t:"03 &middot; Month by month", see:"Three charts: average first reply, % replied within target, % closed within target.", mean:"Whether speed is improving.", look:"Lines heading down on the % charts."},
        {t:"04 &middot; Spread", see:"How many tickets fall in each time band.", mean:"Averages can hide a long tail; this shows it.", look:"Large counts in the slowest bands."},
        {t:"05 &middot; Categories", see:"Every category with times and pending counts; filter by line and sort.", mean:"Points to the exact issue types that are slow.", look:"Categories with many tickets past target."},
        {t:"06 &middot; Open tickets by age", see:"Pending tickets by days since raised.", mean:"The backlog and how old it is.", look:"Anything older than 7 days."}],
        terms:[
          ["First response time (FRT)","Hours until the patient got the first reply.","first_response_time_in_hrs from the ticket sheet.",UI.SRC.tickets],
          ["Resolution time","Hours until the ticket was closed.","resolution_time from the ticket sheet; closed tickets only.",UI.SRC.tickets],
          ["Target (SLA)","How fast each severity should be handled.","High: reply 2h, close 24h. Medium: reply 4h, close 72h.",""],
          ["Median / 90%","Middle ticket / the time 9 in 10 tickets stay within.","Sorted ticket times.",UI.SRC.calc]] };
    },
    guide: '<div class="hcard"><h3><span class="no">A</span>Two clocks</h3><p><b>First response</b> = time to the first reply. <b>Resolution</b> = time until closed.</p></div>'+
           '<div class="hcard"><h3><span class="no">B</span>Targets</h3><p>High: reply in '+SLA.High.frt+'h, close in '+SLA.High.res+'h. Medium: reply in '+SLA.Medium.frt+'h, close in '+SLA.Medium.res+'h.</p></div>'+
           '<div class="hcard"><h3><span class="no">C</span>Arrows</h3><p>For times, <span class="delta up">&#9650; green</span> means faster or a higher share within target.</p></div>'
  });
})();
