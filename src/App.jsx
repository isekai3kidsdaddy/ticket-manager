import { useState, useEffect, useMemo, useRef } from "react";
import { SUPABASE_READY, loadFromSupabase, saveToSupabase } from "./supabaseClient";

// ─── All unique buyer names from existing data ───
const KNOWN_BUYERS = [
  "威哥","151","ABBY","JJ","關關","萬姊","萬陽","小菲","小薄荷","老墨ERIC","Jermey","工程師","黃品傑",
  "andy liu","謝佳文","toby","阿文","wendy期天","陳族元","關關朋友","Kelly","LUCY","多喊",
  "鄭宇庭chasel","網友sandy","恩媽","偉仁","米米","際暄Jimmy","叡","老黃他爸","摩爾",
  "黛西","羊叔","王者","佳文姊","吳宗桂","凱特","鄧哥","熊仔",
].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b, "zh-TW"));

// ─── Status config ───
const BUYER_STATUS = {
  normal: { label: "正常", color: "#5a7a5a", bg: "#e8f0e8", icon: "✓" },
  unpaid: { label: "未付款", color: "#8b3a3a", bg: "#fce8e8", icon: "$" },
  picked: { label: "已取票", color: "#2d6a8b", bg: "#e0eef6", icon: "🎫" },
  refund: { label: "待退費", color: "#8b6a2d", bg: "#f6f0e0", icon: "↩" },
  refunded: { label: "已退款", color: "#4a6b4a", bg: "#dfeadf", icon: "✅" },
};

// Inline detail editor for picked/refund
function DetailEditor({ buyer, onSave, onCancel, mode }) {
  const [detail, setDetail] = useState(mode === "picked" ? (buyer.pickedDetail || "") : (buyer.refundAmt || ""));
  const label = mode === "picked" ? "取票明細" : "退費金額";
  const placeholder = mode === "picked" ? "例：2張6880、2張5880" : "例：2000";
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center", marginTop:6, width:"100%" }} onClick={e=>e.stopPropagation()}>
      <span style={{ fontSize:12, fontWeight:600, color:"#888", whiteSpace:"nowrap" }}>{label}：</span>
      <input
        autoFocus
        value={detail}
        onChange={e=>setDetail(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter") onSave(detail); if(e.key==="Escape") onCancel(); }}
        placeholder={placeholder}
        style={{ flex:1, padding:"6px 10px", borderRadius:7, border:"1.5px solid #d4d0c8", fontSize:13, fontFamily:"inherit", background:"#fff", minWidth:0 }}
      />
      <button onClick={()=>onSave(detail)} style={{ padding:"5px 12px", borderRadius:7, border:"none", background:"#2d2a26", color:"#faf9f6", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>確認</button>
      <button onClick={onCancel} style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #d4d0c8", background:"#fff", fontSize:12, cursor:"pointer", fontFamily:"inherit", color:"#999" }}>取消</button>
    </div>
  );
}

// ─── Buyer helpers: batches-based structure ───
// A buyer now has `batches: [{qty, st, detail}]`. The old single-status fields are auto-migrated.
function getBatches(b) {
  if (Array.isArray(b.batches) && b.batches.length > 0) return b.batches;
  // Migrate from old structure
  let detail = "";
  if (b.st === "picked" && b.pickedDetail) detail = b.pickedDetail;
  else if ((b.st === "refund" || b.st === "refunded") && b.refundAmt) detail = b.refundAmt;
  return [{ qty: b.qty, st: b.st || "normal", detail }];
}
function buyerTotalQty(b) { return getBatches(b).reduce((s, x) => s + (x.qty || 0), 0); }
function buyerHasStatus(b, st) { return getBatches(b).some(x => x.st === st); }
function buyerPrimaryStatus(b) {
  const bs = getBatches(b);
  // Priority: unpaid > refund > picked > refunded > normal
  const order = ["unpaid", "refund", "picked", "refunded", "normal"];
  for (const st of order) { if (bs.some(x => x.st === st)) return st; }
  return "normal";
}
function countStatusQty(buyers, st) {
  return (buyers || []).reduce((s, b) => s + getBatches(b).filter(x => x.st === st).reduce((a, x) => a + x.qty, 0), 0);
}
function countStatusBatches(buyers, st) {
  return (buyers || []).reduce((s, b) => s + getBatches(b).filter(x => x.st === st).length, 0);
}

// 場次中「需X但還沒收X」的人數
function countPendingFlag(buyers, needFlag, gotFlag) {
  return (buyers || []).filter(b => b[needFlag] && !b[gotFlag]).length;
}

// Inline editor for creating/editing a single batch (qty + status + detail)
function BatchEditor({ initialQty, initialSt, initialDetail, maxQty, onSave, onCancel, canEditQty = true }) {
  const [qty, setQty] = useState(initialQty || 1);
  const [st, setSt] = useState(initialSt || "normal");
  const [detail, setDetail] = useState(initialDetail || "");
  const showDetail = st === "picked" || st === "refund" || st === "refunded";
  const label = st === "picked" ? "取票明細" : (st === "refund" || st === "refunded") ? "退費金額" : "";
  const ph = st === "picked" ? "例：2張6880、2張5880" : (st === "refund" || st === "refunded") ? "例：2000" : "";
  return (
    <div onClick={e=>e.stopPropagation()} style={{ marginTop:6, padding:"10px 12px", borderRadius:8, border:"1.5px dashed #c4b89a", background:"#fff9ec", display:"flex", flexDirection:"column", gap:8 }}>
      {canEditQty && (
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:600, color:"#888" }}>張數：</span>
          <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:26,height:26,borderRadius:6,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontWeight:700 }}>−</button>
          <span style={{ fontWeight:700, minWidth:24, textAlign:"center" }}>{qty}</span>
          <button onClick={()=>setQty(q=>Math.min(maxQty||999,q+1))} style={{ width:26,height:26,borderRadius:6,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontWeight:700 }}>+</button>
          {maxQty && <span style={{ fontSize:11, color:"#999" }}>剩餘 {maxQty} 張可分配</span>}
        </div>
      )}
      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
        {Object.entries(BUYER_STATUS).map(([key,cfg])=>(
          <button key={key} onClick={()=>setSt(key)} style={{ padding:"4px 10px",borderRadius:14,border:`1.5px solid ${st===key?cfg.color:"#e4e0d8"}`,background:st===key?cfg.bg:"#fff",color:cfg.color,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>{cfg.icon} {cfg.label}</button>
        ))}
      </div>
      {showDetail && (
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:12, fontWeight:600, color:"#888", whiteSpace:"nowrap" }}>{label}：</span>
          <input autoFocus value={detail} onChange={e=>setDetail(e.target.value)} placeholder={ph}
            onKeyDown={e=>{ if(e.key==="Enter") onSave({qty,st,detail}); if(e.key==="Escape") onCancel(); }}
            style={{ flex:1, padding:"6px 10px", borderRadius:7, border:"1.5px solid #d4d0c8", fontSize:13, fontFamily:"inherit", background:"#fff", minWidth:0 }}/>
        </div>
      )}
      <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
        <button onClick={onCancel} style={{ padding:"5px 12px", borderRadius:7, border:"1px solid #d4d0c8", background:"#fff", fontSize:12, cursor:"pointer", fontFamily:"inherit", color:"#999" }}>取消</button>
        <button onClick={()=>onSave({qty,st,detail})} style={{ padding:"5px 14px", borderRadius:7, border:"none", background:"#2d2a26", color:"#faf9f6", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>確認</button>
      </div>
    </div>
  );
}

// ─── Initial data from Excel ───
const INITIAL_EVENTS = [
  { id:"e1", name:"Big bang首場", price:"預收8000", status:"active", buyers:[
    {name:"威哥",qty:10,st:"normal"},{name:"151",qty:7,st:"normal"},{name:"ABBY",qty:2,st:"normal"},{name:"JJ",qty:2,st:"normal"},
    {name:"關關",qty:2,st:"unpaid"},{name:"萬姊",qty:8,st:"normal"},{name:"小菲",qty:8,st:"normal"},
    {name:"小薄荷",qty:2,st:"normal"},{name:"老墨ERIC",qty:4,st:"normal"},{name:"Jermey",qty:4,st:"normal"},
    {name:"工程師",qty:2,st:"normal"},{name:"黃品傑",qty:2,st:"normal"}
  ]},
  { id:"e2", name:"Big bang返場", price:"預收8000", status:"active", buyers:[
    {name:"andy liu",qty:2,st:"normal"},{name:"謝佳文",qty:2,st:"normal"},{name:"toby",qty:20,st:"normal"},{name:"威哥",qty:2,st:"normal"},
    {name:"阿文",qty:6,st:"normal"},{name:"wendy期天",qty:2,st:"normal"},{name:"Jermey",qty:20,st:"normal"},
    {name:"陳族元",qty:8,st:"normal"},{name:"關關朋友",qty:4,st:"normal"},{name:"關關",qty:1,st:"unpaid"}
  ]},
  { id:"e3", name:"GD2026個人", price:"", status:"active", buyers:[
    {name:"Jermey",qty:6,st:"normal"},{name:"威哥",qty:2,st:"normal"},{name:"陳族元",qty:2,st:"normal"},
    {name:"關關朋友",qty:2,st:"normal"},{name:"關關",qty:1,st:"unpaid"}
  ]},
  { id:"e4", name:"GD見面會", price:"預收6000", status:"active", note:"多2", buyers:[
    {name:"關關",qty:6,st:"normal",note:"2人4張全勤"},{name:"威哥",qty:2,st:"normal"},{name:"工程師",qty:2,st:"normal"},
    {name:"toby",qty:4,st:"normal"},{name:"多喊",qty:2,st:"normal"},{name:"Kelly",qty:2,st:"normal"}
  ]},
  { id:"e5", name:"BTS大隊", price:"預收8000", status:"active", buyers:[
    {name:"151",qty:18,st:"normal",note:"4人全勤"},{name:"萬姊",qty:14,st:"normal"},{name:"LUCY",qty:12,st:"normal"},
    {name:"小菲",qty:4,st:"normal"},{name:"阿文",qty:6,st:"normal"},{name:"toby",qty:26,st:"normal"},{name:"關關",qty:4,st:"normal"}
  ]},
  { id:"e6", name:"BTS返場", price:"預收8000", status:"active", buyers:[
    {name:"151",qty:8,st:"normal"},{name:"小菲",qty:6,st:"normal"},{name:"toby",qty:2,st:"normal"},
    {name:"關關朋友",qty:4,st:"normal"},{name:"Jermey",qty:2,st:"normal"}
  ]},
  { id:"e7", name:"BTS田征國", price:"預收6000", status:"active", buyers:[{name:"151",qty:2,st:"normal"}]},
  { id:"e8", name:"aespa", price:"6880", status:"active", buyers:[
    {name:"小菲",qty:4,st:"normal"},{name:"151",qty:2,st:"normal"},{name:"萬姊",qty:2,st:"normal"},
    {name:"工程師",qty:4,st:"normal"},{name:"阿文",qty:2,st:"normal",note:"洋蔥"},{name:"toby",qty:4,st:"normal"}
  ]},
  { id:"e9", name:"BP大巨蛋", price:"8800", status:"active", buyers:[
    {name:"151",qty:8,st:"normal"},{name:"ABBY",qty:2,st:"normal"},{name:"工程師",qty:2,st:"normal"},{name:"小菲",qty:2,st:"normal"},
    {name:"關關",qty:1,st:"unpaid"},{name:"andy liu",qty:2,st:"normal"},{name:"toby",qty:18,st:"normal"},
    {name:"wendy期天",qty:4,st:"normal"},{name:"阿文",qty:4,st:"normal"},{name:"萬姊",qty:1,st:"normal"},
    {name:"Jermey",qty:4,st:"normal"},{name:"Kelly",qty:2,st:"normal"}
  ]},
  { id:"e10", name:"17大隊", price:"預收6000", status:"active", buyers:[
    {name:"萬姊",qty:6,st:"normal",note:"全勤"},{name:"老墨ERIC",qty:2,st:"normal"},{name:"網友sandy",qty:2,st:"normal"}
  ]},
  { id:"e11", name:"17小分隊CxM", price:"預收6000", status:"active", buyers:[
    {name:"151",qty:4,st:"normal",note:"2人全勤"},{name:"萬姊",qty:7,st:"normal",note:"2張全勤"},{name:"恩媽",qty:2,st:"normal"},
    {name:"鄭宇庭chasel",qty:2,st:"normal"},{name:"網友sandy",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"}
  ]},
  { id:"e12", name:"17小分隊 DxS", price:"預收6000", status:"active", buyers:[
    {name:"萬姊",qty:8,st:"normal",note:"6張全勤"},{name:"151",qty:4,st:"normal"}
  ]},
  { id:"e13", name:"Stray Kids", price:"預收6000", status:"active", buyers:[
    {name:"小薄荷",qty:5,st:"normal"},{name:"關關",qty:1,st:"unpaid"},{name:"關關",qty:2,st:"normal"},
    {name:"151",qty:2,st:"normal"},{name:"Jermey",qty:2,st:"normal"}
  ]},
  { id:"e14", name:"Yoasobi大巨蛋", price:"預收6000", status:"active", buyers:[{name:"阿文",qty:4,st:"normal"}]},
  { id:"e15", name:"I-dle返場", price:"預收6000", status:"active", buyers:[
    {name:"阿文",qty:4,st:"normal"},{name:"偉仁",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"}
  ]},
  { id:"e16", name:"IU", price:"預收6000", status:"active", buyers:[
    {name:"小菲",qty:4,st:"normal"},{name:"阿文",qty:2,st:"normal"},{name:"Jermey",qty:8,st:"normal"},{name:"151",qty:1,st:"normal"},
    {name:"關關",qty:3,st:"normal"},{name:"叡",qty:3,st:"normal"},{name:"陳族元",qty:2,st:"normal"},{name:"關關朋友",qty:2,st:"normal"}
  ]},
  { id:"e17", name:"劉德華", price:"7080", status:"active", buyers:[
    {name:"威哥",qty:2,st:"normal"},{name:"阿文",qty:4,st:"normal"},{name:"米米",qty:2,st:"normal"},{name:"際暄Jimmy",qty:4,st:"normal"}
  ]},
  { id:"e18", name:"New jeans", price:"預收6000", status:"active", buyers:[{name:"小菲",qty:2,st:"normal"}]},
  { id:"e19", name:"蔡依林返場", price:"7190", status:"active", buyers:[
    {name:"老墨ERIC",qty:2,st:"normal"},{name:"鄭宇庭chasel",qty:2,st:"normal"},{name:"toby",qty:6,st:"normal"},
    {name:"叡",qty:2,st:"normal"},{name:"Kelly",qty:4,st:"normal"},{name:"阿文",qty:4,st:"normal"},
    {name:"151",qty:4,st:"normal"},{name:"陳族元",qty:4,st:"normal"}
  ]},
  { id:"e20", name:"五百", price:"4200", status:"active", buyers:[
    {name:"威哥",qty:2,st:"normal"},{name:"關關",qty:2,st:"unpaid"},{name:"阿文",qty:6,st:"normal"},{name:"老黃他爸",qty:2,st:"normal"}
  ]},
  { id:"e21", name:"周杰倫首場", price:"6880", status:"active", buyers:[
    {name:"151",qty:12,st:"normal"},{name:"阿文",qty:8,st:"normal"},{name:"威哥",qty:6,st:"normal"},{name:"JJ",qty:2,st:"normal"},
    {name:"際暄Jimmy",qty:2,st:"normal"},{name:"ABBY",qty:2,st:"normal"},{name:"Jermey",qty:12,st:"normal"},{name:"叡",qty:2,st:"normal"},
    {name:"羊叔",qty:6,st:"normal"},{name:"toby",qty:8,st:"normal"},{name:"關關",qty:4,st:"normal"},{name:"Kelly",qty:8,st:"normal"},
    {name:"摩爾",qty:2,st:"normal"},{name:"偉仁",qty:2,st:"normal"},{name:"王者",qty:2,st:"normal"},{name:"黃品傑",qty:2,st:"normal"}
  ]},
  { id:"e22", name:"周杰倫返場", price:"6880", status:"active", buyers:[
    {name:"工程師",qty:2,st:"normal"},{name:"關關",qty:8,st:"normal"},{name:"toby",qty:12,st:"normal"},{name:"Kelly",qty:10,st:"normal"},
    {name:"Jermey",qty:26,st:"normal"},{name:"阿文",qty:4,st:"normal"},{name:"黛西",qty:6,st:"normal"},{name:"陳族元",qty:18,st:"normal"}
  ]},
  { id:"e23", name:"SJ大巨蛋返場", price:"6880", status:"active", buyers:[{name:"萬姊",qty:8,st:"normal",note:"6張全勤"}]},
  { id:"e24", name:"SJ D&E(台北)", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:6,st:"normal",note:"張全勤"}]},
  { id:"e25", name:"李東海", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:10,st:"normal",note:"2人4場全勤"}]},
  { id:"e26", name:"TXT", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:4,st:"normal"}]},
  { id:"e27", name:"CORTIS", price:"預收6000", status:"active", buyers:[
    {name:"萬姊",qty:4,st:"normal"},{name:"小菲",qty:4,st:"normal"},{name:"關關",qty:2,st:"unpaid"},
    {name:"工程師",qty:2,st:"normal"},{name:"wendy期天",qty:4,st:"normal"},{name:"Jermey",qty:10,st:"normal"},
    {name:"151",qty:2,st:"normal"},{name:"toby",qty:10,st:"normal"}
  ]},
  { id:"e28", name:"泰勒絲", price:"預收6000", status:"active", buyers:[
    {name:"老墨ERIC",qty:2,st:"normal"},{name:"Jermey",qty:5,st:"normal"},{name:"wendy期天",qty:3,st:"normal"},{name:"toby",qty:12,st:"normal"}
  ]},
  { id:"e29", name:"少女時代", price:"預收6000", status:"active", buyers:[{name:"工程師",qty:2,st:"normal"},{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e30", name:"MAMAMOO", price:"預收6000", status:"active", buyers:[{name:"關關",qty:2,st:"unpaid"},{name:"wendy期天",qty:2,st:"normal"}]},
  { id:"e31", name:"孫燕姿", price:"6380", status:"active", buyers:[
    {name:"萬姊",qty:6,st:"normal"},{name:"摩爾",qty:2,st:"normal"},{name:"Jermey",qty:16,st:"normal"},{name:"LUCY",qty:4,st:"normal"}
  ]},
  { id:"e32", name:"寶怪 2026", price:"預收6000", status:"active", buyers:[
    {name:"阿文",qty:4,st:"normal"},{name:"toby",qty:2,st:"normal"},{name:"Jermey",qty:6,st:"normal"}
  ]},
  { id:"e33", name:"張韶涵", price:"預收6000", status:"active", buyers:[{name:"Kelly",qty:2,st:"normal"}]},
  { id:"e34", name:"SHE", price:"預收6000", status:"active", note:"多2", buyers:[
    {name:"關關",qty:6,st:"normal"},{name:"阿文",qty:6,st:"normal"},{name:"小薄荷",qty:4,st:"normal"},
    {name:"toby",qty:4,st:"normal"},{name:"叡",qty:4,st:"normal"}
  ]},
  { id:"e35", name:"TWS台北", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  { id:"e36", name:"夏奇拉", price:"預收6000", status:"active", buyers:[{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e37", name:"火星人布魯諾", price:"預收6000", status:"active", buyers:[{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e38", name:"bp rose", price:"預收6000", status:"active", buyers:[{name:"151",qty:2,st:"normal"}]},
  { id:"e39", name:"JJ林俊傑", price:"預收6000", status:"active", buyers:[{name:"摩爾",qty:2,st:"normal"}]},
  { id:"e40", name:"張學友2026", price:"預收6000", status:"active", buyers:[{name:"摩爾",qty:2,st:"normal"}]},
  { id:"e41", name:"AAA2026", price:"預收6000", status:"active", buyers:[
    {name:"151",qty:4,st:"normal"},{name:"wendy期天",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"},
    {name:"偉仁",qty:2,st:"normal"},{name:"關關",qty:2,st:"unpaid"},{name:"陳族元",qty:2,st:"normal"}
  ]},
  { id:"e42", name:"Le sserafim", price:"預收6000", status:"active", buyers:[{name:"151",qty:2,st:"normal"}]},
  { id:"e43", name:"EXO台北", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  { id:"e44", name:"濱崎步高雄", price:"預收6000", status:"active", buyers:[
    {name:"toby",qty:4,st:"normal"},{name:"阿文",qty:4,st:"normal",note:"2人2天全勤"}
  ]},
  { id:"e45", name:"TWICE安可台北", price:"預收6000", status:"active", buyers:[{name:"我",qty:4,st:"normal"}]},
  { id:"e46", name:"DAY6高雄", price:"預收6000", status:"active", buyers:[{name:"關關",qty:1,st:"normal"}]},
  { id:"e47", name:"IVE", price:"預收6000", status:"active", buyers:[{name:"151",qty:1,st:"normal"}]},
  { id:"e48", name:"馬龍", price:"預收6000", status:"active", buyers:[
    {name:"Jermey",qty:10,st:"normal"},{name:"151",qty:4,st:"normal"},{name:"小菲",qty:6,st:"normal"}
  ]},
  { id:"e49", name:"二AM", price:"預收6000", status:"active", buyers:[{name:"老墨ERIC",qty:2,st:"normal"}]},
  { id:"e50", name:"LADYGAGA", price:"預收6000", status:"active", buyers:[{name:"小薄荷",qty:4,st:"normal"}]},
  { id:"e51", name:"BP個人Jennie", price:"預收6000", status:"active", buyers:[{name:"toby",qty:2,st:"normal"}]},
  { id:"e52", name:"告五人", price:"預收6000", status:"active", buyers:[{name:"陳族元",qty:4,st:"normal"},{name:"Jermey",qty:2,st:"normal"}]},
  { id:"e53", name:"SJ83", price:"預收6000", status:"active", buyers:[{name:"關關朋友",qty:2,st:"normal"}]},
  { id:"e54", name:"SJ新小隊", price:"預收6000", status:"active", buyers:[{name:"關關朋友",qty:2,st:"normal"}]},
  { id:"e55", name:"Back number", price:"預收6000", status:"active", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  // ── Completed ──
  { id:"c1", name:"GD 返場", price:"8980", status:"done", note:"需退費 佳姐2000*2", buyers:[
    {name:"佳文姊",qty:2,st:"normal"},{name:"小菲",qty:2,st:"normal"}
  ]},
  { id:"c2", name:"蔡依林2025年底大巨蛋", price:"6990", status:"done", note:"需退費妞退1000*2 威哥退1000*2 關關先退2000*2 佳文退1000*2", buyers:[
    {name:"萬姊",qty:4,st:"normal",note:"30*2/1*2"},{name:"151",qty:2,st:"normal",note:"1/1"},{name:"威哥",qty:2,st:"normal",note:"30"},
    {name:"謝佳文",qty:2,st:"normal"},{name:"關關",qty:2,st:"normal",note:"31"},{name:"偉仁",qty:4,st:"normal",note:"31"},{name:"吳宗桂",qty:2,st:"normal",note:"31"}
  ]},
  { id:"c3", name:"SJ大隊台北六日", price:"6880", status:"done", note:"退款完成", buyers:[{name:"萬姊",qty:4,st:"normal"}]},
  { id:"c4", name:"台北五加場", price:"6880", status:"done", buyers:[{name:"工程師",qty:4,st:"normal"}]},
  { id:"c5", name:"BP高雄", price:"8800", status:"done", buyers:[{name:"萬姊",qty:2,st:"normal"}]},
  { id:"c6", name:"AAA", price:"$5980*6/$3588*4", status:"done", note:"需退費小薄荷6200", buyers:[
    {name:"151",qty:8,st:"normal"},{name:"小薄荷",qty:2,st:"normal",note:"退票"}
  ]},
  { id:"c7", name:"Babymonster大巨蛋", price:"6500", status:"done", buyers:[
    {name:"阿文",qty:2,st:"normal"},{name:"關關",qty:2,st:"normal",note:"4800"}
  ]},
  { id:"c8", name:"17小隊豪雨分隊", price:"6880", status:"done", buyers:[{name:"萬姊",qty:4,st:"normal"}]},
  { id:"c9", name:"Twice2025高雄", price:"8800", status:"done", buyers:[
    {name:"威哥",qty:1,st:"normal"},{name:"151",qty:2,st:"normal"},{name:"小薄荷",qty:2,st:"normal"},
    {name:"萬姊",qty:9,st:"normal"},{name:"凱特",qty:2,st:"normal",note:"加場"}
  ]},
  { id:"c10", name:"SJ高雄", price:"6680", status:"done", buyers:[
    {name:"工程師",qty:2,st:"normal"},{name:"威哥",qty:2,st:"normal"},{name:"老墨ERIC",qty:2,st:"normal"},{name:"toby",qty:2,st:"normal"}
  ]},
  { id:"c11", name:"金唱片", price:"8980", status:"done", buyers:[{name:"151",qty:2,st:"normal"},{name:"萬姊",qty:6,st:"normal"}]},
  { id:"c12", name:"鄧紫棋(2026/4月)", price:"6880+200理想國", status:"done",
    note:"退費 偉仁2000 KELLY2000 阿文4000 TOBY2000 小薄荷2000 1512000 LUCY2000", buyers:[
    {name:"偉仁",qty:2,st:"normal",note:"5880"},{name:"Kelly",qty:2,st:"normal",note:"5880"},
    {name:"阿文",qty:8,st:"normal",note:"6880+5880"},{name:"關關",qty:2,st:"normal",note:"6880"},
    {name:"toby",qty:2,st:"normal",note:"5880"},{name:"小薄荷",qty:2,st:"normal",note:"5880"},
    {name:"Jermey",qty:8,st:"normal",note:"6880"},{name:"151",qty:2,st:"normal",note:"5880"},{name:"LUCY",qty:2,st:"normal",note:"5880"}
  ]},
  { id:"c13", name:"3/13高雄櫻花祭", price:"", status:"done", buyers:[
    {name:"151",qty:2,st:"normal"}
  ]},
  { id:"c14", name:"DAY6", price:"預收6000", status:"done", buyers:[
    {name:"萬姊",qty:2,st:"normal"}
  ]},
  { id:"c15", name:"I-dle", price:"", status:"done", buyers:[
    {name:"151",qty:1,st:"normal"},{name:"鄧哥",qty:4,st:"normal"},{name:"萬姊",qty:2,st:"normal"},
    {name:"Jermey",qty:7,st:"normal"},{name:"佳文姊",qty:2,st:"normal"}
  ]},
  { id:"c16", name:"TWICE大巨蛋(2026/3月)", price:"5800", status:"done", note:"二刷$24000未退", buyers:[
    {name:"萬陽",qty:4,st:"normal"}
  ]},
  { id:"c17", name:"蔡健雅2026", price:"", status:"done", note:"需退151 600*2（完成）", buyers:[
    {name:"151",qty:2,st:"normal"},{name:"鄭宇庭chasel",qty:2,st:"normal"}
  ]},
  { id:"c18", name:"林志傑引退賽", price:"4012", status:"done", note:"退費3000*2", buyers:[
    {name:"工程師",qty:2,st:"normal"}
  ]},
];

function gid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Canvas helper: rounded rectangle path
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Custom modals (confirm/prompt don't work in this env)
function ConfirmModal({ msg, onYes, onNo }) {
  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onNo}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:16,padding:"24px",width:"100%",maxWidth:360,boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <div style={{ fontSize:15, marginBottom:20, lineHeight:1.6, whiteSpace:"pre-line" }}>{msg}</div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onNo} style={{ padding:"8px 20px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:14,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>取消</button>
          <button onClick={onYes} style={{ padding:"8px 20px",borderRadius:8,border:"none",background:"#2d2a26",color:"#faf9f6",fontSize:14,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>確定</button>
        </div>
      </div>
    </div>
  );
}

function InputModal({ title, label, defaultValue, onSave, onCancel, placeholder }) {
  const [val, setVal] = useState(defaultValue || "");
  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:16,padding:"24px",width:"100%",maxWidth:400,boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <h3 style={{ margin:"0 0 16px", fontSize:17, fontWeight:700 }}>{title}</h3>
        {label && <div style={{ fontSize:13, fontWeight:600, color:"#555", marginBottom:6 }}>{label}</div>}
        <input autoFocus value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")onSave(val);if(e.key==="Escape")onCancel();}}
          placeholder={placeholder||""} style={{ width:"100%",padding:"10px 14px",borderRadius:10,border:"1.5px solid #d4d0c8",fontSize:15,fontFamily:"inherit",boxSizing:"border-box",marginBottom:16 }}/>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onCancel} style={{ padding:"8px 20px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:14,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>取消</button>
          <button onClick={()=>onSave(val)} style={{ padding:"8px 20px",borderRadius:8,border:"none",background:"#2d2a26",color:"#faf9f6",fontSize:14,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>確定</button>
        </div>
      </div>
    </div>
  );
}

function IdentityExportModal({ events, title, onClose }) {
  const [mode, setMode] = useState("text"); // text | sheet | csv
  const [copied, setCopied] = useState(false);

  // 收集所有實名資料 [{eventName, buyerName, identity}]
  const rows = [];
  (events || []).forEach(evt => {
    (evt.buyers || []).forEach(b => {
      (b.identities || []).forEach(it => {
        rows.push({ eventName: evt.name, buyerName: b.name, ...it });
      });
    });
  });
  const totalIdentities = rows.length;

  const loginLabel = (v) => v === "facebook" ? "FB" : v === "google" ? "Google" : "";

  // 文字格式（給 LINE 看的，分場次分人）
  const textOutput = (() => {
    const lines = [];
    (events || []).forEach(evt => {
      const evtRows = (evt.buyers || []).flatMap(b =>
        (b.identities || []).map(it => ({ buyerName: b.name, ...it }))
      );
      if (evtRows.length === 0) return;
      lines.push(`📌 ${evt.name}（${evtRows.length} 筆）`);
      let lastBuyer = "";
      evtRows.forEach(r => {
        if (r.buyerName !== lastBuyer) { lines.push(`【${r.buyerName}】`); lastBuyer = r.buyerName; }
        const parts = [];
        parts.push(`姓名:${r.name||"(未填)"}`);
        parts.push(`拿 ${r.qty||1} 張`);
        if (r.phone) parts.push(`電話:${r.phone}`);
        if (r.idNumber) parts.push(`身分證:${r.idNumber}`);
        if (r.tixAccount) parts.push(`拓元:${r.tixAccount}`);
        const login = loginLabel(r.loginVia);
        if (login) parts.push(`登入:${login}`);
        if (r.locked) parts.push(`🔒帳號鎖`);
        if (r.memberNo) parts.push(`會員#:${r.memberNo}`);
        lines.push("  " + parts.join(" / "));
      });
      lines.push("");
    });
    return lines.join("\n").trim();
  })();

  // Excel/Sheet 格式（tab 分隔）
  const headers = ["場次","訂購人","姓名","拿幾張","電話","身分證","拓元帳號","登入方式","帳號被鎖","會員編號"];
  const sheetOutput = (() => {
    const lines = [headers.join("\t")];
    rows.forEach(r => {
      lines.push([r.eventName, r.buyerName, r.name||"", r.qty||1, r.phone||"", r.idNumber||"", r.tixAccount||"", loginLabel(r.loginVia), r.locked?"是":"", r.memberNo||""].join("\t"));
    });
    return lines.join("\n");
  })();

  // CSV
  const csvOutput = (() => {
    const escape = v => `"${String(v||"").replace(/"/g,'""')}"`;
    const lines = [headers.map(escape).join(",")];
    rows.forEach(r => {
      lines.push([r.eventName, r.buyerName, r.name||"", r.qty||1, r.phone||"", r.idNumber||"", r.tixAccount||"", loginLabel(r.loginVia), r.locked?"是":"", r.memberNo||""].map(escape).join(","));
    });
    return lines.join("\n");
  })();

  const currentOutput = mode === "text" ? textOutput : mode === "sheet" ? sheetOutput : csvOutput;

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentOutput);
      setCopied(true);
      setTimeout(()=>setCopied(false), 2000);
    } catch (err) {
      // Fallback: select all
      alert("複製失敗，請手動全選複製");
    }
  };

  const doDownload = () => {
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvOutput], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0,10);
    a.download = `實名資料_${title.replace(/[\\/:*?"<>|]/g,"_")}_${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:16,padding:"20px 22px",width:"100%",maxWidth:640,maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:12 }}>
          <h3 style={{ margin:0, fontSize:17, fontWeight:700 }}>📋 實名資料輸出</h3>
          <span style={{ fontSize:12, color:"#888" }}>{title} · 共 {totalIdentities} 筆</span>
        </div>

        {totalIdentities === 0 ? (
          <div style={{ padding:"40px 20px",textAlign:"center",color:"#999",fontSize:14 }}>沒有實名資料可以輸出</div>
        ) : (
          <>
            <div style={{ display:"flex",gap:4,marginBottom:10,padding:3,background:"#f0ede8",borderRadius:8 }}>
              {[
                { key:"text", label:"📱 LINE 文字" },
                { key:"sheet", label:"📊 Excel/Sheet" },
                { key:"csv", label:"📄 CSV 下載" },
              ].map(t => (
                <button key={t.key} onClick={()=>setMode(t.key)} style={{ flex:1,padding:"8px 12px",borderRadius:6,border:"none",background:mode===t.key?"#fff":"transparent",fontSize:12,fontWeight:700,cursor:"pointer",color:mode===t.key?"#2d2a26":"#888",fontFamily:"inherit",boxShadow:mode===t.key?"0 1px 3px rgba(0,0,0,.1)":"none" }}>{t.label}</button>
              ))}
            </div>

            <div style={{ fontSize:11, color:"#888", marginBottom:6 }}>
              {mode==="text" && "適合貼到 LINE。按複製後直接到對話框長按貼上。"}
              {mode==="sheet" && "適合貼到 Excel / Google Sheet。按複製後到表格任一格 Ctrl+V，會自動分欄。"}
              {mode==="csv" && "下載 CSV 檔（含 BOM，Excel 開不會亂碼），給場館或拓元上傳用。"}
            </div>

            <textarea readOnly value={currentOutput} style={{ flex:1,minHeight:220,padding:"10px 12px",borderRadius:8,border:"1px solid #e4e0d8",fontSize:12,fontFamily:"ui-monospace, monospace",background:"#faf9f6",resize:"vertical",lineHeight:1.5 }}/>

            <div style={{ display:"flex",gap:8,marginTop:12,justifyContent:"flex-end" }}>
              <button onClick={onClose} style={{ padding:"8px 18px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:13,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>關閉</button>
              {mode==="csv" ? (
                <button onClick={doDownload} style={{ padding:"8px 22px",borderRadius:8,border:"none",background:"#2d2a26",color:"#faf9f6",fontSize:13,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>💾 下載 CSV</button>
              ) : (
                <button onClick={doCopy} style={{ padding:"8px 22px",borderRadius:8,border:"none",background:copied?"#3a7a3a":"#2d2a26",color:"#faf9f6",fontSize:13,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>{copied?"✓ 已複製":"📋 複製"}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [events, setEvents] = useState(() => { try { const s = window.localStorage?.getItem?.("tkm-v3"); if (s) return JSON.parse(s); } catch {} return INITIAL_EVENTS; });
  const [buyerNames, setBuyerNames] = useState(() => { try { const s = window.localStorage?.getItem?.("tkm-v3-names"); if (s) return JSON.parse(s); } catch {} return KNOWN_BUYERS; });
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [editingDetail, setEditingDetail] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState(() => { try { const s = window.localStorage?.getItem?.("tkm-v3-logs"); if (s) return JSON.parse(s); } catch {} return []; });
  const [confirmModal, setConfirmModal] = useState(null);
  const [inputModal, setInputModal] = useState(null);
  const [identityExportModal, setIdentityExportModal] = useState(null); // { events:[evt], title }
  const [editingPrice, setEditingPrice] = useState(null);
  const [priceVal, setPriceVal] = useState("");
  const [editingName, setEditingName] = useState(null);
  const [nameVal, setNameVal] = useState("");
  const [addingBatch, setAddingBatch] = useState(null);  // {eventId, idx}
  const [editingBatch, setEditingBatch] = useState(null); // {eventId, idx, bi}
  const [expandedIdentity, setExpandedIdentity] = useState(null); // identity key
  const [timelineFilter, setTimelineFilter] = useState(null); // null = 全部, 否則為 kind 名稱
  const fileInputRef = useRef(null);

  const addLog = (msg, snapshot) => setLogs(prev => [{ id: Date.now(), time: Date.now(), msg, snapshot }, ...prev].slice(0, 500));
  const snap = () => JSON.parse(JSON.stringify(events));

  // Sync status: 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'offline'
  const [syncStatus, setSyncStatus] = useState(SUPABASE_READY ? "loading" : "offline");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const lastSyncedAtRef = useRef(null); // 給 async callback 用，避免閉包過期
  const initialLoadDone = useRef(false);
  const saveTimer = useRef(null);

  // 1) On mount: load from Supabase
  useEffect(() => {
    if (!SUPABASE_READY) { initialLoadDone.current = true; return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await loadFromSupabase();
        if (cancelled) return;
        if (res && res.payload) {
          const p = res.payload;
          if (Array.isArray(p.events)) setEvents(p.events);
          if (Array.isArray(p.buyerNames)) setBuyerNames(p.buyerNames);
          if (Array.isArray(p.logs)) setLogs(p.logs);
          setLastSyncedAt(res.updatedAt);
          lastSyncedAtRef.current = res.updatedAt;
        }
        setSyncStatus("saved");
      } catch (e) {
        console.warn("Initial load failed:", e);
        setSyncStatus("error");
      } finally {
        initialLoadDone.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 2) On change: save to localStorage immediately + debounced safe-save to Supabase
  useEffect(() => {
    try {
      window.localStorage?.setItem?.("tkm-v3", JSON.stringify(events));
      window.localStorage?.setItem?.("tkm-v3-names", JSON.stringify(buyerNames));
      window.localStorage?.setItem?.("tkm-v3-logs", JSON.stringify(logs));
    } catch {}

    if (!SUPABASE_READY || !initialLoadDone.current) return;
    setSyncStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await saveToSupabase({ events, buyerNames, logs }, lastSyncedAtRef.current);
      if (res.ok) {
        setSyncStatus("saved");
        setLastSyncedAt(res.updatedAt);
        lastSyncedAtRef.current = res.updatedAt;
      } else if (res.reason === "stale" && res.remote && res.remote.payload) {
        // 雲端有更新的版本(其他裝置改的)，不要覆蓋。改成拉新版下來
        const p = res.remote.payload;
        if (Array.isArray(p.events)) setEvents(p.events);
        if (Array.isArray(p.buyerNames)) setBuyerNames(p.buyerNames);
        if (Array.isArray(p.logs)) setLogs(p.logs);
        setLastSyncedAt(res.remote.updatedAt);
        lastSyncedAtRef.current = res.remote.updatedAt;
        setSyncStatus("saved");
        setConfirmModal({ msg: "偵測到其他裝置剛剛改了資料,已自動拉最新版下來,避免覆蓋。\n\n你剛才如果在編輯,請重新確認你的修改是否還在。", onYes: () => setConfirmModal(null) });
      } else {
        setSyncStatus("error");
      }
    }, 800);
  }, [events, buyerNames, logs]);

  // 3) Manual refetch
  const refetchFromCloud = async () => {
    if (!SUPABASE_READY) return;
    setSyncStatus("loading");
    try {
      const res = await loadFromSupabase();
      if (res && res.payload) {
        const p = res.payload;
        if (Array.isArray(p.events)) setEvents(p.events);
        if (Array.isArray(p.buyerNames)) setBuyerNames(p.buyerNames);
        if (Array.isArray(p.logs)) setLogs(p.logs);
        setLastSyncedAt(res.updatedAt);
        lastSyncedAtRef.current = res.updatedAt;
      }
      setSyncStatus("saved");
    } catch {
      setSyncStatus("error");
    }
  };

  // 4) 頁面回到前景時自動重新拉雲端,防止用過期的本機版本覆蓋
  useEffect(() => {
    if (!SUPABASE_READY) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && initialLoadDone.current) {
        refetchFromCloud();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const activeEvents = events.filter(e => e.status === "active");
  const pickedEvents = events.filter(e => e.status === "picked");
  const doneEvents = events.filter(e => e.status === "done");
  const displayEvents = tab === "active" ? activeEvents : tab === "picked" ? pickedEvents : doneEvents;
  const filtered = displayEvents.filter(e => { if (!search) return true; const s = search.toLowerCase(); return e.name.toLowerCase().includes(s) || e.buyers?.some(b => b.name.toLowerCase().includes(s)); });
  const totalTickets = activeEvents.reduce((s, e) => s + (e.buyers || []).reduce((a, b) => a + buyerTotalQty(b), 0), 0);
  const unpaidCount = activeEvents.reduce((s, e) => s + countStatusBatches(e.buyers, "unpaid"), 0);
  const pickedRefundCount = pickedEvents.reduce((s, e) => s + countStatusBatches(e.buyers, "refund"), 0);
  const getEventName = (id) => events.find(e => e.id === id)?.name || "?";

  // Aggregate buyers across all events (for 訂購人 tab)
  const buyersAggregated = useMemo(() => {
    const map = new Map();
    events.forEach(evt => {
      (evt.buyers || []).forEach(b => {
        if (!map.has(b.name)) map.set(b.name, { name: b.name, orders: [], totalQty: 0, unpaidQty: 0, refundCount: 0, refundedCount: 0, pickedQty: 0 });
        const entry = map.get(b.name);
        const bs = getBatches(b);
        entry.orders.push({ eventId: evt.id, eventName: evt.name, eventStatus: evt.status, eventPrice: evt.price, qty: buyerTotalQty(b), batches: bs, note: b.note, addedAt: b.addedAt });
        bs.forEach(x => {
          entry.totalQty += x.qty;
          if (x.st === "unpaid") entry.unpaidQty += x.qty;
          if (x.st === "refund") entry.refundCount += 1;
          if (x.st === "refunded") entry.refundedCount += 1;
          if (x.st === "picked") entry.pickedQty += x.qty;
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [events]);

  // Timeline data: group by date → by buyer (for 時間軸 tab)
  const timelineData = useMemo(() => {
    // 從 logs 撈所有異動，解析動作類型 + 對應的場次（讓「前往」按鈕能用）
    const parseLog = (log) => {
      const msg = log.msg || "";
      // 比對【場次名】開頭
      const m = msg.match(/^【(.+?)】(.*)$/);
      let eventName = null, rest = msg;
      if (m) { eventName = m[1]; rest = m[2]; }
      // 找對應 evt（用名稱比對，因為事後場次可能改名，但這是盡力而為）
      const evt = eventName ? events.find(e => e.name === eventName) : null;

      // 動作類型判斷（影響圖示和顏色）
      let kind = "other", icon = "•", color = "#999";
      if (/^新增「/.test(rest))             { kind = "add";    icon = "➕"; color = "#3a7a3a"; }
      else if (/^移除「/.test(rest))        { kind = "remove"; icon = "✖";  color = "#c47070"; }
      else if (/張數/.test(rest))           { kind = "qty";    icon = "🔢"; color = "#4a7aab"; }
      else if (/狀態/.test(rest) || /待退費|已退款|已取票|未付款/.test(rest)) { kind = "status"; icon = "🏷"; color = "#a87830"; }
      else if (/實名|SID|給票|回傳照|帳號鎖/.test(rest)) { kind = "flag"; icon = "📝"; color = "#7a5a8b"; }
      else if (/票價/.test(rest))           { kind = "price";  icon = "💰"; color = "#3a8a7a"; }
      else if (/分批/.test(rest))           { kind = "batch";  icon = "📦"; color = "#5a7aab"; }
      else if (/改名/.test(msg))            { kind = "rename"; icon = "✎";  color = "#888"; }
      else if (/匯入備份/.test(msg))        { kind = "import"; icon = "📥"; color = "#aa7030"; }
      else if (/還原/.test(msg))            { kind = "revert"; icon = "⟲";  color = "#aa7030"; }

      return { ...log, eventName, eventId: evt?.id, eventStatus: evt?.status, restMsg: rest, kind, icon, color };
    };

    const entries = (logs || []).map(parseLog);

    // 按日期分組
    const byDate = new Map();
    entries.forEach(e => {
      const d = new Date(e.time);
      const dateKey = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push(e);
    });
    return Array.from(byDate.entries()).map(([date, items]) => ({ date, items }));
  }, [logs, events]);

  // Jump from buyers/timeline view to the event card in the appropriate tab
  const jumpToEvent = (eventId, eventStatus) => {
    setTab(eventStatus || "active");
    setExpandedId(eventId);
    setSearch("");
    setShowLog(false);
    setTimeout(() => {
      const el = document.getElementById(`evt-${eventId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  const updateEvent = (id, fn) => setEvents(evs => evs.map(e => e.id === id ? fn({ ...e, buyers: [...(e.buyers || [])] }) : e));

  const addBuyerToEvent = (eventId, name) => {
    addLog(`【${getEventName(eventId)}】新增「${name}」`, snap());
    if (!buyerNames.includes(name)) setBuyerNames(ns => [...ns, name].sort((a, b) => a.localeCompare(b, "zh-TW")));
    updateEvent(eventId, e => { e.buyers.push({ name, qty: 1, addedAt: Date.now(), batches: [{ qty: 1, st: "normal", detail: "" }] }); return e; });
  };

  const updateBuyer = (eventId, idx, updates) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (b) {
      const parts = [];
      if (updates.note !== undefined && updates.note !== b.note) parts.push("備註更新");
      if (parts.length > 0) addLog(`【${evt.name}】${b.name}：${parts.join("、")}`, snap());
    }
    updateEvent(eventId, e => { e.buyers[idx] = { ...e.buyers[idx], ...updates }; return e; });
  };

  // Toggle 各種勾選；勾掉「需要/前提」時自動清掉相關「完成」狀態
  const toggleBuyerFlag = (eventId, idx, flag) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (!b) return;
    const labels = { needRealName:"需實名", gotRealName:"已收實名", needSid:"需SID", gotSid:"已收SID", ticketDelivered:"已給票", photoReceived:"已收回傳照" };
    const next = !b[flag];
    addLog(`【${evt.name}】${b.name}:${labels[flag]} ${next?"✅":"取消"}`, snap());
    updateEvent(eventId, e => {
      const nb = { ...e.buyers[idx], [flag]: next };
      if (flag === "needRealName" && !next) nb.gotRealName = false;
      if (flag === "needSid" && !next) nb.gotSid = false;
      if (flag === "ticketDelivered" && !next) nb.photoReceived = false;
      if (flag === "gotRealName" && next) nb.needRealName = true;
      if (flag === "gotSid" && next) nb.needSid = true;
      if (flag === "photoReceived" && next) nb.ticketDelivered = true;
      e.buyers[idx] = nb; return e;
    });
  };

  // 實名資料 CRUD（一個訂購人可有多筆）
  const addIdentity = (eventId, idx) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (!b) return;
    addLog(`【${evt.name}】${b.name}:新增一筆實名資料`, snap());
    updateEvent(eventId, e => {
      const list = Array.isArray(e.buyers[idx].identities) ? [...e.buyers[idx].identities] : [];
      list.push({ id: Date.now()+Math.random(), name:"", phone:"", idNumber:"", tixAccount:"", loginVia:"", locked:false, memberNo:"", qty:1 });
      e.buyers[idx] = { ...e.buyers[idx], identities: list, needRealName: true };
      return e;
    });
  };
  const updateIdentity = (eventId, idx, identityId, updates) => {
    updateEvent(eventId, e => {
      const list = (e.buyers[idx].identities || []).map(it => it.id === identityId ? { ...it, ...updates } : it);
      e.buyers[idx] = { ...e.buyers[idx], identities: list };
      return e;
    });
  };
  const removeIdentity = (eventId, idx, identityId) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (!b) return;
    const it = (b.identities || []).find(x => x.id === identityId);
    setConfirmModal({ msg: `確定要刪除這筆實名資料嗎?\n${it?.name || "(未命名)"}`, onYes: () => {
      addLog(`【${evt.name}】${b.name}:刪除實名資料 ${it?.name || ""}`, snap());
      updateEvent(eventId, e => {
        e.buyers[idx] = { ...e.buyers[idx], identities: (e.buyers[idx].identities || []).filter(x => x.id !== identityId) };
        return e;
      });
      setConfirmModal(null);
    } });
  };

  const migrateBuyer = (b) => {
    if (Array.isArray(b.batches) && b.batches.length > 0) return b;
    const batches = getBatches(b);
    const { pickedDetail, refundAmt, st, ...rest } = b;
    return { ...rest, batches };
  };

  const updateBatch = (eventId, idx, bi, updates) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (b) {
      const cur = getBatches(b)[bi];
      const parts = [];
      if (updates.qty !== undefined && updates.qty !== cur.qty) parts.push(`張數 ${cur.qty}→${updates.qty}`);
      if (updates.st !== undefined && updates.st !== cur.st) parts.push(`狀態→${BUYER_STATUS[updates.st]?.label || updates.st}`);
      if (updates.detail !== undefined && updates.detail !== (cur.detail||"")) parts.push("明細更新");
      if (parts.length > 0) addLog(`【${evt.name}】${b.name} 分批：${parts.join("、")}`, snap());
    }
    updateEvent(eventId, e => {
      const nb = migrateBuyer(e.buyers[idx]);
      nb.batches = [...nb.batches]; nb.batches[bi] = { ...nb.batches[bi], ...updates };
      nb.qty = nb.batches.reduce((s, x) => s + x.qty, 0);
      e.buyers[idx] = nb; return e;
    });
  };

  const addBatch = (eventId, idx, batch) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (b) addLog(`【${evt.name}】${b.name}：新增分批 ${batch.qty}張 ${BUYER_STATUS[batch.st]?.label||batch.st}`, snap());
    updateEvent(eventId, e => {
      const nb = migrateBuyer(e.buyers[idx]);
      nb.batches = [...nb.batches, { qty: batch.qty, st: batch.st, detail: batch.detail || "" }];
      nb.qty = nb.batches.reduce((s, x) => s + x.qty, 0);
      e.buyers[idx] = nb; return e;
    });
  };

  const removeBatch = (eventId, idx, bi) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (!b) return;
    const batches = getBatches(b);
    if (batches.length <= 1) return;
    const bt = batches[bi];
    setConfirmModal({ msg: `確定要移除這筆分批嗎？\n${bt.qty}張 · ${BUYER_STATUS[bt.st]?.label || bt.st}${bt.detail?` · ${bt.detail}`:""}`, onYes: () => {
      addLog(`【${evt.name}】${b.name}：移除分批 ${bt.qty}張 ${BUYER_STATUS[bt.st]?.label||bt.st}`, snap());
      updateEvent(eventId, e => {
        const nb = migrateBuyer(e.buyers[idx]);
        nb.batches = nb.batches.filter((_, i) => i !== bi);
        nb.qty = nb.batches.reduce((s, x) => s + x.qty, 0);
        e.buyers[idx] = nb; return e;
      });
      setConfirmModal(null);
    } });
  };

  const removeBuyer = (eventId, idx) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    const totalQ = b ? buyerTotalQty(b) : 0;
    setConfirmModal({ msg: `確定要移除「${b?.name}」(${totalQ}張) 嗎？`, onYes: () => { addLog(`【${evt?.name}】移除「${b?.name}」(${totalQ}張)`, snap()); updateEvent(eventId, e => { e.buyers.splice(idx, 1); return e; }); setConfirmModal(null); } });
  };

  const setEventStatus = (eventId, newStatus) => {
    const labels = { active: "進行中", picked: "已取票", done: "已完成" };
    addLog(`【${getEventName(eventId)}】狀態→${labels[newStatus]}`, snap());
    updateEvent(eventId, e => { e.status = newStatus; return e; });
  };

  const deleteEvent = (eventId) => {
    setConfirmModal({ msg: `確定要刪除「${getEventName(eventId)}」嗎？可透過紀錄還原。`, onYes: () => { addLog(`刪除場次【${getEventName(eventId)}】`, snap()); setEvents(evs => evs.filter(e => e.id !== eventId)); setConfirmModal(null); } });
  };

  const undoTo = (log) => {
    // 計算這個還原點之後（時間更新）的異動數
    const newerCount = (logs || []).filter(l => l.time > log.time).length;
    const d = new Date(log.time);
    const ts = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    setConfirmModal({
      msg: `即將還原到 ${ts}「${log.msg}」之前的版本。\n\n⚠ 之後的 ${newerCount} 筆異動會消失!\n\n👉 強烈建議先點「💾 匯出備份」存一份再還原,以防萬一。\n\n要繼續嗎?`,
      onYes: () => { addLog(`⟲ 還原到 ${ts}`, snap()); setEvents(log.snapshot); setConfirmModal(null); }
    });
  };

  const exportCSV = () => {
    const bom = "\uFEFF"; let csv = "場次,狀態,票價,訂購人,張數,付款狀態,明細,備註\n";
    events.forEach(e => (e.buyers || []).forEach(b => {
      const batches = getBatches(b);
      batches.forEach(bt => {
        csv += [e.name, e.status === "done" ? "已完成" : e.status === "picked" ? "已取票" : "進行中", e.price || "", b.name, bt.qty, BUYER_STATUS[bt.st]?.label || "", bt.detail || "", b.note || ""].map(v => `"${v}"`).join(",") + "\n";
      });
    }));
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `演唱會票券_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  const exportBackup = () => {
    const data = { version: "3.0", exportedAt: new Date().toISOString(), events, buyerNames, logs };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `票券管家備份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.events || !Array.isArray(data.events)) {
          setConfirmModal({ msg: "備份檔格式不正確：缺少場次資料。\n\n請確認這是從本 app 匯出的 .json 備份檔。", onYes: () => setConfirmModal(null) });
          return;
        }
        const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString("zh-TW") : "未知";
        const buyerCount = Array.isArray(data.buyerNames) ? data.buyerNames.length : 0;
        setConfirmModal({
          msg: `確定要匯入這份備份嗎？\n\n備份時間：${when}\n場次數：${data.events.length}\n客人數：${buyerCount}\n\n⚠️ 目前所有資料會被取代（事後可從操作紀錄還原）`,
          onYes: () => {
            addLog("📥 匯入備份（取代所有資料）", snap());
            setEvents(data.events);
            if (Array.isArray(data.buyerNames)) setBuyerNames(data.buyerNames);
            if (Array.isArray(data.logs)) setLogs(data.logs);
            setConfirmModal(null);
          }
        });
      } catch (err) {
        setConfirmModal({ msg: "讀取備份檔失敗：\n" + err.message, onYes: () => setConfirmModal(null) });
      }
    };
    reader.readAsText(file);
  };

  const exportImage = () => {
    const active = events.filter(e => e.status === "active");
    if (active.length === 0) {
      setConfirmModal({ msg: "目前沒有進行中場次可匯出", onYes: () => setConfirmModal(null) });
      return;
    }

    const W = 760, PAD = 20, IN = 16;
    const F = "'Zen Kaku Gothic New','Noto Sans TC',system-ui,sans-serif";
    const totalTix = active.reduce((s, e) => s + (e.buyers || []).reduce((a, b) => a + buyerTotalQty(b), 0), 0);
    const unpaidC = active.reduce((s, e) => s + countStatusBatches(e.buyers, "unpaid"), 0);

    const tmp = document.createElement("canvas");
    const tctx = tmp.getContext("2d");

    const fmtBuyer = (b) => {
      const batches = getBatches(b);
      const name = b.name;
      // If only one batch, render as 姓名×張數 with status prefix
      if (batches.length === 1) {
        const bt = batches[0];
        let s = `${name}×${bt.qty}`;
        if (bt.st === "unpaid") s = "⚠" + s;
        else if (bt.st === "picked") { s = "🎫" + s; if (bt.detail) s += `(${bt.detail})`; }
        else if (bt.st === "refund") { s = "↩" + s; if (bt.detail) s += `(退${bt.detail})`; }
        else if (bt.st === "refunded") { s = "✅" + s; if (bt.detail) s += `(已退${bt.detail})`; }
        else if (b.note) s += `(${b.note})`;
        return s;
      }
      // Multiple batches: 姓名×總張=2🎫+2↩退1000
      const total = batches.reduce((s, x) => s + x.qty, 0);
      const parts = batches.map(bt => {
        const icon = bt.st === "unpaid" ? "⚠" : bt.st === "picked" ? "🎫" : bt.st === "refund" ? "↩" : bt.st === "refunded" ? "✅" : "✓";
        let p = `${bt.qty}${icon}`;
        if (bt.detail) p += bt.detail;
        return p;
      });
      return `${name}×${total}[${parts.join(" ")}]`;
    };

    const bodyFont = `13px ${F}`;
    const bodyMaxW = W - PAD * 2 - IN * 2;
    const lineH = 18;

    const wrapText = (text, maxW) => {
      tctx.font = bodyFont;
      const lines = []; let line = "";
      const parts = text.split(" · ");
      for (const p of parts) {
        const test = line ? line + " · " + p : p;
        if (tctx.measureText(test).width > maxW && line) { lines.push(line); line = p; }
        else line = test;
      }
      if (line) lines.push(line);
      return lines;
    };

    const layouts = active.map(evt => {
      const buyersText = (evt.buyers || []).map(fmtBuyer).join(" · ");
      const wrapped = buyersText ? wrapText(buyersText, bodyMaxW) : [];
      const h = 10 + 22 + (wrapped.length > 0 ? 4 + wrapped.length * lineH : 0) + (evt.note ? 4 + 18 : 0) + 10;
      return { evt, wrapped, h };
    });

    const HEADER_H = 86;
    let totalH = HEADER_H + PAD;
    layouts.forEach(l => { totalH += l.h + 6; });
    totalH += 26;

    // Fixed 1x scale for maximum browser compatibility (especially iOS)
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = totalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setConfirmModal({ msg: "無法建立畫布,請換個瀏覽器再試", onYes: () => setConfirmModal(null) });
      return;
    }
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#f2f0eb";
    ctx.fillRect(0, 0, W, totalH);

    // Header
    ctx.fillStyle = "#2d2a26";
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillStyle = "#8b7355";
    ctx.fillRect(0, HEADER_H - 3, W, 3);

    ctx.fillStyle = "#faf9f6";
    ctx.font = `bold 24px ${F}`;
    ctx.fillText("票券管家", PAD, 36);
    ctx.fillStyle = "#8b7355";
    ctx.font = `10px ${F}`;
    ctx.fillText("TICKET MANAGER", PAD + 105, 34);

    const d = new Date();
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    ctx.fillStyle = "#a09080";
    ctx.font = `12px ${F}`;
    ctx.textAlign = "right";
    ctx.fillText(`${dateStr} ${timeStr}`, W - PAD, 34);
    ctx.textAlign = "left";

    ctx.fillStyle = "#faf9f6";
    ctx.font = `bold 15px ${F}`;
    const statLine = `進行中 ${active.length} 場  ·  共 ${totalTix} 張${unpaidC > 0 ? `  ·  ⚠ 未付 ${unpaidC}` : ""}`;
    ctx.fillText(statLine, PAD, 68);

    // Events
    let y = HEADER_H + PAD;
    layouts.forEach(({ evt, wrapped, h }) => {
      const hasUnpaid = (evt.buyers || []).some(b => buyerHasStatus(b, "unpaid"));
      const totalQ = (evt.buyers || []).reduce((s, b) => s + buyerTotalQty(b), 0);

      ctx.fillStyle = "#fff";
      roundRect(ctx, PAD, y, W - PAD * 2, h, 8);
      ctx.fill();
      ctx.fillStyle = hasUnpaid ? "#c47070" : "#8b7355";
      ctx.fillRect(PAD, y, 3, h);

      // Title
      ctx.fillStyle = "#2d2a26";
      ctx.font = `bold 15px ${F}`;
      ctx.fillText(evt.name, PAD + IN, y + 22);

      // Right meta
      ctx.font = `12px ${F}`;
      ctx.fillStyle = "#8b7355";
      const rightText = evt.price ? `${totalQ} 張  ·  ${evt.price}` : `${totalQ} 張`;
      ctx.textAlign = "right";
      ctx.fillText(rightText, W - PAD - IN, y + 22);
      ctx.textAlign = "left";

      // Buyers
      if (wrapped.length > 0) {
        ctx.font = bodyFont;
        ctx.fillStyle = "#555";
        wrapped.forEach((line, i) => {
          ctx.fillText(line, PAD + IN, y + 44 + i * lineH);
        });
      }

      // Note
      if (evt.note) {
        const ny = y + 44 + wrapped.length * lineH + (wrapped.length > 0 ? 4 : 0);
        ctx.fillStyle = "#a08a66";
        ctx.font = `italic 12px ${F}`;
        ctx.fillText(`備註:${evt.note}`, PAD + IN, ny + 12);
      }

      y += h + 6;
    });

    // Footer
    ctx.fillStyle = "#b0a090";
    ctx.font = `11px ${F}`;
    ctx.textAlign = "center";
    ctx.fillText("票券管家", W / 2, y + 14);
    ctx.textAlign = "left";

    const filename = `票券管家_進行中_${dateStr.replace(/\//g, "-")}_${timeStr.replace(":", "")}.png`;

    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          setConfirmModal({ msg: "圖片產生失敗,請再試一次。", onYes: () => setConfirmModal(null) });
          return;
        }
        // Mobile: try share sheet
        if (navigator.share && typeof File !== "undefined") {
          try {
            const file = new File([blob], filename, { type: "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              navigator.share({ files: [file], title: "票券管家" }).catch(() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                a.click();
              });
              return;
            }
          } catch (_) {}
        }
        // Desktop: download
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    } catch (err) {
      setConfirmModal({ msg: "匯出失敗:" + (err?.message || err), onYes: () => setConfirmModal(null) });
    }
  };

  const startEditPrice = (evt, e) => { e.stopPropagation(); setEditingPrice(evt.id); setPriceVal(evt.price || ""); };
  const savePrice = (evtId) => { const evt = events.find(e => e.id === evtId); if (evt && priceVal !== evt.price) addLog(`【${evt.name}】票價 ${evt.price || "(空)"}→${priceVal || "(空)"}`, snap()); updateEvent(evtId, e => { e.price = priceVal; return e; }); setEditingPrice(null); };

  const startEditName = (evt, e) => { e.stopPropagation(); setEditingName(evt.id); setNameVal(evt.name || ""); };
  const saveName = (evtId) => {
    const evt = events.find(e => e.id === evtId);
    const trimmed = nameVal.trim();
    if (!trimmed) { setEditingName(null); return; }
    if (evt && trimmed !== evt.name) addLog(`場次改名:${evt.name} → ${trimmed}`, snap());
    updateEvent(evtId, e => { e.name = trimmed; return e; });
    setEditingName(null);
  };

  return (
    <div style={{ fontFamily: "'Zen Kaku Gothic New','Noto Sans TC',system-ui,sans-serif", background: "#f2f0eb", minHeight: "100vh", color: "#2d2a26" }}>
      <link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />
      <style>{`
        @media (min-width: 768px) { html,body{zoom:1.3} }
        *{box-sizing:border-box} @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} .anim-in{animation:fadeIn .2s ease-out}
        input:focus,select:focus{border-color:#8b7355!important;outline:none}
        .qty-btn{width:28px;height:28px;border-radius:7px;border:1.5px solid #d4d0c8;background:#fff;font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s;color:#2d2a26;font-family:inherit}
        .qty-btn:hover{background:#2d2a26;color:#fff;border-color:#2d2a26}
        .st-btn{padding:4px 10px;border-radius:14px;border:1.5px solid transparent;font-size:11px;font-weight:700;cursor:pointer;transition:all .12s;font-family:inherit}
        .st-btn:hover{filter:brightness(0.92)} .st-btn.active{border-color:currentColor}
      `}</style>

      {/* Header */}
      <div style={{ background:"#2d2a26",color:"#faf9f6",padding:"14px 20px",position:"sticky",top:0,zIndex:100,borderBottom:"3px solid #8b7355" }}>
        <div style={{ maxWidth:900,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8 }}>
          <div style={{ display:"flex",alignItems:"baseline",gap:10 }}>
            <span style={{ fontSize:20,fontWeight:700,letterSpacing:1 }}>票券管家</span>
            <span style={{ fontSize:11,color:"#8b7355",fontWeight:500 }}>TICKET MANAGER</span>
            {SUPABASE_READY && (
              <button onClick={refetchFromCloud} title={lastSyncedAt?`最後同步：${new Date(lastSyncedAt).toLocaleString("zh-TW")}\n點擊從雲端重新載入`:"從雲端重新載入"}
                style={{ marginLeft:6,padding:"3px 9px",borderRadius:10,border:"none",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit",
                  background: syncStatus==="error"?"#7a3030":syncStatus==="saving"||syncStatus==="loading"?"#8b7355":"#3a5a3a",
                  color:"#faf9f6" }}>
                {syncStatus==="loading"?"⟳ 載入中":syncStatus==="saving"?"⟳ 同步中":syncStatus==="saved"?"☁ 已同步":syncStatus==="error"?"⚠ 同步失敗":"○ 離線"}
              </button>
            )}
            {!SUPABASE_READY && (
              <span title="尚未設定雲端，資料只存本機" style={{ marginLeft:6,padding:"3px 9px",borderRadius:10,fontSize:10,fontWeight:700,background:"#555",color:"#bbb" }}>○ 本機</span>
            )}
          </div>
          <div style={{ display:"flex",gap:4,flexWrap:"wrap",alignItems:"center" }}>
            {(() => {
              const pendingTotal = events.filter(e=>e.status==="active"||e.status==="picked").reduce((s,e)=>s+countPendingFlag(e.buyers,"needRealName","gotRealName")+countPendingFlag(e.buyers,"needSid","gotSid")+countPendingFlag(e.buyers,"ticketDelivered","photoReceived"),0);
              return [{key:"active",label:`進行中 (${activeEvents.length})`},{key:"picked",label:`已取票 (${pickedEvents.length})`},{key:"done",label:`已完成 (${doneEvents.length})`},{key:"pending",label:`📋 待收${pendingTotal>0?` (${pendingTotal})`:""}`},{key:"buyers",label:`👤 訂購人 (${buyersAggregated.length})`},{key:"timeline",label:`📅 時間軸`}].map(t=>(
              <button key={t.key} onClick={()=>{setTab(t.key);setSearch("");setExpandedId(null);setShowLog(false);}} style={{ padding:"7px 16px",borderRadius:8,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:tab===t.key&&!showLog?"#8b7355":"transparent",color:tab===t.key&&!showLog?"#fff":"#a09888" }}>{t.label}</button>
              ));
            })()}
            <div style={{ width:1,height:20,background:"#555",margin:"0 4px" }}/>
            <button onClick={()=>setShowLog(!showLog)} style={{ padding:"7px 14px",borderRadius:8,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:showLog?"#8b7355":"transparent",color:showLog?"#fff":"#a09888",position:"relative" }}>
              📋 紀錄{logs.length>0&&!showLog&&<span style={{ position:"absolute",top:2,right:2,width:8,height:8,borderRadius:4,background:"#c47070" }}/>}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:900,margin:"0 auto",padding:"20px 16px" }}>
        {/* Stats */}
        {tab==="active"&&!showLog&&(
          <div style={{ display:"flex",gap:10,marginBottom:18,flexWrap:"wrap" }}>
            {[{label:"場次",value:activeEvents.length,accent:"#2d2a26"},{label:"總張數",value:totalTickets,accent:"#5a7a5a"},{label:"未付款",value:unpaidCount,accent:unpaidCount>0?"#8b3a3a":"#5a7a5a"}].map((s,i)=>(
              <div key={i} style={{ flex:1,minWidth:90,background:"#fff",borderRadius:12,padding:"12px 16px",border:"1px solid #e4e0d8" }}>
                <div style={{ fontSize:11,color:"#999",letterSpacing:.5,marginBottom:3 }}>{s.label}</div>
                <div style={{ fontSize:24,fontWeight:700,color:s.accent }}>{s.value}</div>
              </div>))}
          </div>)}
        {tab==="picked"&&!showLog&&(
          <div style={{ display:"flex",gap:10,marginBottom:18,flexWrap:"wrap" }}>
            {[{label:"已取票場次",value:pickedEvents.length,accent:"#2d6a8b"},{label:"待退費",value:pickedRefundCount,accent:pickedRefundCount>0?"#8b6a2d":"#5a7a5a"}].map((s,i)=>(
              <div key={i} style={{ flex:1,minWidth:90,background:"#fff",borderRadius:12,padding:"12px 16px",border:"1px solid #e4e0d8" }}>
                <div style={{ fontSize:11,color:"#999",letterSpacing:.5,marginBottom:3 }}>{s.label}</div>
                <div style={{ fontSize:24,fontWeight:700,color:s.accent }}>{s.value}</div>
              </div>))}
          </div>)}

        {/* Toolbar */}
        {!showLog&&(
          <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap" }}>
            <input placeholder="搜尋場次或訂購人..." value={search} onChange={e=>setSearch(e.target.value)} style={{ flex:1,minWidth:160,padding:"10px 14px",borderRadius:10,border:"1.5px solid #d4d0c8",fontSize:14,background:"#faf9f6",fontFamily:"inherit" }}/>
            <button onClick={()=>setShowAddEvent(true)} style={{ padding:"10px 16px",borderRadius:10,border:"none",background:"#2d2a26",color:"#faf9f6",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",display:["active","picked","done"].includes(tab)?"inline-block":"none" }}>＋ 新增場次</button>
            <button onClick={exportCSV} style={{ padding:"10px 12px",borderRadius:10,border:"1.5px solid #d4d0c8",background:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>匯出CSV</button>
            {tab==="active"&&<button onClick={exportImage} title="把進行中場次存成一張圖，可傳到 LINE 隨時查看" style={{ padding:"10px 12px",borderRadius:10,border:"1.5px solid #d8c4a8",background:"#faf3e8",fontSize:12,cursor:"pointer",fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>🖼️ 匯出圖片</button>}
            <button onClick={exportBackup} title="匯出完整備份（JSON），可匯回" style={{ padding:"10px 12px",borderRadius:10,border:"1.5px solid #c4d9c4",background:"#f2f7f2",fontSize:12,cursor:"pointer",fontWeight:700,color:"#5a7a5a",fontFamily:"inherit" }}>💾 匯出備份</button>
            <button onClick={()=>fileInputRef.current?.click()} title="從備份檔還原資料" style={{ padding:"10px 12px",borderRadius:10,border:"1.5px solid #b8d4e8",background:"#eef6fa",fontSize:12,cursor:"pointer",fontWeight:700,color:"#2d6a8b",fontFamily:"inherit" }}>📥 匯入備份</button>
            <input type="file" ref={fileInputRef} accept=".json,application/json" style={{ display:"none" }} onChange={e=>{ const f=e.target.files?.[0]; if(f) handleImportFile(f); e.target.value=""; }}/>
          </div>)}

        {/* Log Panel */}
        {showLog&&(()=>{
          // 找適合的「快捷還原點」
          const now = Date.now();
          const findClosestLog = (targetTime) => {
            // 找時間最接近 targetTime（且 <= targetTime）的有 snapshot 的 log
            const candidates = (logs || []).filter(l => l.snapshot && l.time <= targetTime);
            return candidates.length > 0 ? candidates[0] : null;
          };
          const today0 = new Date(); today0.setHours(0,0,0,0);
          const yest23 = new Date(); yest23.setDate(yest23.getDate()-1); yest23.setHours(23,59,59,999);
          const week = now - 7*24*60*60*1000;
          const hour = now - 60*60*1000;

          const shortcuts = [
            { label:"⟲ 一小時前", target:hour },
            { label:"⟲ 今天早上", target:today0.getTime() },
            { label:"⟲ 昨天結尾", target:yest23.getTime() },
            { label:"⟲ 一週前", target:week },
          ].map(s => ({ ...s, log: findClosestLog(s.target) })).filter(s => s.log);

          // 按日期分組
          const byDate = new Map();
          (logs || []).forEach(log => {
            const d = new Date(log.time);
            const dk = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
            if (!byDate.has(dk)) byDate.set(dk, []);
            byDate.get(dk).push(log);
          });

          const oldestLog = logs.length > 0 ? logs[logs.length-1] : null;
          const oldestDate = oldestLog ? new Date(oldestLog.time) : null;

          return (
          <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
            {/* 說明卡 */}
            <div style={{ background:"#fff3e0",borderRadius:12,border:"1px solid #e6b87a",padding:"12px 16px",fontSize:12,color:"#7a5a30",lineHeight:1.6 }}>
              <div style={{ fontWeight:700,marginBottom:4,fontSize:13,color:"#5a4020" }}>📋 還原中心</div>
              這裡可以把資料倒帶到過去某個時間點，**用於誤改、誤刪救急**。每次還原前都建議先 💾 匯出備份。
            </div>

            {/* 統計 */}
            {logs.length > 0 && (
              <div style={{ background:"#fff",borderRadius:12,border:"1px solid #e4e0d8",padding:"12px 16px",display:"flex",gap:24,flexWrap:"wrap",fontSize:13 }}>
                <div><span style={{ color:"#999" }}>總紀錄：</span><span style={{ fontWeight:700 }}>{logs.length} 筆</span><span style={{ color:"#bbb",fontSize:11,marginLeft:4 }}>(上限 500)</span></div>
                {oldestDate && <div><span style={{ color:"#999" }}>最早可還原到：</span><span style={{ fontWeight:700 }}>{oldestDate.getFullYear()}/{String(oldestDate.getMonth()+1).padStart(2,"0")}/{String(oldestDate.getDate()).padStart(2,"0")}</span></div>}
              </div>
            )}

            {/* 快捷還原 */}
            {shortcuts.length > 0 && (
              <div style={{ background:"#fff",borderRadius:12,border:"1px solid #e4e0d8",padding:"14px 16px" }}>
                <div style={{ fontSize:12,fontWeight:700,color:"#7a6850",marginBottom:8 }}>⚡ 快捷還原</div>
                <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                  {shortcuts.map((s,i)=>(
                    <button key={i} onClick={()=>undoTo(s.log)} style={{ padding:"7px 14px",borderRadius:8,border:"1.5px solid #d4cdb8",background:"#faf7f0",cursor:"pointer",fontSize:12,fontWeight:700,color:"#7a5a30",fontFamily:"inherit" }}>{s.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* 完整紀錄按日期分組 */}
            <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden" }}>
              <div style={{ padding:"12px 18px",borderBottom:"1px solid #f0ede8",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <span style={{ fontWeight:700,fontSize:14 }}>📚 完整歷史</span>
                {logs.length>0&&<button onClick={()=>setConfirmModal({msg:"確定要清除所有歷史紀錄嗎?\n清除後就不能再還原。",onYes:()=>{setLogs([]);setConfirmModal(null);}})} style={{ padding:"5px 12px",borderRadius:7,border:"1px solid #e8c4c4",background:"#fff",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b3a3a",fontFamily:"inherit" }}>清除紀錄</button>}
              </div>
              {logs.length===0?<div style={{ padding:30,textAlign:"center",color:"#bbb",fontSize:14 }}>目前沒有操作紀錄</div>:(
                <div style={{ maxHeight:600,overflowY:"auto" }}>
                  {Array.from(byDate.entries()).map(([dateKey, dayLogs])=>(
                    <div key={dateKey}>
                      <div style={{ padding:"8px 18px",background:"#faf7f0",fontWeight:700,fontSize:12,color:"#7a6850",borderBottom:"1px solid #f0ede8",position:"sticky",top:0 }}>📅 {dateKey} · {dayLogs.length} 筆</div>
                      {dayLogs.map((log,idx)=>{
                        const d=new Date(log.time);
                        const ts=`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
                        const isDayLast = idx === 0; // 因為 logs 是倒序，每個 dayLogs 的第一筆就是當日最新
                        return (<div key={log.id} style={{ padding:"10px 18px",borderBottom:"1px solid #f5f3ef",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,fontSize:13 }}>
                          <div style={{ flex:1,minWidth:0,display:"flex",alignItems:"center",gap:6 }}>
                            <span style={{ color:"#999",fontSize:11,fontFamily:"monospace",minWidth:60 }}>{ts}</span>
                            {isDayLast && <span title="當日最後一筆異動,適合作為還原首選" style={{ fontSize:11 }}>🌟</span>}
                            <span style={{ wordBreak:"break-word" }}>{log.msg}</span>
                          </div>
                          {log.snapshot&&<button onClick={()=>undoTo(log)} style={{ padding:"4px 10px",borderRadius:6,border:"1px solid #d4d0c8",background:"#faf9f6",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b7355",fontFamily:"inherit",whiteSpace:"nowrap" }}>⟲ 還原到此</button>}
                        </div>);
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* Event cards */}
        {!showLog&&["active","picked","done"].includes(tab)&&(<div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {filtered.length===0&&<div style={{ textAlign:"center",padding:40,color:"#999" }}>{search?"找不到結果":"目前沒有場次"}</div>}
          {filtered.map(evt=>{
            const isExp=expandedId===evt.id, buyerTotal=(evt.buyers||[]).reduce((s,b)=>s+buyerTotalQty(b),0);
            const hasUnpaid=(evt.buyers||[]).some(b=>buyerHasStatus(b,"unpaid")), hasRefund=(evt.buyers||[]).some(b=>buyerHasStatus(b,"refund"));
            const borderColor=hasUnpaid?"#c47070":hasRefund?"#c4a040":evt.status==="done"?"#7aab7a":evt.status==="picked"?"#5a9abb":"#8b7355";
            return (<div key={evt.id} id={`evt-${evt.id}`} className="anim-in" style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden",borderLeft:`4px solid ${borderColor}` }}>
              {/* Header */}
              <div onClick={()=>setExpandedId(isExp?null:evt.id)} style={{ padding:"14px 18px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                    {evt.status==="done"&&<span>✅</span>}{evt.status==="picked"&&<span>🎫</span>}
                    {editingName===evt.id?(
                      <div onClick={e=>e.stopPropagation()} style={{ display:"flex",gap:4,alignItems:"center" }}>
                        <input autoFocus value={nameVal} onChange={e=>setNameVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveName(evt.id);if(e.key==="Escape")setEditingName(null);}}
                          style={{ width:200,padding:"4px 8px",borderRadius:6,border:"1.5px solid #8b7355",fontSize:16,fontFamily:"inherit",fontWeight:700 }}/>
                        <button onClick={()=>saveName(evt.id)} style={{ padding:"3px 8px",borderRadius:5,border:"none",background:"#2d2a26",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700 }}>✓</button>
                        <button onClick={()=>setEditingName(null)} style={{ padding:"3px 8px",borderRadius:5,border:"1px solid #ddd",background:"#fff",fontSize:11,cursor:"pointer",color:"#999" }}>✕</button>
                      </div>
                    ):(
                      <span onClick={e=>startEditName(evt,e)} style={{ fontWeight:700,fontSize:16,cursor:"pointer",padding:"2px 6px",borderRadius:5,transition:"background 0.15s" }} onMouseEnter={e=>e.currentTarget.style.background="#f6f0e8"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} title="點擊編輯名稱">{evt.name}</span>
                    )}
                    <span style={{ fontSize:12,fontWeight:700,padding:"2px 10px",borderRadius:12,background:"#f0ede8",color:"#8b7355" }}>{buyerTotal} 張</span>
                    {hasUnpaid&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#fce8e8",color:"#8b3a3a" }}>未付款</span>}
                    {hasRefund&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#f6f0e0",color:"#8b6a2d" }}>待退費</span>}
                    {countPendingFlag(evt.buyers,"needRealName","gotRealName")>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#fff3e0",color:"#a86a30" }}>📝待收實名 {countPendingFlag(evt.buyers,"needRealName","gotRealName")}</span>}
                    {countPendingFlag(evt.buyers,"needSid","gotSid")>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#fff3e0",color:"#a86a30" }}>🎟待收SID {countPendingFlag(evt.buyers,"needSid","gotSid")}</span>}
                    {countPendingFlag(evt.buyers,"ticketDelivered","photoReceived")>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#fff3e0",color:"#a86a30" }}>📸待回傳照 {countPendingFlag(evt.buyers,"ticketDelivered","photoReceived")}</span>}
                  </div>
                  {!isExp&&<div style={{ marginTop:6,display:"flex",flexWrap:"wrap",gap:4 }}>
                    {(evt.buyers||[]).slice(0,10).map((b,i)=>{
                      const batches=getBatches(b);
                      const pSt=buyerPrimaryStatus(b);
                      const sc=BUYER_STATUS[pSt]||BUYER_STATUS.normal;
                      const totalQ=buyerTotalQty(b);
                      const suffix = batches.length>1
                        ? ` [${batches.map(x=>`${x.qty}${BUYER_STATUS[x.st]?.icon||""}`).join("+")}]`
                        : (batches[0].st==="picked"&&batches[0].detail?` 🎫${batches[0].detail}`
                           :batches[0].st==="refund"&&batches[0].detail?` ↩${batches[0].detail}`
                           :batches[0].st==="refunded"&&batches[0].detail?` ✅${batches[0].detail}`:"");
                      return <span key={i} style={{ fontSize:12,padding:"2px 8px",borderRadius:10,background:sc.bg,color:sc.color,fontWeight:pSt!=="normal"?600:400 }}>{b.name}×{totalQ}{suffix}</span>;
                    })}
                    {(evt.buyers||[]).length>10&&<span style={{ fontSize:12,color:"#999",padding:"2px 4px" }}>+{evt.buyers.length-10}</span>}
                  </div>}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  {editingPrice===evt.id?(
                    <div onClick={e=>e.stopPropagation()} style={{ display:"flex",gap:4,alignItems:"center" }}>
                      <input autoFocus value={priceVal} onChange={e=>setPriceVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")savePrice(evt.id);if(e.key==="Escape")setEditingPrice(null);}}
                        style={{ width:120,padding:"4px 8px",borderRadius:6,border:"1.5px solid #8b7355",fontSize:12,fontFamily:"inherit" }}/>
                      <button onClick={()=>savePrice(evt.id)} style={{ padding:"3px 8px",borderRadius:5,border:"none",background:"#2d2a26",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700 }}>✓</button>
                      <button onClick={()=>setEditingPrice(null)} style={{ padding:"3px 8px",borderRadius:5,border:"1px solid #ddd",background:"#fff",fontSize:11,cursor:"pointer",color:"#999" }}>✕</button>
                    </div>
                  ):(
                    <>
                      {evt.price?<span onClick={e=>startEditPrice(evt,e)} style={{ fontSize:12,color:"#8b7355",fontWeight:600,cursor:"pointer",padding:"2px 8px",borderRadius:6,border:"1px dashed #d4d0c8",background:"#faf7f0" }} title="點擊編輯票價">{evt.price}</span>
                      :<span onClick={e=>startEditPrice(evt,e)} style={{ fontSize:11,color:"#bbb",cursor:"pointer",padding:"2px 8px",borderRadius:6,border:"1px dashed #ddd" }}>＋票價</span>}
                    </>
                  )}
                  <span style={{ fontSize:18,color:"#ccc",transition:"transform .2s",transform:isExp?"rotate(180deg)":"" }}>▾</span>
                </div>
              </div>

              {/* Expanded */}
              {isExp&&(<div style={{ padding:"0 18px 16px",borderTop:"1px solid #f0ede8" }}>
                <div style={{ marginTop:12,display:"flex",flexDirection:"column",gap:8 }}>
                  {(evt.buyers||[]).map((b,i)=>{
                    const batches = getBatches(b);
                    const totalQ = batches.reduce((s,x)=>s+x.qty,0);
                    const primarySt = buyerPrimaryStatus(b);
                    const scMain = BUYER_STATUS[primarySt] || BUYER_STATUS.normal;
                    const isAddingBatch = addingBatch && addingBatch.eventId===evt.id && addingBatch.idx===i;
                    return (<div key={i} style={{ padding:"10px 12px",borderRadius:10,background:scMain.bg,border:`1px solid ${scMain.color}22` }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                        <span style={{ fontWeight:700,fontSize:14,minWidth:70,color:scMain.color }}>{b.name}</span>
                        <span style={{ fontSize:13,fontWeight:700,color:"#555" }}>共 {totalQ} 張</span>
                        {b.note&&<span style={{ fontSize:11,color:"#999",marginLeft:4 }}>({b.note})</span>}
                        <div style={{ marginLeft:"auto",display:"flex",gap:4 }}>
                          <button onClick={()=>{setAddingBatch({eventId:evt.id,idx:i});setEditingBatch(null);}} title="新增分批（例如一部分已取票、一部分待退費）" style={{ padding:"3px 10px",borderRadius:7,border:"1px solid #c4b89a",background:"#fff9ec",cursor:"pointer",fontSize:11,fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>＋ 分批</button>
                          <button onClick={()=>setInputModal({title:`編輯備註 — ${b.name}`,label:"備註",defaultValue:b.note||"",placeholder:"例：2人全勤",onSave:v=>{updateBuyer(evt.id,i,{note:v||undefined});setInputModal(null);}})}
                            style={{ width:26,height:26,borderRadius:6,border:"1px solid #e4e0d8",background:"#fff",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",color:"#999" }} title="編輯備註">✎</button>
                          <button onClick={()=>removeBuyer(evt.id,i)} style={{ width:26,height:26,borderRadius:6,border:"1px solid #e8c4c4",background:"#fff",cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",color:"#c47070" }} title="移除">×</button>
                        </div>
                      </div>

                      {/* 取票前資料：實名 / SID */}
                      <div style={{ marginTop:6,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center" }}>
                        {[
                          { need:"needRealName", got:"gotRealName", label:"實名", icon:"📝" },
                          { need:"needSid", got:"gotSid", label:"SID", icon:"🎟" },
                        ].map(f => {
                          const need = !!b[f.need], got = !!b[f.got];
                          const pending = need && !got;
                          return (
                            <div key={f.need} style={{ display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:8,background:pending?"#fff3e0":need?"rgba(255,255,255,.6)":"transparent",border:`1px solid ${pending?"#e6b87a":need?"#d4d0c8":"#e8e4dc"}` }}>
                              <span style={{ fontSize:11,color:"#888",fontWeight:600 }}>{f.icon}{f.label}</span>
                              <label style={{ display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,color:"#666" }}>
                                <input type="checkbox" checked={need} onChange={()=>toggleBuyerFlag(evt.id,i,f.need)} style={{ cursor:"pointer",margin:0 }}/>
                                需要
                              </label>
                              {need && (
                                <label style={{ display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,color:got?"#3a7a3a":"#a86a30",fontWeight:got?700:600 }}>
                                  <input type="checkbox" checked={got} onChange={()=>toggleBuyerFlag(evt.id,i,f.got)} style={{ cursor:"pointer",margin:0 }}/>
                                  {got?"已收 ✅":"待收 ⏳"}
                                </label>
                              )}
                            </div>
                          );
                        })}
                        {/* 分票流程：已給票 / 已收回傳照 */}
                        {(() => {
                          const delivered = !!b.ticketDelivered, photo = !!b.photoReceived;
                          const waitingPhoto = delivered && !photo;
                          return (
                            <div style={{ display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:8,background:waitingPhoto?"#fff3e0":delivered?"rgba(255,255,255,.6)":"transparent",border:`1px solid ${waitingPhoto?"#e6b87a":delivered?"#d4d0c8":"#e8e4dc"}` }}>
                              <span style={{ fontSize:11,color:"#888",fontWeight:600 }}>🎫分票</span>
                              <label style={{ display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,color:"#666" }}>
                                <input type="checkbox" checked={delivered} onChange={()=>toggleBuyerFlag(evt.id,i,"ticketDelivered")} style={{ cursor:"pointer",margin:0 }}/>
                                已給票
                              </label>
                              {delivered && (
                                <label style={{ display:"flex",alignItems:"center",gap:3,cursor:"pointer",fontSize:11,color:photo?"#3a7a3a":"#a86a30",fontWeight:photo?700:600 }}>
                                  <input type="checkbox" checked={photo} onChange={()=>toggleBuyerFlag(evt.id,i,"photoReceived")} style={{ cursor:"pointer",margin:0 }}/>
                                  {photo?"回傳照已收 ✅":"待回傳照 ⏳"}
                                </label>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* 實名資料清單（多筆）*/}
                      {(b.needRealName || (b.identities && b.identities.length > 0)) && (() => {
                        const idCount = (b.identities || []).length;
                        const idQty = (b.identities || []).reduce((s,x)=>s+(x.qty||1),0);
                        const diff = idQty - totalQ;
                        const matches = diff === 0;
                        const short = diff < 0;
                        return (
                        <div style={{ marginTop:8,padding:"8px 10px",background:"rgba(255,255,255,.55)",borderRadius:8,border:"1px dashed #d4cdb8" }}>
                          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:6 }}>
                            <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                              <span style={{ fontSize:11,fontWeight:700,color:"#7a6850" }}>📝 實名資料 {idCount} 筆 ({idQty} / {totalQ} 張)</span>
                              {idCount > 0 && (
                                matches
                                  ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#dfeadf",color:"#3a7a3a" }}>✅ 張數相符</span>
                                  : short
                                    ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#fce8e8",color:"#8b3a3a" }}>⚠ 還少 {-diff} 張</span>
                                    : <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#f6ecd8",color:"#8b6a2d" }}>多了 {diff} 張</span>
                              )}
                            </div>
                            <button onClick={()=>addIdentity(evt.id,i)} style={{ padding:"3px 10px",borderRadius:6,border:"1px solid #c4b89a",background:"#fff9ec",cursor:"pointer",fontSize:11,fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>＋ 新增一筆</button>
                          </div>
                          {(!b.identities || b.identities.length === 0) && (
                            <div style={{ fontSize:11,color:"#a09080",padding:"4px 2px" }}>還沒有實名資料</div>
                          )}
                          {(b.identities||[]).map((it,k) => {
                            const ekey = `${evt.id}_${i}_${it.id}`;
                            const isOpen = expandedIdentity === ekey;
                            const itQty = it.qty || 1;
                            return (
                              <div key={it.id} style={{ marginTop:k>0?6:0,padding:"6px 8px",background:"#fff",borderRadius:6,border:"1px solid #e4e0d8" }}>
                                <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                                  <button onClick={()=>setExpandedIdentity(isOpen?null:ekey)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:11,color:"#999",padding:"0 4px",fontFamily:"inherit" }}>{isOpen?"▾":"▸"}</button>
                                  <span style={{ fontSize:12,fontWeight:700,color:it.name?"#2d2a26":"#bbb" }}>{it.name || "(未填姓名)"}</span>
                                  <div style={{ display:"flex",alignItems:"center",gap:2 }}>
                                    <button onClick={(e)=>{e.stopPropagation();if(itQty>1)updateIdentity(evt.id,i,it.id,{qty:itQty-1});}} style={{ width:20,height:20,borderRadius:4,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontSize:11,fontWeight:700,color:"#666",fontFamily:"inherit",lineHeight:1 }}>−</button>
                                    <span style={{ fontSize:11,fontWeight:700,minWidth:36,textAlign:"center",color:"#666" }}>{itQty} 張</span>
                                    <button onClick={(e)=>{e.stopPropagation();updateIdentity(evt.id,i,it.id,{qty:itQty+1});}} style={{ width:20,height:20,borderRadius:4,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontSize:11,fontWeight:700,color:"#666",fontFamily:"inherit",lineHeight:1 }}>+</button>
                                  </div>
                                  {it.locked && <span style={{ fontSize:10,padding:"1px 6px",borderRadius:6,background:"#fce8e8",color:"#8b3a3a",fontWeight:700 }}>🔒 帳號鎖</span>}
                                  {it.tixAccount && <span style={{ fontSize:10,color:"#888" }}>· {it.tixAccount}</span>}
                                  <button onClick={()=>removeIdentity(evt.id,i,it.id)} style={{ marginLeft:"auto",width:22,height:22,borderRadius:5,border:"1px solid #e8c4c4",background:"#fff",cursor:"pointer",fontSize:11,color:"#c47070",fontFamily:"inherit" }} title="刪除">×</button>
                                </div>
                                {isOpen && (
                                  <div style={{ marginTop:6,display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:6 }}>
                                    {[
                                      { key:"name", label:"姓名", ph:"中文姓名" },
                                      { key:"phone", label:"電話", ph:"09xx..." },
                                      { key:"idNumber", label:"身分證", ph:"A123..." },
                                      { key:"tixAccount", label:"拓元帳號", ph:"帳號 / Email" },
                                      { key:"memberNo", label:"會員編號", ph:"" },
                                    ].map(field => (
                                      <label key={field.key} style={{ display:"flex",flexDirection:"column",gap:2,fontSize:10,color:"#888" }}>
                                        <span style={{ fontWeight:600 }}>{field.label}</span>
                                        <input value={it[field.key]||""} onChange={e=>updateIdentity(evt.id,i,it.id,{[field.key]:e.target.value})} placeholder={field.ph}
                                          style={{ padding:"5px 7px",borderRadius:5,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6" }}/>
                                      </label>
                                    ))}
                                    <label style={{ display:"flex",flexDirection:"column",gap:2,fontSize:10,color:"#888" }}>
                                      <span style={{ fontWeight:600 }}>登入方式</span>
                                      <select value={it.loginVia||""} onChange={e=>updateIdentity(evt.id,i,it.id,{loginVia:e.target.value})}
                                        style={{ padding:"5px 7px",borderRadius:5,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6" }}>
                                        <option value="">未選</option>
                                        <option value="facebook">Facebook</option>
                                        <option value="google">Google</option>
                                      </select>
                                    </label>
                                    <label style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#666",cursor:"pointer",alignSelf:"end",padding:"5px 0" }}>
                                      <input type="checkbox" checked={!!it.locked} onChange={e=>updateIdentity(evt.id,i,it.id,{locked:e.target.checked})} style={{ cursor:"pointer",margin:0 }}/>
                                      <span style={{ fontWeight:600 }}>🔒 拓元帳號被鎖</span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        );
                      })()}

                      {/* Batches */}
                      <div style={{ marginTop:8,display:"flex",flexDirection:"column",gap:6 }}>
                        {batches.map((bt,bi)=>{
                          const sc = BUYER_STATUS[bt.st] || BUYER_STATUS.normal;
                          const isEditing = editingBatch && editingBatch.eventId===evt.id && editingBatch.idx===i && editingBatch.bi===bi;
                          if (isEditing) {
                            return (<BatchEditor key={bi} initialQty={bt.qty} initialSt={bt.st} initialDetail={bt.detail||""} maxQty={totalQ}
                              onSave={(v)=>{updateBatch(evt.id,i,bi,v);setEditingBatch(null);}}
                              onCancel={()=>setEditingBatch(null)}/>);
                          }
                          return (<div key={bi} style={{ padding:"6px 10px",borderRadius:8,background:"rgba(255,255,255,.7)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",fontSize:13 }}>
                            <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                              <button className="qty-btn" style={{ width:22,height:22,fontSize:13 }} onClick={()=>bt.qty>1&&updateBatch(evt.id,i,bi,{qty:bt.qty-1})}>−</button>
                              <span style={{ fontWeight:700,minWidth:22,textAlign:"center" }}>{bt.qty}</span>
                              <button className="qty-btn" style={{ width:22,height:22,fontSize:13 }} onClick={()=>updateBatch(evt.id,i,bi,{qty:bt.qty+1})}>+</button>
                              <span style={{ fontSize:11,color:"#999",marginLeft:2 }}>張</span>
                            </div>
                            <span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:10,background:sc.bg,color:sc.color,border:`1px solid ${sc.color}` }}>{sc.icon} {sc.label}</span>
                            {bt.detail && <span style={{ fontSize:12,color:sc.color }}>{bt.st==="picked"?"🎫":bt.st==="refund"?"↩":bt.st==="refunded"?"✅":""} {bt.detail}</span>}
                            <button onClick={()=>{setEditingBatch({eventId:evt.id,idx:i,bi});setAddingBatch(null);}} style={{ marginLeft:"auto",padding:"3px 10px",borderRadius:6,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontSize:11,fontWeight:600,color:"#8b7355",fontFamily:"inherit" }}>編輯</button>
                            {batches.length>1&&<button onClick={()=>removeBatch(evt.id,i,bi)} style={{ width:22,height:22,borderRadius:5,border:"1px solid #e8c4c4",background:"#fff",cursor:"pointer",fontSize:11,color:"#c47070",fontFamily:"inherit" }} title="移除此分批">×</button>}
                          </div>);
                        })}
                        {isAddingBatch && (<BatchEditor initialQty={1} initialSt="normal" initialDetail=""
                          onSave={(v)=>{addBatch(evt.id,i,v);setAddingBatch(null);}}
                          onCancel={()=>setAddingBatch(null)}/>)}
                      </div>
                    </div>);
                  })}
                </div>
                <AddBuyerRow eventId={evt.id} buyerNames={buyerNames} onAdd={addBuyerToEvent}/>
                {evt.note&&<div style={{ marginTop:8,fontSize:12,color:"#8b7355",background:"#faf7f0",padding:"6px 10px",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center" }}><span>備註：{evt.note}</span><button onClick={()=>setInputModal({title:"編輯場次備註",label:"備註",defaultValue:evt.note||"",onSave:v=>{updateEvent(evt.id,e=>{e.note=v||undefined;return e;});setInputModal(null);}})} style={{ background:"none",border:"none",fontSize:11,color:"#8b7355",cursor:"pointer",fontWeight:600,fontFamily:"inherit" }}>編輯</button></div>}
                <div style={{ display:"flex",gap:8,marginTop:10,flexWrap:"wrap" }}>
                  {evt.status==="active"&&<button onClick={()=>setEventStatus(evt.id,"picked")} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #b8d4e8",background:"#e0eef6",fontSize:12,cursor:"pointer",fontWeight:600,color:"#2d6a8b",fontFamily:"inherit" }}>🎫 全部已取票</button>}
                  {(evt.buyers||[]).some(b=>(b.identities||[]).length>0)&&<button onClick={()=>setIdentityExportModal({events:[evt],title:evt.name})} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #c4b89a",background:"#fff9ec",fontSize:12,cursor:"pointer",fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>📋 輸出本場實名</button>}
                  {(evt.buyers||[]).some(b=>buyerHasStatus(b,"refund"))&&<button onClick={()=>{
                    addLog(`【${evt.name}】全部待退費標記為已退款`,snap());
                    updateEvent(evt.id,e=>{
                      e.buyers=e.buyers.map(b=>{
                        const nb=migrateBuyer(b);
                        nb.batches=nb.batches.map(bt=>bt.st==="refund"?{...bt,st:"refunded"}:bt);
                        return nb;
                      });
                      return e;
                    });
                  }} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #c4d9c4",background:"#dfeadf",fontSize:12,cursor:"pointer",fontWeight:700,color:"#4a6b4a",fontFamily:"inherit" }}>✅ 退款全部完成</button>}
                  <button onClick={()=>{
                    setConfirmModal({ msg:`確定要把【${evt.name}】裡所有「正常」的訂購人改成「待退費」嗎？\n（金額會留空讓你再填）`, onYes:()=>{
                      addLog(`【${evt.name}】批次標記為待退費`,snap());
                      updateEvent(evt.id,e=>{
                        e.buyers=e.buyers.map(b=>{
                          const nb=migrateBuyer(b);
                          nb.batches=nb.batches.map(bt=>bt.st==="normal"?{...bt,st:"refund"}:bt);
                          return nb;
                        });
                        return e;
                      });
                      setConfirmModal(null);
                    }});
                  }} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #d8c4a8",background:"#faf3e8",fontSize:12,cursor:"pointer",fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>↩ 全部標為待退費</button>
                  {evt.status==="active"&&<button onClick={()=>setEventStatus(evt.id,"done")} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #c4d9c4",background:"#e8f0e8",fontSize:12,cursor:"pointer",fontWeight:600,color:"#5a7a5a",fontFamily:"inherit" }}>✓ 直接完成</button>}
                  {evt.status==="picked"&&<button onClick={()=>setEventStatus(evt.id,"done")} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #c4d9c4",background:"#e8f0e8",fontSize:12,cursor:"pointer",fontWeight:600,color:"#5a7a5a",fontFamily:"inherit" }}>✓ 退費完成，結案</button>}
                  {evt.status==="done"&&<button onClick={()=>setEventStatus(evt.id,"picked")} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #b8d4e8",background:"#e0eef6",fontSize:12,cursor:"pointer",fontWeight:600,color:"#2d6a8b",fontFamily:"inherit" }}>🎫 移到已取票</button>}
                  {(evt.status==="picked"||evt.status==="done")&&<button onClick={()=>setEventStatus(evt.id,"active")} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,color:"#8b7355",fontFamily:"inherit" }}>↩ 移回進行中</button>}
                  <button onClick={()=>deleteEvent(evt.id)} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #e8c4c4",background:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,color:"#8b3a3a",fontFamily:"inherit" }}>刪除</button>
                  {!evt.note&&<button onClick={()=>setInputModal({title:"新增場次備註",label:"備註",defaultValue:"",onSave:v=>{if(v)updateEvent(evt.id,e=>{e.note=v;return e;});setInputModal(null);}})} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>＋ 備註</button>}
                </div>
              </div>)}
            </div>);
          })}
        </div>)}

        {/* Pending (待收) view */}
        {!showLog&&tab==="pending"&&(<div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          {(() => {
            const activeOnly = events.filter(e => e.status === "active" || e.status === "picked");
            const realNameItems = []; const sidItems = []; const photoItems = [];
            activeOnly.forEach(evt => {
              (evt.buyers || []).forEach((b, bi) => {
                if (b.needRealName && !b.gotRealName) realNameItems.push({ evt, b, bi });
                if (b.needSid && !b.gotSid) sidItems.push({ evt, b, bi });
                if (b.ticketDelivered && !b.photoReceived) photoItems.push({ evt, b, bi });
              });
            });
            const renderSection = (title, icon, color, bg, items, gotFlag) => (
              <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden",borderLeft:`4px solid ${color}` }}>
                <div style={{ padding:"12px 18px",background:bg,borderBottom:"1px solid #f0ede8",fontWeight:700,fontSize:15,color,display:"flex",alignItems:"baseline",gap:10 }}>
                  <span>{icon} {title}</span>
                  <span style={{ fontSize:12,fontWeight:500,color:"#999" }}>{items.length} 筆</span>
                </div>
                {items.length === 0 ? (
                  <div style={{ padding:"20px",textAlign:"center",color:"#9b9588",fontSize:13 }}>沒有待收項目 🎉</div>
                ) : (
                  <div style={{ padding:"10px 14px",display:"flex",flexDirection:"column",gap:6 }}>
                    {items.map(({evt,b,bi},i)=>(
                      <div key={i} style={{ padding:"8px 12px",borderRadius:8,background:bg,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
                        <span style={{ fontWeight:700,fontSize:13,color:"#2d2a26",minWidth:0 }}>{b.name}</span>
                        <span style={{ fontSize:12,color:"#666" }}>· {evt.name}</span>
                        <span style={{ fontSize:11,color:"#999" }}>共 {buyerTotalQty(b)} 張</span>
                        <button onClick={()=>toggleBuyerFlag(evt.id,bi,gotFlag)} style={{ marginLeft:"auto",padding:"4px 12px",borderRadius:7,border:`1px solid ${color}`,background:"#fff",fontSize:11,cursor:"pointer",fontWeight:700,color,fontFamily:"inherit" }}>標記為已收 ✅</button>
                        <button onClick={()=>jumpToEvent(evt.id,evt.status)} style={{ padding:"4px 10px",borderRadius:7,border:"1px solid #d4d0c8",background:"#fff",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b7355",fontFamily:"inherit" }}>前往</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
            return (<>
              {renderSection("待收實名資料","📝","#a86a30","#fff3e0",realNameItems,"gotRealName")}
              {renderSection("待收 SID 碼","🎟","#7a5a8b","#f3edf8",sidItems,"gotSid")}
              {renderSection("待回傳照片","📸","#3a7a8b","#e0f0f6",photoItems,"photoReceived")}
              <div style={{ textAlign:"center",fontSize:11,color:"#a09888",padding:"6px 0" }}>* 統計範圍：進行中 + 已取票場次</div>
            </>);
          })()}
        </div>)}

        {/* Buyers (訂購人) view */}
        {!showLog&&tab==="buyers"&&(<div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {(()=>{
            const s=search.toLowerCase();
            const fb=search?buyersAggregated.filter(b=>b.name.toLowerCase().includes(s)):buyersAggregated;
            if(fb.length===0)return <div style={{ textAlign:"center",padding:40,color:"#999" }}>{search?"找不到結果":"目前沒有訂購人"}</div>;
            return fb.map(buyer=>{
              const isExp=expandedId===`buyer-${buyer.name}`;
              const bc=buyer.unpaidQty>0?"#c47070":buyer.refundCount>0?"#c4a040":"#8b7355";
              return (<div key={buyer.name} className="anim-in" style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden",borderLeft:`4px solid ${bc}` }}>
                <div onClick={()=>setExpandedId(isExp?null:`buyer-${buyer.name}`)} style={{ padding:"14px 18px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700,fontSize:16 }}>{buyer.name}</span>
                      <span style={{ fontSize:12,fontWeight:700,padding:"2px 10px",borderRadius:12,background:"#f0ede8",color:"#8b7355" }}>{buyer.totalQty} 張 · {buyer.orders.length} 場</span>
                      {buyer.unpaidQty>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#fce8e8",color:"#8b3a3a" }}>未付款 {buyer.unpaidQty}張</span>}
                      {buyer.refundCount>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#f6f0e0",color:"#8b6a2d" }}>待退費 {buyer.refundCount}筆</span>}
                      {buyer.refundedCount>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#dfeadf",color:"#4a6b4a" }}>已退款 {buyer.refundedCount}筆</span>}
                      {buyer.pickedQty>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#e0eef6",color:"#2d6a8b" }}>已取票 {buyer.pickedQty}張</span>}
                    </div>
                    {!isExp&&<div style={{ marginTop:6,display:"flex",flexWrap:"wrap",gap:4 }}>
                      {buyer.orders.slice(0,10).map((o,i)=>{const sc=BUYER_STATUS[o.st]||BUYER_STATUS.normal;return <span key={i} style={{ fontSize:12,padding:"2px 8px",borderRadius:10,background:sc.bg,color:sc.color,fontWeight:o.st!=="normal"?600:400 }}>{o.eventName}×{o.qty}</span>;})}
                      {buyer.orders.length>10&&<span style={{ fontSize:12,color:"#999",padding:"2px 4px" }}>+{buyer.orders.length-10}</span>}
                    </div>}
                  </div>
                  <span style={{ fontSize:18,color:"#ccc",transition:"transform .2s",transform:isExp?"rotate(180deg)":"" }}>▾</span>
                </div>
                {isExp&&(<div style={{ padding:"0 18px 16px",borderTop:"1px solid #f0ede8" }}>
                  <div style={{ marginTop:12,display:"flex",flexDirection:"column",gap:6 }}>
                    {buyer.orders.map((o,i)=>{
                      const pSt=o.batches&&o.batches.length>0?(function(){const order=["unpaid","refund","picked","refunded","normal"];for(const st of order){if(o.batches.some(x=>x.st===st))return st;}return "normal";})():"normal";
                      const sc=BUYER_STATUS[pSt]||BUYER_STATUS.normal;
                      const sl=o.eventStatus==="done"?"已完成":o.eventStatus==="picked"?"已取票":"進行中";
                      return (<div key={i} style={{ padding:"10px 12px",borderRadius:10,background:sc.bg,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                            <span style={{ fontWeight:700,fontSize:14,color:sc.color }}>{o.eventName}</span>
                            <span style={{ fontSize:11,color:"#999",padding:"1px 6px",borderRadius:8,background:"rgba(255,255,255,.6)" }}>{sl}</span>
                            {o.eventPrice&&<span style={{ fontSize:11,color:"#8b7355" }}>{o.eventPrice}</span>}
                          </div>
                          <div style={{ marginTop:4,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",fontSize:13 }}>
                            <span style={{ fontWeight:700 }}>共 {o.qty} 張</span>
                            {(o.batches||[]).map((bt,bi)=>{
                              const bsc=BUYER_STATUS[bt.st]||BUYER_STATUS.normal;
                              return <span key={bi} style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:10,background:"rgba(255,255,255,.7)",color:bsc.color,border:`1px solid ${bsc.color}44` }}>{bsc.icon} {bt.qty}張 {bsc.label}{bt.detail?` · ${bt.detail}`:""}</span>;
                            })}
                            {o.note&&<span style={{ fontSize:11,color:"#999" }}>({o.note})</span>}
                          </div>
                        </div>
                        <button onClick={()=>jumpToEvent(o.eventId,o.eventStatus)} style={{ padding:"5px 12px",borderRadius:7,border:"1px solid #d4d0c8",background:"#fff",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b7355",fontFamily:"inherit",whiteSpace:"nowrap" }}>前往 →</button>
                      </div>);
                    })}
                  </div>
                </div>)}
              </div>);
            });
          })()}
        </div>)}

        {/* Timeline (時間軸) view */}
        {!showLog&&tab==="timeline"&&(<div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          {/* 篩選列 */}
          {timelineData.length>0&&(() => {
            // 統計各 kind 數量
            const counts = {};
            timelineData.forEach(d => d.items.forEach(it => { counts[it.kind] = (counts[it.kind]||0)+1; }));
            const total = Object.values(counts).reduce((s,n)=>s+n,0);
            const filters = [
              { key:null, label:"全部", icon:"📋", count:total },
              { key:"add", label:"新增", icon:"➕", count:counts.add||0, color:"#3a7a3a" },
              { key:"remove", label:"移除", icon:"✖", count:counts.remove||0, color:"#c47070" },
              { key:"qty", label:"票數", icon:"🔢", count:counts.qty||0, color:"#4a7aab" },
              { key:"status", label:"狀態", icon:"🏷", count:counts.status||0, color:"#a87830" },
              { key:"flag", label:"實名/SID/分票", icon:"📝", count:counts.flag||0, color:"#7a5a8b" },
              { key:"batch", label:"分批", icon:"📦", count:counts.batch||0, color:"#5a7aab" },
              { key:"price", label:"票價", icon:"💰", count:counts.price||0, color:"#3a8a7a" },
              { key:"rename", label:"改名", icon:"✎", count:counts.rename||0, color:"#888" },
              { key:"other", label:"其他", icon:"•", count:counts.other||0, color:"#999" },
            ].filter(f => f.key===null || f.count>0);
            return (
              <div style={{ display:"flex",flexWrap:"wrap",gap:6,padding:"10px 12px",background:"#fff",borderRadius:12,border:"1px solid #e4e0d8" }}>
                {filters.map(f => {
                  const active = timelineFilter === f.key;
                  return (
                    <button key={f.key||"all"} onClick={()=>setTimelineFilter(f.key)}
                      style={{ padding:"5px 11px",borderRadius:14,border:`1.5px solid ${active?(f.color||"#2d2a26"):"#e4e0d8"}`,background:active?(f.color||"#2d2a26"):"#fff",color:active?"#fff":(f.color||"#666"),fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4 }}>
                      <span>{f.icon}</span>
                      <span>{f.label}</span>
                      <span style={{ fontSize:10,opacity:.85,fontWeight:600 }}>{f.count}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {timelineData.length===0?(
            <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",padding:"30px 20px",textAlign:"center",color:"#999" }}>
              <div style={{ fontSize:40,marginBottom:10 }}>📅</div>
              <div style={{ fontWeight:700,marginBottom:6,color:"#555" }}>目前沒有異動紀錄</div>
              <div style={{ fontSize:13,lineHeight:1.7 }}>從現在起所有的新增、修改、狀態變動都會記在這裡。</div>
            </div>
          ):(()=>{
            const s=search.toLowerCase();
            const fd=timelineData.map(day=>({
              date:day.date,
              items:day.items.filter(it=>(timelineFilter===null||it.kind===timelineFilter)&&(!search||(it.msg||"").toLowerCase().includes(s)||(it.eventName||"").toLowerCase().includes(s)))
            })).filter(d=>d.items.length>0);
            if(fd.length===0)return <div style={{ textAlign:"center",padding:40,color:"#999" }}>找不到結果</div>;
            return fd.map(day=>(
              <div key={day.date} className="anim-in" style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden",borderLeft:"4px solid #8b7355" }}>
                <div style={{ padding:"12px 18px",background:"#faf7f0",borderBottom:"1px solid #f0ede8",fontWeight:700,fontSize:15,color:"#5a4a36",display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap" }}>
                  <span>📅 {day.date}</span>
                  <span style={{ fontSize:11,fontWeight:500,color:"#999" }}>{day.items.length} 筆異動</span>
                </div>
                <div style={{ padding:"10px 14px",display:"flex",flexDirection:"column",gap:4 }}>
                  {day.items.map(it=>{
                    const d=new Date(it.time);
                    const ts=`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
                    return (<div key={it.id} style={{ padding:"6px 10px",borderRadius:8,background:"#faf9f6",display:"flex",alignItems:"center",gap:8,fontSize:13,flexWrap:"wrap",borderLeft:`3px solid ${it.color}` }}>
                      <span style={{ color:"#999",fontSize:11,fontFamily:"monospace",minWidth:38 }}>{ts}</span>
                      <span style={{ fontSize:14 }}>{it.icon}</span>
                      <span style={{ flex:1,color:"#2d2a26",minWidth:0,wordBreak:"break-word" }}>
                        {it.eventName&&<span style={{ color:it.color,fontWeight:700 }}>{it.eventName}</span>}
                        {it.eventName&&<span style={{ color:"#999",margin:"0 4px" }}>·</span>}
                        <span style={{ color:"#555" }}>{it.restMsg||it.msg}</span>
                      </span>
                      {it.eventId&&<button onClick={()=>jumpToEvent(it.eventId,it.eventStatus)} style={{ padding:"3px 10px",borderRadius:6,border:"1px solid #d4d0c8",background:"#fff",fontSize:10,cursor:"pointer",fontWeight:600,color:"#8b7355",fontFamily:"inherit",whiteSpace:"nowrap" }}>前往</button>}
                    </div>);
                  })}
                </div>
              </div>
            ));
          })()}
        </div>)}
      </div>

      {/* Add Event Modal */}
      {showAddEvent&&(<div style={{ position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={()=>setShowAddEvent(false)}>
        <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:18,padding:"28px 24px",width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.2)" }}>
          <h3 style={{ margin:"0 0 20px",fontSize:18,fontWeight:700 }}>新增場次</h3>
          <AddEventForm onAdd={(name,price)=>{ addLog(`新增場次【${name}】`,snap()); setEvents(evs=>[...evs,{id:gid(),name,price,status:"active",buyers:[]}]); setShowAddEvent(false); }}/>
        </div>
      </div>)}

      {confirmModal&&<ConfirmModal msg={confirmModal.msg} onYes={confirmModal.onYes} onNo={()=>setConfirmModal(null)}/>}
      {inputModal&&<InputModal title={inputModal.title} label={inputModal.label} defaultValue={inputModal.defaultValue} placeholder={inputModal.placeholder} onSave={inputModal.onSave} onCancel={()=>setInputModal(null)}/>}
      {identityExportModal&&<IdentityExportModal events={identityExportModal.events} title={identityExportModal.title} onClose={()=>setIdentityExportModal(null)}/>}
    </div>
  );
}

function AddBuyerRow({ eventId, buyerNames, onAdd }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef(null);
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setShowDropdown(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const fl = buyerNames.filter(n => !filter || n.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div ref={ref} style={{ position:"relative",marginTop:10 }}>
      <div style={{ display:"flex",gap:6 }}>
        <input value={filter} onChange={e=>{setFilter(e.target.value);setShowDropdown(true);}} onFocus={()=>setShowDropdown(true)} placeholder="選擇或輸入新客人名字..."
          style={{ flex:1,padding:"8px 12px",borderRadius:8,border:"1.5px solid #d4d0c8",fontSize:14,fontFamily:"inherit",background:"#faf9f6" }}/>
        {filter.trim()&&!buyerNames.includes(filter.trim())&&(
          <button onClick={()=>{onAdd(eventId,filter.trim());setFilter("");setShowDropdown(false);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",background:"#2d2a26",color:"#faf9f6",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap" }}>＋ 新增「{filter.trim()}」</button>
        )}
      </div>
      {showDropdown&&fl.length>0&&(
        <div style={{ position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:"#fff",borderRadius:10,border:"1px solid #e4e0d8",boxShadow:"0 8px 24px rgba(0,0,0,.12)",maxHeight:200,overflowY:"auto",zIndex:10 }}>
          {fl.map(name=>(<div key={name} onClick={()=>{onAdd(eventId,name);setFilter("");setShowDropdown(false);}} style={{ padding:"8px 14px",cursor:"pointer",fontSize:14,borderBottom:"1px solid #f5f3ef",transition:"background .1s" }} onMouseOver={e=>e.target.style.background="#f5f3ef"} onMouseOut={e=>e.target.style.background="transparent"}>{name}</div>))}
        </div>
      )}
    </div>
  );
}

function AddEventForm({ onAdd }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("預收6000");
  return (
    <div>
      <div style={{ marginBottom:14 }}><label style={{ display:"block",fontSize:13,fontWeight:600,color:"#555",marginBottom:5 }}>場次名稱</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="例：五月天2026台北" style={{ width:"100%",padding:"10px 14px",borderRadius:10,border:"1.5px solid #d4d0c8",fontSize:15,fontFamily:"inherit",boxSizing:"border-box" }}/></div>
      <div style={{ marginBottom:14 }}><label style={{ display:"block",fontSize:13,fontWeight:600,color:"#555",marginBottom:5 }}>票價</label>
        <input value={price} onChange={e=>setPrice(e.target.value)} style={{ width:"100%",padding:"10px 14px",borderRadius:10,border:"1.5px solid #d4d0c8",fontSize:15,fontFamily:"inherit",boxSizing:"border-box" }}/></div>
      <button onClick={()=>{if(name.trim())onAdd(name.trim(),price.trim());}} style={{ width:"100%",padding:"12px 20px",borderRadius:12,background:"#2d2a26",color:"#faf9f6",border:"none",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit" }}>新增</button>
    </div>
  );
}
