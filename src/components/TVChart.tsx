"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, LineStyle, CrosshairMode,
  CandlestickSeries, LineSeries, HistogramSeries,
} from "lightweight-charts";
import { io, type Socket } from "socket.io-client";
import { RSI, SMA, EMA, BollingerBands, MACD, Stochastic, ATR } from "technicalindicators";
import type { ChartPosition } from "./LWChart";

// ── Types ─────────────────────────────────────────────────────────────────────
type Pt       = { time: number; price: number };
type DrawType = "hline" | "vline" | "trend" | "ray" | "extended" | "fibonacci" | "rect" | "text";
type Drawing  = { id:string; type:DrawType; pts:Pt[]; color:string; width:number; style:"solid"|"dashed"; text?:string; hidden?:boolean };
type CtxMenu  = { x:number; y:number; drawingId:string };
type OhlcInfo = { ts:string; o:number; h:number; l:number; c:number; v:number; up:boolean } | null;

// ── Constants ─────────────────────────────────────────────────────────────────
const TF_LIST = [
  {label:"1m",  sec:60,    period:"1M" },
  {label:"5m",  sec:300,   period:"5M" },
  {label:"15m", sec:900,   period:"15M"},
  {label:"30m", sec:1800,  period:"30M"},
  {label:"1H",  sec:3600,  period:"1H" },
  {label:"4H",  sec:14400, period:"4H" },
  {label:"D",   sec:86400, period:"1D" },
  {label:"W",   sec:604800,period:"1W" },
];
const TF_MAP: Record<string,typeof TF_LIST[number]> = Object.fromEntries(TF_LIST.map(t=>[t.label,t]));
const normTf = (r:string) => ({"1M":"1m","5M":"5m","15M":"15m","30M":"30m","1D":"D","1W":"W"} as Record<string,string>)[r]??r;

const UP="#26a69a", DN="#ef5350", DRAW_COL="#f0b90b";
const FIB_LVLS=[0,0.236,0.382,0.5,0.618,0.786,1];
const FIB_COLS=["#787b86","#f7525f","#ff9800","#4caf50","#2196f3","#9c27b0","#787b86"];
const MUT="#787b86", BLUE="#2962ff";

function uid() { return Math.random().toString(36).slice(2,9); }
function pip(d:number) { return Math.pow(10,-(d-1)); }
function ptLineDist(px:number,py:number, x1:number,y1:number, x2:number,y2:number) {
  const dx=x2-x1,dy=y2-y1, l2=dx*dx+dy*dy;
  if (l2===0) return Math.hypot(px-x1,py-y1);
  const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/l2));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}

// ── Indicator math ────────────────────────────────────────────────────────────
function calcRSI(bars:any[],p=14){
  if(bars.length<p+1)return[];
  const res=RSI.calculate({period:p,values:bars.map((b:any)=>b.close)});
  const off=bars.length-res.length;
  return res.map((v:number,k:number)=>({time:bars[off+k].time,value:+v.toFixed(2)}));
}
function calcMA(bars:any[],p:number,exp:boolean){
  if(bars.length<p)return[];
  const res=(exp?EMA:SMA).calculate({period:p,values:bars.map((b:any)=>b.close)});
  const off=bars.length-res.length;
  return res.map((v:number,k:number)=>({time:bars[off+k].time,value:+v.toFixed(6)}));
}
function calcBB(bars:any[],p=20,std=2){
  if(bars.length<p)return{mid:[],upper:[],lower:[]};
  const res=BollingerBands.calculate({period:p,stdDev:std,values:bars.map((b:any)=>b.close)});
  const off=bars.length-res.length,mid:any[]=[],upper:any[]=[],lower:any[]=[];
  res.forEach((b:any,k:number)=>{const t=bars[off+k].time;mid.push({time:t,value:b.middle});upper.push({time:t,value:b.upper});lower.push({time:t,value:b.lower});});
  return{mid,upper,lower};
}
function calcMACD(bars:any[]){
  if(bars.length<35)return{macd:[],signal:[],hist:[]};
  const res=MACD.calculate({values:bars.map((b:any)=>b.close),fastPeriod:12,slowPeriod:26,signalPeriod:9,SimpleMAOscillator:false,SimpleMASignal:false});
  const off=bars.length-res.length,macd:any[]=[],signal:any[]=[],hist:any[]=[];
  res.forEach((r:any,k:number)=>{
    const t=bars[off+k].time;
    if(r.MACD!=null)macd.push({time:t,value:+r.MACD.toFixed(6)});
    if(r.signal!=null)signal.push({time:t,value:+r.signal.toFixed(6)});
    if(r.histogram!=null)hist.push({time:t,value:+r.histogram.toFixed(6),color:r.histogram>=0?"#26a69a88":"#ef535088"});
  });
  return{macd,signal,hist};
}
function calcStoch(bars:any[],period=14,signal=3){
  if(bars.length<period+signal)return{k:[],d:[]};
  const res=Stochastic.calculate({high:bars.map((b:any)=>b.high),low:bars.map((b:any)=>b.low),close:bars.map((b:any)=>b.close),period,signalPeriod:signal});
  const off=bars.length-res.length,k:any[]=[],d:any[]=[];
  res.forEach((r:any,i:number)=>{const t=bars[off+i].time;if(r.k!=null)k.push({time:t,value:+r.k.toFixed(2)});if(r.d!=null)d.push({time:t,value:+r.d.toFixed(2)});});
  return{k,d};
}
function calcATR(bars:any[],period=14){
  if(bars.length<period)return[];
  const res=ATR.calculate({high:bars.map((b:any)=>b.high),low:bars.map((b:any)=>b.low),close:bars.map((b:any)=>b.close),period});
  const off=bars.length-res.length;
  return res.map((v:number,i:number)=>({time:bars[off+i].time,value:+v.toFixed(6)}));
}

// ── Sub-chart factory ─────────────────────────────────────────────────────────
function makeSubChart(el:HTMLDivElement,dark:boolean){
  return createChart(el,{
    layout:{background:{type:ColorType.Solid,color:dark?"#131722":"#ffffff"},textColor:MUT,fontSize:10,fontFamily:"'Trebuchet MS',system-ui"},
    grid:{vertLines:{color:"transparent"},horzLines:{color:dark?"#1e222d":"#f0f3fa"}},
    rightPriceScale:{borderColor:dark?"#2a2e39":"#d6d8e7",scaleMargins:{top:0.1,bottom:0.1}},
    timeScale:{borderColor:dark?"#2a2e39":"#d6d8e7",timeVisible:false},
    crosshair:{mode:CrosshairMode.Normal,vertLine:{labelVisible:false},horzLine:{labelVisible:false}},
    autoSize:true,
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  symbol:string; tf:string; theme:"dark"|"light";
  digits?:number; positions?:ChartPosition[];
  onSymbolChange?:(s:string)=>void;
  spreadPips?:number; showToolbar?:boolean;
}

export default function TVChart({symbol,tf,theme,digits=5,positions,spreadPips,showToolbar=true}:Props) {

  // ── refs ──────────────────────────────────────────────────────────────────
  const mainWrapRef=useRef<HTMLDivElement>(null);
  const chartRef=useRef<any>(null), serRef=useRef<any>(null), volRef=useRef<any>(null);
  const barsRef=useRef<any[]>([]), sockRef=useRef<Socket|null>(null), lastBarRef=useRef<Record<string,any>>({});
  const askLineRef=useRef<any>(null), bidLineRef=useRef<any>(null), posLinesRef=useRef<any[]>([]);
  // overlay series
  const smaRef=useRef<any>(null),emaRef=useRef<any>(null),bbMRef=useRef<any>(null),bbURef=useRef<any>(null),bbLRef=useRef<any>(null);
  // sub-chart divs
  const macdWrapRef=useRef<HTMLDivElement>(null),rsiWrapRef=useRef<HTMLDivElement>(null);
  const stochWrapRef=useRef<HTMLDivElement>(null),atrWrapRef=useRef<HTMLDivElement>(null);
  // sub-chart instances
  const macdCRef=useRef<any>(null),macdLRef=useRef<any>(null),macdSRef=useRef<any>(null),macdHRef=useRef<any>(null);
  const rsiCRef=useRef<any>(null),rsiSRef=useRef<any>(null);
  const stochCRef=useRef<any>(null),stochKRef=useRef<any>(null),stochDRef=useRef<any>(null);
  const atrCRef=useRef<any>(null),atrSRef=useRef<any>(null);
  // drawing
  const canvasRef=useRef<HTMLCanvasElement>(null), drawingsRef=useRef<Drawing[]>([]), draftRef=useRef<Pt[]>([]), hoveredId=useRef<string|null>(null);

  // ── state ─────────────────────────────────────────────────────────────────
  const [activeTf,  setActiveTf] =useState(()=>normTf(tf));
  const [chartType, setChartType]=useState<"candle"|"bar"|"line"|"area">("candle");
  const [activeTool,setActiveTool]=useState<DrawType|null>(null);
  const [drawings,  setDrawings]  =useState<Drawing[]>([]);
  const [activeInds,setActiveInds]=useState<Set<string>>(new Set());
  const [ohlc,      setOhlc]      =useState<OhlcInfo>(null);
  const [ctxMenu,   setCtxMenu]   =useState<CtxMenu|null>(null);
  const [showInd,   setShowInd]   =useState(false);
  const [showType,  setShowType]  =useState(false);
  const [sideOpen,  setSideOpen]  =useState(true);
  const [loading,   setLoading]   =useState(true);

  // stable refs for closures
  const toolRef=useRef(activeTool); toolRef.current=activeTool;
  const drawRef2=useRef(drawings); drawRef2.current=drawings;
  const digRef=useRef(digits); digRef.current=digits;
  const spRef=useRef(spreadPips??0); spRef.current=spreadPips??0;
  const symRef=useRef(symbol); symRef.current=symbol;
  const themeRef=useRef(theme); themeRef.current=theme;
  const indsRef=useRef(activeInds); indsRef.current=activeInds;

  // ── colours ───────────────────────────────────────────────────────────────
  const dark=theme==="dark";
  const BG=dark?"#131722":"#ffffff", TOPBG=dark?"#1e222d":"#f0f3fa", BDR=dark?"#2a2e39":"#d6d8e7";
  const TXT=dark?"#d1d4dc":"#131722", SIDE=dark?"#1a1e2d":"#f8f9fd";

  // ── canvas redraw ─────────────────────────────────────────────────────────
  const redraw=useCallback(()=>{
    const canvas=canvasRef.current,chart=chartRef.current,ser=serRef.current;
    if(!canvas||!chart||!ser)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const W=canvas.width,H=canvas.height;
    ctx.clearRect(0,0,W,H);
    const tx=(t:number)=>{const v=chart.timeScale().timeToCoordinate(t as any);return v??-9999;};
    const ty=(p:number)=>{const v=ser.priceToCoordinate(p);return v??-9999;};
    const isDark=themeRef.current==="dark";

    for(const d of drawRef2.current){
      if(d.hidden)continue;
      const hot=hoveredId.current===d.id;
      ctx.save();
      ctx.strokeStyle=hot?"#ffffff":d.color; ctx.lineWidth=hot?d.width+1:d.width;
      ctx.setLineDash(d.style==="dashed"?[6,3]:[]); ctx.fillStyle=d.color;
      ctx.font="12px 'Trebuchet MS',system-ui,sans-serif";

      if(d.type==="hline"&&d.pts[0]){
        const y=ty(d.pts[0].price);if(y<-100){ctx.restore();continue;}
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
        ctx.fillStyle=d.color;ctx.fillRect(W-66,y-10,66,20);
        ctx.fillStyle="#fff";ctx.textAlign="right";ctx.textBaseline="middle";
        ctx.fillText(d.pts[0].price.toFixed(digRef.current),W-4,y);

      }else if(d.type==="vline"&&d.pts[0]){
        const x=tx(d.pts[0].time);if(x<-100){ctx.restore();continue;}
        ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();

      }else if((d.type==="trend"||d.type==="ray"||d.type==="extended")&&d.pts.length===2){
        const [x1,y1]=[tx(d.pts[0].time),ty(d.pts[0].price)];
        const [x2,y2]=[tx(d.pts[1].time),ty(d.pts[1].price)];
        if(x1<-100||x2<-100){ctx.restore();continue;}
        const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1,ext=W*5;
        ctx.beginPath();
        if(d.type==="trend"){ ctx.moveTo(x1,y1);ctx.lineTo(x2,y2); }
        else if(d.type==="ray"){ ctx.moveTo(x1,y1);ctx.lineTo(x1+dx/len*ext,y1+dy/len*ext); }
        else{ ctx.moveTo(x1-dx/len*ext,y1-dy/len*ext);ctx.lineTo(x1+dx/len*ext,y1+dy/len*ext); }
        ctx.stroke();
        ctx.beginPath();ctx.arc(x1,y1,4,0,Math.PI*2);ctx.fill();
        if(d.type==="trend"){ ctx.beginPath();ctx.arc(x2,y2,4,0,Math.PI*2);ctx.fill(); }

      }else if(d.type==="fibonacci"&&d.pts.length===2){
        const[p0,p1]=[d.pts[0].price,d.pts[1].price];
        const[x1,x2]=[tx(d.pts[0].time),tx(d.pts[1].time)];
        if(x1<-100||x2<-100){ctx.restore();continue;}
        const xL=Math.min(x1,x2),xR=Math.max(x1,x2);
        FIB_LVLS.forEach((lvl,i)=>{
          const pr=p0+(p1-p0)*(1-lvl),y=ty(pr);if(y<-100||y>H+100)return;
          ctx.strokeStyle=FIB_COLS[i];ctx.lineWidth=1;ctx.setLineDash([4,3]);
          ctx.beginPath();ctx.moveTo(xL,y);ctx.lineTo(xR,y);ctx.stroke();
          ctx.setLineDash([]);ctx.fillStyle=FIB_COLS[i];ctx.textAlign="left";ctx.textBaseline="bottom";
          ctx.fillText(`${(lvl*100).toFixed(1)}%  ${pr.toFixed(digRef.current)}`,xL+4,y-2);
        });

      }else if(d.type==="rect"&&d.pts.length===2){
        const[x1,y1]=[tx(d.pts[0].time),ty(d.pts[0].price)];
        const[x2,y2]=[tx(d.pts[1].time),ty(d.pts[1].price)];
        if(x1<-100||x2<-100){ctx.restore();continue;}
        const rx=Math.min(x1,x2),ry=Math.min(y1,y2),rw=Math.abs(x2-x1),rh=Math.abs(y2-y1);
        ctx.fillStyle=d.color+"22";ctx.fillRect(rx,ry,rw,rh);ctx.strokeRect(rx,ry,rw,rh);

      }else if(d.type==="text"&&d.pts[0]&&d.text){
        const[x,y]=[tx(d.pts[0].time),ty(d.pts[0].price)];
        if(x<-100||y<-100){ctx.restore();continue;}
        const tw=ctx.measureText(d.text).width;
        ctx.fillStyle=isDark?"rgba(30,34,45,0.85)":"rgba(240,243,250,0.85)";
        ctx.fillRect(x,y-16,tw+12,20);ctx.fillStyle=d.color;ctx.textAlign="left";ctx.textBaseline="bottom";
        ctx.fillText(d.text,x+6,y+3);
      }
      ctx.restore();
    }
  },[]);

  // ── exit active tool ───────────────────────────────────────────────────────
  const exitTool=useCallback(()=>{
    setActiveTool(null); draftRef.current=[];
    chartRef.current?.applyOptions({handleScroll:true,handleScale:true});
  },[]);

  // ── enter tool ─────────────────────────────────────────────────────────────
  const enterTool=useCallback((t:DrawType|null)=>{
    setActiveTool(t); draftRef.current=[];
    if(t){ chartRef.current?.applyOptions({handleScroll:false,handleScale:false}); }
    else  { chartRef.current?.applyOptions({handleScroll:true,handleScale:true}); }
  },[]);

  // ── chart init (once — no data loading here) ───────────────────────────────
  useEffect(()=>{
    const el=mainWrapRef.current;if(!el)return;
    const d=themeRef.current==="dark";
    const chart=createChart(el,{
      layout:{background:{type:ColorType.Solid,color:d?"#131722":"#ffffff"},textColor:d?"#d1d4dc":"#131722",fontSize:11,fontFamily:"'Trebuchet MS',system-ui"},
      grid:{vertLines:{color:d?"#1e222d":"#f0f3fa"},horzLines:{color:d?"#1e222d":"#f0f3fa"}},
      rightPriceScale:{borderColor:d?"#2a2e39":"#d6d8e7"},
      timeScale:{borderColor:d?"#2a2e39":"#d6d8e7",timeVisible:true,secondsVisible:false},
      crosshair:{mode:CrosshairMode.Normal,vertLine:{color:d?"#758696":"#9db2bd",labelBackgroundColor:d?"#363a45":"#9db2bd"},horzLine:{color:d?"#758696":"#9db2bd",labelBackgroundColor:d?"#363a45":"#9db2bd"}},
      autoSize:true,
    });
    chartRef.current=chart;
    const ser=chart.addSeries(CandlestickSeries,{upColor:UP,downColor:DN,borderUpColor:UP,borderDownColor:DN,wickUpColor:UP,wickDownColor:DN,priceFormat:{type:"price",precision:digits,minMove:Math.pow(10,-digits)}});
    serRef.current=ser;
    const vol=chart.addSeries(HistogramSeries,{priceFormat:{type:"volume"},priceScaleId:"vol"});
    chart.priceScale("vol").applyOptions({scaleMargins:{top:0.85,bottom:0},borderVisible:false});
    volRef.current=vol;
    askLineRef.current=ser.createPriceLine({price:0,color:UP,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:"Ask"});
    bidLineRef.current=ser.createPriceLine({price:0,color:DN,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:"Bid"});
    // OHLCV legend
    chart.subscribeCrosshairMove((p:any)=>{
      const b=p.seriesData?.get(ser);if(!b){setOhlc(null);return;}
      const dt=new Date((b.time as number)*1000);const z=(n:number)=>String(n).padStart(2,"0");
      setOhlc({ts:`${dt.getUTCFullYear()}-${z(dt.getUTCMonth()+1)}-${z(dt.getUTCDate())} ${z(dt.getUTCHours())}:${z(dt.getUTCMinutes())}`,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume??0,up:b.close>=b.open});
      redraw();
    });
    // Sync sub-chart time range + redraw canvas
    chart.timeScale().subscribeVisibleTimeRangeChange(()=>{
      const r=chart.timeScale().getVisibleRange();if(!r)return;
      macdCRef.current?.timeScale().setVisibleRange(r); rsiCRef.current?.timeScale().setVisibleRange(r);
      stochCRef.current?.timeScale().setVisibleRange(r); atrCRef.current?.timeScale().setVisibleRange(r);
      redraw();
    });
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"){setActiveTool(null);draftRef.current=[];chartRef.current?.applyOptions({handleScroll:true,handleScale:true});}};
    window.addEventListener("keydown",onKey);
    return()=>{ window.removeEventListener("keydown",onKey); try{chart.remove();}catch{}  chartRef.current=null;serRef.current=null;volRef.current=null; };
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  // Sync tf prop → internal activeTf (parent can override)
  useEffect(()=>{ setActiveTf(normTf(tf)); },[tf]);

  // ── data loading — driven by symbol + activeTf state ─────────────────────
  useEffect(()=>{
    if(!symbol) return; // wait until parent provides a real symbol
    let alive=true;
    const lbl=activeTf;
    const info=TF_MAP[lbl]??TF_MAP["1H"];
    sockRef.current?.disconnect();

    // Clear existing data when we have valid series refs
    const chart=chartRef.current,ser=serRef.current,vol=volRef.current;
    if(chart&&ser&&vol){ setOhlc(null); barsRef.current=[]; try{ser.setData([]);}catch{} try{vol.setData([]);}catch{} }
    setLoading(true);

    // Async fetch wrapped in alive guard + full try/catch
    (async()=>{
      try{
        const res=await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${info.period}`,{cache:"no-store"});
        const r=await res.json();
        if(!alive)return;
        if(!r?.ok||!r.candles?.length){ setLoading(false); return; }
        const bars:any[]=r.candles.map((b:any)=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??0}));
        barsRef.current=bars;
        // Use current refs at resolution time (may differ from closure if chart recreated)
        const cs=serRef.current,cv=volRef.current,cc=chartRef.current;
        if(!cs||!cv||!cc||!alive){ setLoading(false); return; }
        try{ cs.setData(bars.map((b:any)=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close}))); }catch{}
        try{ cv.setData(bars.map((b:any)=>({time:b.time,value:b.volume??0,color:b.close>=b.open?"rgba(38,166,154,0.3)":"rgba(239,83,80,0.3)"}))); }catch{}
        lastBarRef.current[symbol+":"+lbl]=bars[bars.length-1];
        try{ cc.timeScale().fitContent(); }catch{}
        applyInds(bars);
        if(alive)setLoading(false);
      }catch{
        if(alive)setLoading(false);
      }
    })();

    const sock=io({path:"/socket.io"});sockRef.current=sock;
    sock.on("tick",(msg:any)=>{
      if(msg.symbol!==symRef.current)return;
      const price=msg.price;if(price==null)return;
      const real=msg.real??price,sec=info.sec,t=Math.floor(Date.now()/1000/sec)*sec;
      const key=symbol+":"+lbl;let lb=lastBarRef.current[key];
      if(lb&&lb.time===t){lb.high=Math.max(lb.high,price,real);lb.low=Math.min(lb.low,price,real);lb.close=price;}
      else{const open=lb?lb.close:price;lb={time:t,open,high:Math.max(open,price,real),low:Math.min(open,price,real),close:price,volume:0};lastBarRef.current[key]=lb;}
      serRef.current?.update({time:lb.time,open:lb.open,high:lb.high,low:lb.low,close:lb.close});
      volRef.current?.update({time:lb.time,value:lb.volume,color:lb.close>=lb.open?"rgba(38,166,154,0.3)":"rgba(239,83,80,0.3)"});
      {const p=pip(digRef.current),ask=price;if(spRef.current>0){const bid=Math.max(0,ask-spRef.current*p);askLineRef.current?.applyOptions({price:ask,title:`Ask ${ask.toFixed(digRef.current)}`});bidLineRef.current?.applyOptions({price:bid,axisLabelVisible:true,title:`Bid ${bid.toFixed(digRef.current)}`});}else{askLineRef.current?.applyOptions({price:ask,title:`Ask ${ask.toFixed(digRef.current)}`});bidLineRef.current?.applyOptions({price:ask,axisLabelVisible:false});}}
    });
    return()=>{ alive=false; sock.disconnect(); };
  },[symbol,activeTf]);// eslint-disable-line react-hooks/exhaustive-deps

  function applyInds(bars:any[]){
    if(smaRef.current)smaRef.current.setData(calcMA(bars,20,false));
    if(emaRef.current)emaRef.current.setData(calcMA(bars,20,true));
    if(bbMRef.current){const{mid,upper,lower}=calcBB(bars);bbMRef.current.setData(mid);bbURef.current?.setData(upper);bbLRef.current?.setData(lower);}
    if(indsRef.current.has("MACD")){const{macd,signal,hist}=calcMACD(bars);macdLRef.current?.setData(macd);macdSRef.current?.setData(signal);macdHRef.current?.setData(hist);}
    if(indsRef.current.has("RSI"))rsiSRef.current?.setData(calcRSI(bars));
    if(indsRef.current.has("STOCH")){const{k,d}=calcStoch(bars);stochKRef.current?.setData(k);stochDRef.current?.setData(d);}
    if(indsRef.current.has("ATR"))atrSRef.current?.setData(calcATR(bars));
  }

  // ── lazy sub-chart creation when indicator is enabled ─────────────────────
  useEffect(()=>{
    const dark2=themeRef.current==="dark",bars=barsRef.current;
    if(activeInds.has("MACD")&&macdWrapRef.current&&!macdCRef.current){
      const mc=makeSubChart(macdWrapRef.current,dark2);macdCRef.current=mc;
      macdLRef.current=mc.addSeries(LineSeries,{color:"#2196f3",lineWidth:1,priceFormat:{type:"price",precision:6,minMove:0.000001}});
      macdSRef.current=mc.addSeries(LineSeries,{color:"#ff9800",lineWidth:1,priceFormat:{type:"price",precision:6,minMove:0.000001}});
      macdHRef.current=mc.addSeries(HistogramSeries,{priceFormat:{type:"price",precision:6,minMove:0.000001}});
      if(bars.length){const{macd,signal,hist}=calcMACD(bars);macdLRef.current.setData(macd);macdSRef.current.setData(signal);macdHRef.current.setData(hist);}
      const r=chartRef.current?.timeScale().getVisibleRange();if(r)mc.timeScale().setVisibleRange(r);
    }
    if(!activeInds.has("MACD")&&macdCRef.current){try{macdCRef.current.remove();}catch{}macdCRef.current=macdLRef.current=macdSRef.current=macdHRef.current=null;}

    if(activeInds.has("RSI")&&rsiWrapRef.current&&!rsiCRef.current){
      const rc=makeSubChart(rsiWrapRef.current,dark2);rsiCRef.current=rc;
      const rs=rc.addSeries(LineSeries,{color:"#9c27b0",lineWidth:1,priceFormat:{type:"price",precision:2,minMove:0.01}});rsiSRef.current=rs;
      rs.createPriceLine({price:70,color:"#ef535055",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false,title:""});
      rs.createPriceLine({price:30,color:"#26a69a55",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false,title:""});
      if(bars.length)rs.setData(calcRSI(bars));
      const r=chartRef.current?.timeScale().getVisibleRange();if(r)rc.timeScale().setVisibleRange(r);
    }
    if(!activeInds.has("RSI")&&rsiCRef.current){try{rsiCRef.current.remove();}catch{}rsiCRef.current=rsiSRef.current=null;}

    if(activeInds.has("STOCH")&&stochWrapRef.current&&!stochCRef.current){
      const sc=makeSubChart(stochWrapRef.current,dark2);stochCRef.current=sc;
      stochKRef.current=sc.addSeries(LineSeries,{color:"#2196f3",lineWidth:1,priceFormat:{type:"price",precision:2,minMove:0.01}});
      stochDRef.current=sc.addSeries(LineSeries,{color:"#ff9800",lineWidth:1,priceFormat:{type:"price",precision:2,minMove:0.01}});
      stochKRef.current.createPriceLine({price:80,color:"#ef535055",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false,title:""});
      stochKRef.current.createPriceLine({price:20,color:"#26a69a55",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false,title:""});
      if(bars.length){const{k,d}=calcStoch(bars);stochKRef.current.setData(k);stochDRef.current.setData(d);}
      const r=chartRef.current?.timeScale().getVisibleRange();if(r)sc.timeScale().setVisibleRange(r);
    }
    if(!activeInds.has("STOCH")&&stochCRef.current){try{stochCRef.current.remove();}catch{}stochCRef.current=stochKRef.current=stochDRef.current=null;}

    if(activeInds.has("ATR")&&atrWrapRef.current&&!atrCRef.current){
      const ac=makeSubChart(atrWrapRef.current,dark2);atrCRef.current=ac;
      atrSRef.current=ac.addSeries(LineSeries,{color:"#00bcd4",lineWidth:1,priceFormat:{type:"price",precision:6,minMove:0.000001}});
      if(bars.length)atrSRef.current.setData(calcATR(bars));
      const r=chartRef.current?.timeScale().getVisibleRange();if(r)ac.timeScale().setVisibleRange(r);
    }
    if(!activeInds.has("ATR")&&atrCRef.current){try{atrCRef.current.remove();}catch{}atrCRef.current=atrSRef.current=null;}
  },[activeInds]);

  // ── theme change ───────────────────────────────────────────────────────────
  useEffect(()=>{
    const d=theme==="dark";
    const base={layout:{background:{type:ColorType.Solid as const,color:d?"#131722":"#ffffff"},textColor:d?"#d1d4dc":"#131722"},grid:{vertLines:{color:d?"#1e222d":"#f0f3fa"},horzLines:{color:d?"#1e222d":"#f0f3fa"}},rightPriceScale:{borderColor:d?"#2a2e39":"#d6d8e7"},timeScale:{borderColor:d?"#2a2e39":"#d6d8e7"},crosshair:{vertLine:{color:d?"#758696":"#9db2bd",labelBackgroundColor:d?"#363a45":"#9db2bd"},horzLine:{color:d?"#758696":"#9db2bd",labelBackgroundColor:d?"#363a45":"#9db2bd"}}};
    chartRef.current?.applyOptions(base);
    const sub={layout:{background:{type:ColorType.Solid as const,color:d?"#131722":"#ffffff"},textColor:MUT},grid:{horzLines:{color:d?"#1e222d":"#f0f3fa"}},rightPriceScale:{borderColor:d?"#2a2e39":"#d6d8e7"}};
    macdCRef.current?.applyOptions(sub);rsiCRef.current?.applyOptions(sub);stochCRef.current?.applyOptions(sub);atrCRef.current?.applyOptions(sub);
    redraw();
  },[theme,redraw]);

  // ── trade overlays ─────────────────────────────────────────────────────────
  useEffect(()=>{
    const ser=serRef.current;if(!ser)return;
    for(const l of posLinesRef.current){try{ser.removePriceLine(l);}catch{}}posLinesRef.current=[];
    const dg=digits;
    for(const o of(positions??[])){
      const col=o.kind?"#9b59b6":o.type==="BUY"?UP:DN;
      const mk=(price:number,c:string,title:string)=>{const l=ser.createPriceLine({price,color:c,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title});posLinesRef.current.push(l);};
      if(o.kind){mk(o.openPrice,"#9b59b6",`${o.type} @ ${o.openPrice.toFixed(dg)}`);}
      else{mk(o.openPrice,col,`${o.type} ${Number(o.lots).toFixed(2)}L @ ${o.openPrice.toFixed(dg)}`);if(o.sl)mk(o.sl,DN,`SL ${o.sl.toFixed(dg)}`);if(o.tp)mk(o.tp,UP,`TP ${o.tp.toFixed(dg)}`);}
    }
  },[positions,digits]);

  // ── overlay indicators toggle ──────────────────────────────────────────────
  const toggleInd=useCallback((name:string)=>{
    const chart=chartRef.current,bars=barsRef.current;if(!chart)return;
    setActiveInds(prev=>{
      const next=new Set(prev);
      if(next.has(name)){
        next.delete(name);
        if(name==="MA"){try{chart.removeSeries(smaRef.current);}catch{}smaRef.current=null;}
        if(name==="EMA"){try{chart.removeSeries(emaRef.current);}catch{}emaRef.current=null;}
        if(name==="BOLL"){[bbMRef,bbURef,bbLRef].forEach(r=>{try{chart.removeSeries(r.current);}catch{}r.current=null;});}
        // Sub-charts (MACD/RSI/STOCH/ATR) destroyed in the activeInds useEffect above
      }else{
        next.add(name);
        if(name==="MA"&&!smaRef.current){const s=chart.addSeries(LineSeries,{color:"#f7a600",lineWidth:1,lastValueVisible:false,priceLineVisible:false});smaRef.current=s;if(bars.length)s.setData(calcMA(bars,20,false));}
        if(name==="EMA"&&!emaRef.current){const s=chart.addSeries(LineSeries,{color:"#2196f3",lineWidth:1,lastValueVisible:false,priceLineVisible:false});emaRef.current=s;if(bars.length)s.setData(calcMA(bars,20,true));}
        if(name==="BOLL"&&!bbMRef.current){
          const bm=chart.addSeries(LineSeries,{color:"#ff9800",lineWidth:1,lastValueVisible:false,priceLineVisible:false});
          const bu=chart.addSeries(LineSeries,{color:"#9c27b0",lineWidth:1,lastValueVisible:false,priceLineVisible:false});
          const bl=chart.addSeries(LineSeries,{color:"#9c27b0",lineWidth:1,lastValueVisible:false,priceLineVisible:false});
          bbMRef.current=bm;bbURef.current=bu;bbLRef.current=bl;
          if(bars.length){const{mid,upper,lower}=calcBB(bars);bm.setData(mid);bu.setData(upper);bl.setData(lower);}
        }
        // Sub-chart inds are handled in the activeInds useEffect
      }
      return next;
    });
  },[]);

  // ── canvas resize ──────────────────────────────────────────────────────────
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ro=new ResizeObserver(()=>{const p=canvas.parentElement;if(!p)return;canvas.width=p.clientWidth;canvas.height=p.clientHeight;redraw();});
    ro.observe(canvas.parentElement!);return()=>ro.disconnect();
  },[redraw]);

  useEffect(()=>{redraw();},[drawings,redraw]);

  // ── drawing helpers ────────────────────────────────────────────────────────
  const addDrawing=useCallback((d:Drawing)=>{drawingsRef.current=[...drawingsRef.current,d];setDrawings([...drawingsRef.current]);},[]);
  const delDrawing=useCallback((id:string)=>{drawingsRef.current=drawingsRef.current.filter(d=>d.id!==id);setDrawings([...drawingsRef.current]);setCtxMenu(null);},[]);
  const clearAll  =useCallback(()=>{drawingsRef.current=[];setDrawings([]);setCtxMenu(null);},[]);
  const toggleHide=useCallback((id:string)=>{drawingsRef.current=drawingsRef.current.map(d=>d.id===id?{...d,hidden:!d.hidden}:d);setDrawings([...drawingsRef.current]);setCtxMenu(null);},[]);

  // ── canvas click (places drawings) ─────────────────────────────────────────
  const onCanvasClick=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const tool=toolRef.current;if(!tool)return;
    const canvas=canvasRef.current,chart=chartRef.current,ser=serRef.current;
    if(!canvas||!chart||!ser)return;
    const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
    const time=chart.timeScale().coordinateToTime(x) as number|null;
    const price=ser.coordinateToPrice(y);
    if(time==null||price==null)return;

    if(tool==="hline"){ addDrawing({id:uid(),type:"hline",pts:[{time,price}],color:DRAW_COL,width:1,style:"solid"}); exitTool(); }
    else if(tool==="vline"){ addDrawing({id:uid(),type:"vline",pts:[{time,price}],color:DRAW_COL,width:1,style:"solid"}); exitTool(); }
    else if(tool==="text"){ const txt=window.prompt("Label text:");if(!txt)return; addDrawing({id:uid(),type:"text",pts:[{time,price}],color:DRAW_COL,width:1,style:"solid",text:txt}); exitTool(); }
    else{
      if(draftRef.current.length===0){ draftRef.current=[{time,price}]; }
      else{ const pts=[draftRef.current[0],{time,price}];draftRef.current=[];addDrawing({id:uid(),type:tool,pts,color:DRAW_COL,width:1,style:"solid"});exitTool(); }
    }
  },[addDrawing,exitTool]);

  // ── canvas hover ───────────────────────────────────────────────────────────
  const onMouseMove=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const canvas=canvasRef.current,chart=chartRef.current,ser=serRef.current;
    if(!canvas||!chart||!ser||toolRef.current)return;
    const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
    const tx=(t:number)=>chart.timeScale().timeToCoordinate(t as any)??0;
    const ty=(p:number)=>ser.priceToCoordinate(p)??0;
    let hit:string|null=null;
    for(const d of drawRef2.current){
      if(d.hidden)continue;
      if(d.type==="hline"&&d.pts[0]){if(Math.abs(my-ty(d.pts[0].price))<6){hit=d.id;break;}}
      else if(d.type==="vline"&&d.pts[0]){if(Math.abs(mx-tx(d.pts[0].time))<6){hit=d.id;break;}}
      else if((d.type==="trend"||d.type==="ray"||d.type==="extended")&&d.pts.length===2){if(ptLineDist(mx,my,tx(d.pts[0].time),ty(d.pts[0].price),tx(d.pts[1].time),ty(d.pts[1].price))<6){hit=d.id;break;}}
      else if(d.type==="rect"&&d.pts.length===2){const[x1,y1,x2,y2]=[tx(d.pts[0].time),ty(d.pts[0].price),tx(d.pts[1].time),ty(d.pts[1].price)];if(mx>=Math.min(x1,x2)-6&&mx<=Math.max(x1,x2)+6&&my>=Math.min(y1,y2)-6&&my<=Math.max(y1,y2)+6){hit=d.id;break;}}
    }
    if(hoveredId.current!==hit){hoveredId.current=hit;redraw();canvas.style.cursor=hit?"pointer":"default";}
  },[redraw]);

  const onCtxMenu=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    if(!hoveredId.current)return;e.preventDefault();
    setCtxMenu({x:e.clientX,y:e.clientY,drawingId:hoveredId.current});
  },[]);

  // ── chart type ─────────────────────────────────────────────────────────────
  const changeType=useCallback((t:"candle"|"bar"|"line"|"area")=>{setChartType(t);setShowType(false);},[]);

  // ── tool definitions ───────────────────────────────────────────────────────
  const TOOLS:[DrawType,string,React.ReactNode][]=[
    ["hline",    "Horizontal Line", <SvgHLine/>],
    ["vline",    "Vertical Line",   <SvgVLine/>],
    ["trend",    "Trend Line",      <SvgTrend/>],
    ["ray",      "Ray",             <SvgRay/>],
    ["extended", "Extended Line",   <SvgExtended/>],
    ["fibonacci","Fibonacci",       <SvgFib/>],
    ["rect",     "Rectangle",       <SvgRect/>],
    ["text",     "Text",            <SvgText/>],
  ];
  const IND_LIST=[
    {name:"MA",   label:"MA (20)",              sub:false},
    {name:"EMA",  label:"EMA (20)",             sub:false},
    {name:"BOLL", label:"Bollinger Bands",       sub:false},
    {name:"MACD", label:"MACD (12,26,9)",        sub:true},
    {name:"RSI",  label:"RSI (14)",             sub:true},
    {name:"STOCH",label:"Stochastic (14,3)",    sub:true},
    {name:"ATR",  label:"ATR (14)",             sub:true},
  ];

  // ── render ─────────────────────────────────────────────────────────────────
  return(
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",background:TOPBG,overflow:"hidden",fontFamily:"'Trebuchet MS',system-ui,sans-serif"}}>

      {/* TOP TOOLBAR */}
      {showToolbar&&(
        <div style={{display:"flex",alignItems:"center",height:38,background:TOPBG,borderBottom:`1px solid ${BDR}`,flexShrink:0}}>
          <TB38 title="Toggle sidebar" onClick={()=>setSideOpen(p=>!p)} active={sideOpen}><SvgMenu/></TB38>
          <VDiv bdr={BDR}/>

          {/* Symbol badge */}
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 10px",borderRight:`1px solid ${BDR}`,height:"100%",flexShrink:0}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:BLUE,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff"}}>{symbol.charAt(0)}</div>
            <span style={{fontSize:13,fontWeight:700,color:TXT}}>{symbol}</span>
          </div>

          {/* Chart type */}
          <Dropdown open={showType} onToggle={()=>{setShowType(p=>!p);setShowInd(false);}} label={<><SvgCandleIcon/><SvgChev/></>} bdr={BDR} mut={MUT} active={showType}>
            {(["candle","bar","line","area"] as const).map(t=>(
              <DItem key={t} active={chartType===t} onClick={()=>changeType(t)} txt={TXT}>{t==="candle"?"Candles":t==="bar"?"Bars":t==="line"?"Line":"Area"}</DItem>
            ))}
          </Dropdown>

          {/* Timeframes */}
          <div style={{display:"flex",alignItems:"center",height:"100%",borderRight:`1px solid ${BDR}`,flexShrink:0,overflowX:"auto",scrollbarWidth:"none"}}>
            {TF_LIST.map(t=>(
              <button key={t.label} onClick={()=>setActiveTf(t.label)}
                style={{padding:"0 8px",height:"100%",fontSize:12,fontWeight:600,cursor:"pointer",border:"none",whiteSpace:"nowrap",background:activeTf===t.label?"rgba(41,98,255,0.12)":"transparent",color:activeTf===t.label?BLUE:MUT,borderBottom:activeTf===t.label?`2px solid ${BLUE}`:"2px solid transparent"}}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Indicators */}
          <Dropdown open={showInd} onToggle={()=>{setShowInd(p=>!p);setShowType(false);}} label={<><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="1,10 4,5 7,8 10,3 13,6"/></svg><span style={{fontSize:12,fontWeight:500}}>Indicators</span><SvgChev/></>} bdr={BDR} mut={MUT} active={showInd} minW={250}>
            <div style={{fontSize:10,fontWeight:700,color:MUT,textTransform:"uppercase",letterSpacing:1,padding:"4px 8px 4px"}}>OVERLAY</div>
            {IND_LIST.filter(i=>!i.sub).map(i=><IndRow key={i.name} label={i.label} active={activeInds.has(i.name)} onClick={()=>toggleInd(i.name)} txt={TXT} bdr={BDR}/>)}
            <div style={{height:1,background:BDR,margin:"4px 0"}}/>
            <div style={{fontSize:10,fontWeight:700,color:MUT,textTransform:"uppercase",letterSpacing:1,padding:"4px 8px 4px"}}>SUB-CHART</div>
            {IND_LIST.filter(i=>i.sub).map(i=><IndRow key={i.name} label={i.label} active={activeInds.has(i.name)} onClick={()=>toggleInd(i.name)} txt={TXT} bdr={BDR}/>)}
          </Dropdown>

          {/* Right buttons */}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",height:"100%"}}>
            <TBBtn label="Screenshot" bdr={BDR} mut={MUT} onClick={()=>{try{const url=chartRef.current?.takeScreenshot?.()?.toDataURL?.("image/png");if(url){const a=document.createElement("a");a.href=url;a.download=`chart-${symbol}.png`;a.click();}}catch{}}}><SvgCamera/></TBBtn>
            <TBBtn label="" bdr={BDR} mut={MUT} onClick={()=>{try{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();}catch{}}}><SvgFullscreen/></TBBtn>
          </div>
        </div>
      )}

      {/* BODY */}
      <div style={{display:"flex",flex:1,minHeight:0,overflow:"hidden"}}>

        {/* LEFT SIDEBAR */}
        {showToolbar&&sideOpen&&(
          <div style={{width:40,display:"flex",flexDirection:"column",alignItems:"center",paddingTop:6,paddingBottom:6,gap:2,background:SIDE,borderRight:`1px solid ${BDR}`,flexShrink:0,overflowY:"auto",scrollbarWidth:"none"}}>
            <SBtn title="Pointer (Esc)" active={!activeTool} mut={MUT} dark={dark} onClick={()=>enterTool(null)}>
              <SvgPointer/>
            </SBtn>
            <SDiv bdr={BDR}/>
            {TOOLS.map(([type,label,icon])=>(
              <SBtn key={type} title={label} active={activeTool===type} mut={MUT} dark={dark} onClick={()=>enterTool(activeTool===type?null:type)}>
                <span style={{width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{icon}</span>
              </SBtn>
            ))}
            <SDiv bdr={BDR}/>
            <SBtn title="Hide / show all drawings" active={false} mut={MUT} dark={dark} onClick={()=>{drawingsRef.current=drawingsRef.current.map(d=>({...d,hidden:!d.hidden}));setDrawings([...drawingsRef.current]);}}><SvgHide/></SBtn>
            <SBtn title="Clear all drawings" active={false} mut="#ef5350" dark={dark} onClick={clearAll}><SvgTrash/></SBtn>
          </div>
        )}

        {/* CHART COLUMN */}
        <div style={{display:"flex",flexDirection:"column",flex:1,minWidth:0,minHeight:0,overflow:"hidden"}}>

          {/* Main pane */}
          <div style={{position:"relative",flex:1,minHeight:0,overflow:"hidden",background:BG}}>
            <div ref={mainWrapRef} style={{position:"absolute",inset:0}}/>

            {/* Drawing canvas — pointer-events controlled by activeTool */}
            <canvas
              ref={canvasRef}
              onClick={onCanvasClick}
              onMouseMove={onMouseMove}
              onContextMenu={onCtxMenu}
              style={{position:"absolute",inset:0,zIndex:5,pointerEvents:activeTool?"all":"none",cursor:activeTool?"crosshair":"default"}}
            />

            {/* Loading overlay */}
            {loading&&(
              <div style={{position:"absolute",inset:0,zIndex:20,display:"flex",alignItems:"center",justifyContent:"center",background:BG,flexDirection:"column",gap:12}}>
                <div style={{width:32,height:32,border:`3px solid ${BLUE}33`,borderTop:`3px solid ${BLUE}`,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
                <span style={{fontSize:12,color:MUT}}>Loading chart…</span>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            )}

            {/* OHLCV legend */}
            {!loading&&ohlc&&(
              <div style={{position:"absolute",top:6,left:8,zIndex:10,display:"flex",alignItems:"baseline",gap:7,fontSize:11,pointerEvents:"none",flexWrap:"wrap"}}>
                <span style={{color:MUT,fontSize:10}}>{ohlc.ts}</span>
                {(["O","H","L","C"] as const).map((l,i)=>{
                  const v=[ohlc.o,ohlc.h,ohlc.l,ohlc.c][i];
                  return <span key={l} style={{color:ohlc.up?UP:DN}}><span style={{opacity:0.55,marginRight:2,fontSize:10}}>{l}</span>{v.toFixed(digits)}</span>;
                })}
                <span style={{color:MUT,fontSize:10}}><span style={{opacity:0.55,marginRight:2}}>V</span>{ohlc.v>=1000?`${(ohlc.v/1000).toFixed(1)}K`:ohlc.v.toFixed(0)}</span>
              </div>
            )}

            {/* Active tool hint */}
            {activeTool&&(
              <div style={{position:"absolute",bottom:10,left:"50%",transform:"translateX(-50%)",zIndex:10,pointerEvents:"none",background:BLUE,color:"#fff",fontSize:11,fontWeight:600,padding:"4px 16px",borderRadius:14,boxShadow:"0 2px 12px rgba(41,98,255,0.45)",whiteSpace:"nowrap"}}>
                {TOOLS.find(t=>t[0]===activeTool)?.[1]} · {draftRef.current.length===0?"Click first point":"Click second point"} · Esc to cancel
              </div>
            )}
          </div>

          {/* Sub-chart panes — always rendered so refs are available */}
          {activeInds.has("MACD")&&(
            <div style={{flexShrink:0,borderTop:`1px solid ${BDR}`,background:BG,position:"relative"}}>
              <SubLabel label="MACD (12,26,9)" mut={MUT}/>
              <div ref={macdWrapRef} style={{height:90}}/>
            </div>
          )}
          {activeInds.has("RSI")&&(
            <div style={{flexShrink:0,borderTop:`1px solid ${BDR}`,background:BG,position:"relative"}}>
              <SubLabel label="RSI (14)" mut={MUT}/>
              <div ref={rsiWrapRef} style={{height:80}}/>
            </div>
          )}
          {activeInds.has("STOCH")&&(
            <div style={{flexShrink:0,borderTop:`1px solid ${BDR}`,background:BG,position:"relative"}}>
              <SubLabel label="Stoch (14,3)" mut={MUT}/>
              <div ref={stochWrapRef} style={{height:80}}/>
            </div>
          )}
          {activeInds.has("ATR")&&(
            <div style={{flexShrink:0,borderTop:`1px solid ${BDR}`,background:BG,position:"relative"}}>
              <SubLabel label="ATR (14)" mut={MUT}/>
              <div ref={atrWrapRef} style={{height:80}}/>
            </div>
          )}

          <div style={{height:20,background:TOPBG,borderTop:`1px solid ${BDR}`,flexShrink:0}}/>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu&&(
        <>
          <div style={{position:"fixed",inset:0,zIndex:199}} onClick={()=>setCtxMenu(null)}/>
          <div style={{position:"fixed",left:ctxMenu.x,top:ctxMenu.y,zIndex:200,background:BG,border:`1px solid ${BDR}`,borderRadius:6,padding:4,minWidth:170,boxShadow:"0 8px 24px rgba(0,0,0,0.3)"}}>
            <CMItem label="Delete" color="#ef5350" onClick={()=>delDrawing(ctxMenu.drawingId)}/>
            <CMItem label="Hide / Show" color={TXT} onClick={()=>toggleHide(ctxMenu.drawingId)}/>
            <CMItem label="Cancel" color={MUT} onClick={()=>setCtxMenu(null)}/>
          </div>
        </>
      )}
    </div>
  );
}

// ── Micro components ──────────────────────────────────────────────────────────
function SBtn({title,active,mut,dark,onClick,children}:{title:string;active:boolean;mut:string;dark:boolean;onClick:()=>void;children:React.ReactNode}){
  return <button title={title} onClick={onClick} style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:5,border:"none",cursor:"pointer",color:active?BLUE:mut,background:active?(dark?"rgba(41,98,255,0.15)":"rgba(41,98,255,0.1)"):"transparent",flexShrink:0}}>{children}</button>;
}
function SDiv({bdr}:{bdr:string}){return <div style={{width:24,height:1,background:bdr,margin:"3px 0",flexShrink:0}}/>;}
function VDiv({bdr}:{bdr:string}){return <div style={{width:1,height:20,background:bdr,margin:"0 2px",flexShrink:0}}/>;}
function TB38({title,onClick,active,children}:{title:string;onClick:()=>void;active:boolean;children:React.ReactNode}){
  return <button title={title} onClick={onClick} style={{width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",border:"none",background:"transparent",color:active?BLUE:MUT,cursor:"pointer",flexShrink:0}}>{children}</button>;
}
function TBBtn({label,onClick,bdr,mut,children}:{label:string;onClick:()=>void;bdr:string;mut:string;children:React.ReactNode}){
  return <button onClick={onClick} style={{display:"flex",alignItems:"center",gap:5,padding:"0 10px",height:"100%",border:"none",cursor:"pointer",fontSize:11,background:"transparent",color:mut,borderLeft:`1px solid ${bdr}`,whiteSpace:"nowrap"}}>{children}{label&&<span>{label}</span>}</button>;
}
function CMItem({label,color,onClick}:{label:string;color:string;onClick:()=>void}){
  return <button onClick={onClick} style={{display:"block",width:"100%",padding:"7px 12px",border:"none",cursor:"pointer",borderRadius:4,fontSize:12,background:"transparent",color,textAlign:"left"}}>{label}</button>;
}
function SubLabel({label,mut}:{label:string;mut:string}){
  return <div style={{position:"absolute",top:3,left:8,fontSize:10,fontWeight:700,color:mut,zIndex:1,pointerEvents:"none"}}>{label}</div>;
}
function IndRow({label,active,onClick,txt,bdr}:{label:string;active:boolean;onClick:()=>void;txt:string;bdr:string}){
  return <button onClick={onClick} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"6px 8px",borderRadius:4,border:"none",cursor:"pointer",fontSize:12,background:active?"rgba(41,98,255,0.1)":"transparent",color:active?BLUE:txt}}>
    <span style={{width:14,height:14,borderRadius:3,flexShrink:0,border:`1.5px solid ${active?BLUE:bdr}`,background:active?BLUE:"transparent",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
      {active&&<svg width="8" height="8" viewBox="0 0 8 8"><polyline points="1,4 3,6 7,2" strokeWidth="1.8" stroke="#fff" fill="none"/></svg>}
    </span>{label}
  </button>;
}
function Dropdown({open,onToggle,label,bdr,mut,active,children,minW=160}:{open:boolean;onToggle:()=>void;label:React.ReactNode;bdr:string;mut:string;active:boolean;children:React.ReactNode;minW?:number}){
  return <div style={{position:"relative",height:"100%",flexShrink:0}}>
    <button onClick={onToggle} style={{display:"flex",alignItems:"center",gap:5,padding:"0 10px",height:"100%",border:"none",cursor:"pointer",fontSize:12,background:active?"rgba(41,98,255,0.1)":"transparent",color:active?BLUE:mut,borderRight:`1px solid ${bdr}`}}>{label}</button>
    {open&&<>
      <div style={{position:"fixed",inset:0,zIndex:98}} onClick={onToggle}/>
      <div style={{position:"absolute",top:"100%",left:0,marginTop:2,zIndex:99,background:"var(--chart-bg,#fff)",border:`1px solid ${bdr}`,borderRadius:6,padding:4,minWidth:minW,boxShadow:"0 8px 24px rgba(0,0,0,0.2)"}}>{children}</div>
    </>}
  </div>;
}
function DItem({active,onClick,children,txt}:{active:boolean;onClick:()=>void;children:React.ReactNode;txt:string}){
  return <button onClick={onClick} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 10px",border:"none",cursor:"pointer",borderRadius:4,fontSize:12,background:active?"rgba(41,98,255,0.1)":"transparent",color:active?BLUE:txt}}>
    {active&&<svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1,5 4,8 9,2" stroke={BLUE} strokeWidth="1.8" fill="none"/></svg>}{children}
  </button>;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const i=(content:React.ReactNode)=><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16">{content}</svg>;
function SvgMenu()     {return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><rect y="2.5" width="16" height="1.8" rx="0.9"/><rect y="7.1" width="16" height="1.8" rx="0.9"/><rect y="11.7" width="16" height="1.8" rx="0.9"/></svg>;}
function SvgPointer()  {return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2L13 7.5l-5 1.2-2 5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>;}
function SvgHLine()    {return i(<><line x1="1" y1="9" x2="17" y2="9"/><circle cx="1" cy="9" r="1.8" fill="currentColor"/><circle cx="17" cy="9" r="1.8" fill="currentColor"/></>);}
function SvgVLine()    {return i(<><line x1="9" y1="1" x2="9" y2="17"/><circle cx="9" cy="1" r="1.8" fill="currentColor"/><circle cx="9" cy="17" r="1.8" fill="currentColor"/></>);}
function SvgTrend()    {return i(<><line x1="2" y1="16" x2="16" y2="2"/><circle cx="2" cy="16" r="1.8" fill="currentColor"/><circle cx="16" cy="2" r="1.8" fill="currentColor"/></>);}
function SvgRay()      {return i(<><line x1="2" y1="16" x2="16" y2="2"/><circle cx="2" cy="16" r="1.8" fill="currentColor"/><polyline points="12,2 16,2 16,6" strokeWidth="1.5"/></>);}
function SvgExtended() {return i(<><line x1="2" y1="14" x2="16" y2="4"/><circle cx="9" cy="9" r="1.8" fill="currentColor"/><polyline points="2,14 1,16" strokeWidth="1.2"/><polyline points="16,4 17,2" strokeWidth="1.2"/></>);}
function SvgFib()      {return i(<><line x1="2" y1="4" x2="16" y2="4"/><line x1="2" y1="8" x2="16" y2="8"/><line x1="2" y1="12" x2="16" y2="12"/><line x1="2" y1="16" x2="16" y2="16"/></>);}
function SvgRect()     {return i(<rect x="2" y="4" width="14" height="10" rx="1"/>);}
function SvgText()     {return <svg viewBox="0 0 18 18" fill="currentColor" width="16" height="16"><text x="3" y="14" fontSize="13" fontWeight="700" fontFamily="serif">T</text></svg>;}
function SvgHide()     {return i(<><path d="M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="9" cy="9" r="2.2"/><line x1="2" y1="16" x2="16" y2="2"/></>);}
function SvgTrash()    {return <svg viewBox="0 0 16 16" fill="none" stroke="#ef5350" strokeWidth="1.4" width="14" height="14"><polyline points="3,4 13,4"/><path d="M5.5 4V3h5v1M5 4l.8 9h4.4L11 4"/></svg>;}
function SvgCamera()   {return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="3" width="12" height="9" rx="1.5"/><circle cx="7" cy="7.5" r="2.2"/><path d="M5 3l.8-1.5h2.4L9 3"/></svg>;}
function SvgFullscreen(){return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>;}
function SvgCandleIcon(){return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><line x1="3" y1="1.5" x2="3" y2="12.5"/><rect x="1" y="4" width="4" height="5" fill="currentColor" stroke="none"/><line x1="10" y1="1.5" x2="10" y2="12.5"/><rect x="8" y="3" width="4" height="6" fill="currentColor" stroke="none"/></svg>;}
function SvgChev()     {return <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{opacity:0.6}}><path d="M1 2l3 3 3-3z"/></svg>;}
