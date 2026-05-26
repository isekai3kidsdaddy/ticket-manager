import { useState, useEffect, useMemo, useRef } from "react";
import { SUPABASE_READY, loadFromSupabase, saveToSupabase } from "./supabaseClient";
import * as InitData from "./initialData";
const KNOWN_BUYERS = InitData.KNOWN_BUYERS;
const INITIAL_EVENTS = InitData.INITIAL_EVENTS;
// 應用名稱 — 若 initialData.js 沒匯出就用預設值「票券管家」
const APP_TITLE = InitData.APP_TITLE || "票券管家";
const APP_SUBTITLE = InitData.APP_SUBTITLE || "TICKET MANAGER";

// ─── All unique buyer names from existing data ───

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
function ConfirmModal({ msg, onYes, onNo, onDismiss, yesLabel, noLabel, maxWidth }) {
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") (onDismiss || onNo || (()=>{}))(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onDismiss, onNo]);
  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onDismiss||onNo}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:16,padding:"24px",width:"100%",maxWidth:maxWidth||360,boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <div style={{ fontSize:15, marginBottom:20, lineHeight:1.6, whiteSpace:"pre-line" }}>{msg}</div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end",flexWrap:"wrap" }}>
          <button onClick={onNo} style={{ padding:"8px 20px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:14,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>{noLabel||"取消"}</button>
          <button onClick={onYes} style={{ padding:"8px 20px",borderRadius:8,border:"none",background:"#2d2a26",color:"#faf9f6",fontSize:14,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>{yesLabel||"確定"}</button>
        </div>
      </div>
    </div>
  );
}

function InputModal({ title, label, defaultValue, onSave, onCancel, placeholder }) {
  const [val, setVal] = useState(defaultValue || "");
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);
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

// 資料差異對照 Modal:逐筆顯示跟快照的差異,標記「有 log 解釋」vs「無法解釋」
function DataDiffModal({ diff, onClose, onRestore }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const Row = ({ icon, color, text, sub, explained, expl }) => (
    <div style={{ display:"flex",alignItems:"flex-start",gap:8,padding:"7px 0",borderBottom:"1px solid #f5f3ef" }}>
      <span style={{ fontSize:14,color,minWidth:18 }}>{icon}</span>
      <div style={{ flex:1,minWidth:0 }}>
        <div style={{ fontSize:13,color:"#2d2a26" }}>{text}</div>
        {sub && <div style={{ fontSize:11,color:"#888",marginTop:2 }}>{sub}</div>}
        {explained === true && expl && <div style={{ fontSize:10,color:"#5a7a5a",marginTop:2 }}>✓ 有對應 log: {expl}</div>}
        {explained === false && <div style={{ fontSize:10,color:"#c47070",marginTop:2,fontWeight:700 }}>⚠ 找不到對應 log → 可能是資料消失</div>}
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:16,padding:"20px 22px",width:"100%",maxWidth:720,maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:8 }}>
          <h3 style={{ margin:0,fontSize:17,fontWeight:700 }}>🔍 與 {diff.prevKey} 的差異</h3>
          <button onClick={()=>onRestore(diff.prevKey)} style={{ padding:"6px 14px",borderRadius:7,border:"1.5px solid #d4cdb8",background:"#faf7f0",fontSize:12,cursor:"pointer",fontWeight:700,color:"#7a5a30",fontFamily:"inherit" }}>⟲ 還原到 {diff.prevKey}</button>
        </div>

        {/* 摘要 */}
        <div style={{ background:diff.alert?"#fff0eb":"#f7f3ec",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#7a5a30",border:`1px solid ${diff.alert?"#e09080":"#e4e0d8"}` }}>
          {diff.alert ? (
            <><b style={{ color:"#8b3a3a" }}>⚠ 偵測到 {diff.unexplained} 筆「找不到對應 log」的變動</b>,可能是同步異常導致資料消失。若不是你刻意操作,建議「⟲ 還原到 {diff.prevKey}」。</>
          ) : (
            <>所有變動都有對應的操作 log,看起來是正常的編輯。</>
          )}
        </div>

        <div style={{ flex:1,overflowY:"auto",padding:"0 4px" }}>
          {/* 場次新增 */}
          {diff.eventsAdded.length > 0 && (
            <details open style={{ marginBottom:8 }}>
              <summary style={{ fontSize:13,fontWeight:700,padding:"6px 0",color:"#5a7a5a",cursor:"pointer" }}>🆕 場次新增 ({diff.eventsAdded.length})</summary>
              {diff.eventsAdded.map((e, i) => (<Row key={i} icon="+" color="#5a7a5a" text={e.name}/>))}
            </details>
          )}
          {/* 場次刪除 */}
          {diff.eventsRemoved.length > 0 && (
            <details open style={{ marginBottom:8 }}>
              <summary style={{ fontSize:13,fontWeight:700,padding:"6px 0",color:"#c47070",cursor:"pointer" }}>🗑 場次刪除 ({diff.eventsRemoved.length})</summary>
              {diff.eventsRemoved.map((e, i) => (<Row key={i} icon="−" color="#c47070" text={e.name} sub={`原有 ${e.buyerCount} 人 · ${e.qty} 張`} explained={e.explained} expl={e.explanation}/>))}
            </details>
          )}
          {/* 訂購人新增 */}
          {diff.buyersAdded.length > 0 && (
            <details style={{ marginBottom:8 }}>
              <summary style={{ fontSize:13,fontWeight:700,padding:"6px 0",color:"#5a7a5a",cursor:"pointer" }}>👤 訂購人新增 ({diff.buyersAdded.length})</summary>
              {diff.buyersAdded.map((b, i) => (<Row key={i} icon="+" color="#5a7a5a" text={`${b.buyerName} (${b.qty} 張)`} sub={`@${b.eventName}`}/>))}
            </details>
          )}
          {/* 訂購人刪除 */}
          {diff.buyersRemoved.length > 0 && (
            <details open style={{ marginBottom:8 }}>
              <summary style={{ fontSize:13,fontWeight:700,padding:"6px 0",color:"#c47070",cursor:"pointer" }}>👤 訂購人刪除 ({diff.buyersRemoved.length})</summary>
              {diff.buyersRemoved.map((b, i) => (<Row key={i} icon="−" color="#c47070" text={`${b.buyerName} (原 ${b.qty} 張)`} sub={`@${b.eventName}`} explained={b.explained} expl={b.explanation}/>))}
            </details>
          )}
          {/* 張數減少 */}
          {diff.qtyDecreases.length > 0 && (
            <details open style={{ marginBottom:8 }}>
              <summary style={{ fontSize:13,fontWeight:700,padding:"6px 0",color:"#c47070",cursor:"pointer" }}>📉 張數減少 ({diff.qtyDecreases.length})</summary>
              {diff.qtyDecreases.map((q, i) => (<Row key={i} icon="↓" color="#c47070" text={`${q.buyerName}:${q.prevQty}→${q.currQty} 張`} sub={`@${q.eventName} · 少 ${q.prevQty - q.currQty} 張`} explained={q.explained} expl={q.explanation}/>))}
            </details>
          )}
          {diff.eventsAdded.length + diff.eventsRemoved.length + diff.buyersAdded.length + diff.buyersRemoved.length + diff.qtyDecreases.length === 0 && (
            <div style={{ padding:"30px 20px",textAlign:"center",color:"#999",fontSize:13 }}>沒有差異 ✓</div>
          )}
        </div>

        <div style={{ display:"flex",gap:8,marginTop:12,justifyContent:"flex-end",borderTop:"1px solid #f0ede8",paddingTop:12 }}>
          <button onClick={onClose} style={{ padding:"8px 18px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:13,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>關閉</button>
        </div>
      </div>
    </div>
  );
}

// ─── 實名連結:產生 32 字元 URL-safe token ───
function generateRealnameToken() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < 32; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

// ─── 訂購人實名填寫頁 (供有 token 連結的訂購人填寫,完全獨立於主 app) ───
function RealnameFormPage({ token }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [eventInfo, setEventInfo] = useState(null);
  const [identities, setIdentities] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // 模式:"buyer" 填 identities; "identity" 填某個 identity 底下的 subItems(細項實名)
  const [mode, setMode] = useState("buyer");

  useEffect(() => { loadByToken(); /* eslint-disable-next-line */ }, [token]);

  async function loadByToken() {
    setLoading(true);
    setError(null);
    try {
      if (!SUPABASE_READY) throw new Error("系統未配置雲端資料庫");
      const res = await loadFromSupabase();
      if (!res || !res.payload) throw new Error("無法載入資料");
      const events = res.payload.events || [];
      let foundEvent = null, foundBuyer = null, foundIdentity = null;
      // 先找 buyer-level token,再找 identity-level token
      for (const evt of events) {
        for (const b of (evt.buyers || [])) {
          if (b.realnameToken === token) { foundEvent = evt; foundBuyer = b; break; }
          for (const it of (b.identities || [])) {
            if (it.realnameToken === token) { foundEvent = evt; foundBuyer = b; foundIdentity = it; break; }
          }
          if (foundBuyer) break;
        }
        if (foundBuyer) break;
      }
      if (!foundBuyer) { setError("連結無效或已被刪除"); setLoading(false); return; }

      const tixOnly = foundEvent.tixOnly !== false;
      if (foundIdentity) {
        // identity-level token:填細項實名 (subItems)
        setMode("identity");
        const totalQty = foundIdentity.qty || 1;
        setEventInfo({ eventName: foundEvent.name, buyerName: foundBuyer.name, identityName: foundIdentity.name, totalQty, tixOnly });
        const existing = foundIdentity.subItems || [];
        if (existing.length > 0) {
          setIdentities(existing.map(it => ({ ...it })));
        } else {
          const blanks = [];
          for (let i = 0; i < totalQty; i++) {
            blanks.push({ id: `tmp_${i}_${Math.random().toString(36).slice(2,6)}`, name:"", phone:"", idNumber:"", tixAccount:"", loginVia:"", locked:false, memberNo:"", qty:1 });
          }
          setIdentities(blanks);
        }
      } else {
        // buyer-level token (現有行為):填 identities
        setMode("buyer");
        const totalQty = (foundBuyer.batches || []).reduce((s, b) => s + (b.qty || 0), 0) || foundBuyer.qty || 1;
        setEventInfo({ eventName: foundEvent.name, buyerName: foundBuyer.name, totalQty, tixOnly });
        const existing = foundBuyer.identities || [];
        if (existing.length > 0) {
          setIdentities(existing.map(it => ({ ...it })));
        } else {
          const blanks = [];
          for (let i = 0; i < totalQty; i++) {
            blanks.push({ id: `tmp_${i}_${Math.random().toString(36).slice(2,6)}`, name:"", phone:"", idNumber:"", tixAccount:"", loginVia:"", locked:false, memberNo:"", qty:1 });
          }
          setIdentities(blanks);
        }
      }
    } catch (e) {
      setError("載入失敗: " + (e.message || "未知錯誤"));
    } finally {
      setLoading(false);
    }
  }

  const updateField = (idx, field, value) => {
    setIdentities(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };
  const addBlock = () => {
    setIdentities(prev => [...prev, { id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name:"", phone:"", idNumber:"", tixAccount:"", loginVia:"", locked:false, memberNo:"", qty:1 }]);
  };
  const removeBlock = (idx) => {
    setIdentities(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  };

  // 計算總張數
  const totalQtySum = identities.reduce((s, it) => s + (parseInt(it.qty)||1), 0);
  const expectedQty = eventInfo?.totalQty || 0;

  async function handleSubmit(retry = 0) {
    setSaving(true);
    setError(null);
    try {
      const fresh = await loadFromSupabase();
      if (!fresh || !fresh.payload) throw new Error("無法載入");
      const freshEvents = fresh.payload.events || [];
      const submitted = identities.map(it => ({
        ...it,
        name: (it.name||"").trim(),
        idNumber: (it.idNumber||"").trim().toUpperCase(),
        phone: (it.phone||"").trim(),
        tixAccount: (it.tixAccount||"").trim(),
        memberNo: (it.memberNo||"").trim(),
        qty: parseInt(it.qty)||1,
      }));
      let newEvents, submitLog;
      if (mode === "identity") {
        // 找 (eIdx, bIdx, identityId) 並更新 subItems
        let eIdx = -1, bIdx = -1, identityId = null;
        for (let i = 0; i < freshEvents.length; i++) {
          const bs = freshEvents[i].buyers || [];
          for (let j = 0; j < bs.length; j++) {
            const it = (bs[j].identities || []).find(x => x.realnameToken === token);
            if (it) { eIdx = i; bIdx = j; identityId = it.id; break; }
          }
          if (eIdx >= 0) break;
        }
        if (eIdx < 0 || !identityId) { setError("連結已失效"); setSaving(false); return; }
        newEvents = freshEvents.map((evt, i) => {
          if (i !== eIdx) return evt;
          return { ...evt, buyers: (evt.buyers||[]).map((b, j) => {
            if (j !== bIdx) return b;
            return { ...b, identities: (b.identities || []).map(it => it.id !== identityId ? it : { ...it, subItems: submitted }) };
          }) };
        });
        const evName = freshEvents[eIdx].name;
        const buyerName = freshEvents[eIdx].buyers[bIdx].name;
        const identityName = freshEvents[eIdx].buyers[bIdx].identities.find(it => it.id === identityId)?.name || "";
        submitLog = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
          time: Date.now(),
          msg: `📩 【${evName}】${buyerName} → ${identityName} 透過實名連結提交 ${submitted.length} 筆細項實名`,
          snapshot: null,
        };
      } else {
        // buyer mode (現有)
        let eIdx = -1, bIdx = -1;
        for (let i = 0; i < freshEvents.length; i++) {
          const j = (freshEvents[i].buyers || []).findIndex(b => b.realnameToken === token);
          if (j >= 0) { eIdx = i; bIdx = j; break; }
        }
        if (eIdx < 0) { setError("連結已失效"); setSaving(false); return; }
        newEvents = freshEvents.map((evt, i) => {
          if (i !== eIdx) return evt;
          return { ...evt, buyers: (evt.buyers||[]).map((b, j) => j !== bIdx ? b : { ...b, identities: submitted, needRealName: true }) };
        });
        submitLog = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
          time: Date.now(),
          msg: `📩 「${freshEvents[eIdx].buyers[bIdx].name}」透過實名連結提交 ${submitted.length} 筆`,
          snapshot: null,
        };
      }
      const newLogs = [submitLog, ...(fresh.payload.logs || [])].slice(0, 500);
      const newPayload = { ...fresh.payload, events: newEvents, buyerNames: fresh.payload.buyerNames || [], logs: newLogs };
      const result = await saveToSupabase(newPayload, fresh.updatedAt);
      if (result.ok) {
        setSavedAt(new Date());
        setSaving(false);
      } else if (result.reason === "stale" && retry < 3) {
        // 雲端有人改了,重試
        return handleSubmit(retry + 1);
      } else {
        setError("儲存失敗,請稍後再試");
        setSaving(false);
      }
    } catch (e) {
      setError("儲存失敗: " + (e.message || "未知錯誤"));
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight:"100vh",background:"#faf7f0",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"-apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif" }}>
        <div style={{ textAlign:"center",color:"#999",fontSize:14 }}>載入中…</div>
      </div>
    );
  }
  if (error && !eventInfo) {
    return (
      <div style={{ minHeight:"100vh",background:"#faf7f0",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"-apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif" }}>
        <div style={{ background:"#fff",padding:"30px 24px",borderRadius:12,maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,.06)" }}>
          <div style={{ fontSize:36,marginBottom:8 }}>🔒</div>
          <h2 style={{ margin:"0 0 8px",fontSize:18,color:"#8b3a3a" }}>連結無法使用</h2>
          <p style={{ color:"#666",fontSize:13,margin:0 }}>{error}</p>
          <p style={{ color:"#999",fontSize:11,margin:"16px 0 0" }}>請聯絡賣家確認</p>
        </div>
      </div>
    );
  }
  return (
    <div style={{ minHeight:"100vh",background:"#faf7f0",padding:"20px 14px 60px",fontFamily:"-apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif" }}>
      <div style={{ maxWidth:480,margin:"0 auto" }}>
        <div style={{ background:"#fff",padding:"18px 18px 14px",borderRadius:12,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize:11,color:"#888",letterSpacing:1,marginBottom:4 }}>{mode === "identity" ? "細項實名資料填寫" : "票券實名制資料填寫"}</div>
          <h1 style={{ margin:"0 0 10px",fontSize:18,fontWeight:700,color:"#2d2a26",lineHeight:1.3 }}>{eventInfo.eventName}</h1>
          {mode === "identity" ? (
            <>
              <div style={{ fontSize:13,color:"#666" }}>您好 <b style={{color:"#2d2a26"}}>{eventInfo.identityName}</b>,您透過 <b style={{color:"#888"}}>{eventInfo.buyerName}</b> 訂了 <b style={{color:"#b8531a"}}>{eventInfo.totalQty}</b> 張票</div>
              <div style={{ fontSize:11,color:"#888",marginTop:6,lineHeight:1.5 }}>請依下方欄位填寫每位實名人資料(共 {eventInfo.totalQty} 張需要填),送出後會自動儲存。本連結可重複進入修改。</div>
            </>
          ) : (
            <>
              <div style={{ fontSize:13,color:"#666" }}>您好 <b style={{color:"#2d2a26"}}>{eventInfo.buyerName}</b>,共 <b style={{color:"#b8531a"}}>{eventInfo.totalQty}</b> 張票</div>
              <div style={{ fontSize:11,color:"#888",marginTop:6,lineHeight:1.5 }}>請依下方欄位填寫實名資料,送出後會自動儲存。本連結可重複進入修改。</div>
            </>
          )}
        </div>

        {identities.map((it, idx) => (
          <div key={it.id || idx} style={{ background:"#fff",padding:"14px 16px",borderRadius:10,marginBottom:10,boxShadow:"0 1px 6px rgba(0,0,0,.04)" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,paddingBottom:8,borderBottom:"1px solid #f0ece2" }}>
              <span style={{ fontSize:13,fontWeight:700,color:"#b8531a" }}>第 {idx+1} 份實名</span>
              <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                <span style={{ fontSize:11,color:"#888" }}>張數</span>
                <input type="number" min="1" value={it.qty} onChange={e=>updateField(idx, "qty", parseInt(e.target.value)||1)} style={{ width:50,padding:"4px 6px",borderRadius:5,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",textAlign:"center" }}/>
                {identities.length > 1 && <button onClick={()=>removeBlock(idx)} style={{ marginLeft:4,width:24,height:24,borderRadius:5,border:"1px solid #e8c4c4",background:"#fff",cursor:"pointer",fontSize:12,color:"#c47070",fontFamily:"inherit" }} title="刪除這份">×</button>}
              </div>
            </div>
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              <FormField label="真實姓名 *" value={it.name} onChange={v=>updateField(idx,"name",v)} placeholder="與身分證一致"/>
              <FormField label="身分證字號 *" value={it.idNumber} onChange={v=>updateField(idx,"idNumber",v.toUpperCase())} placeholder="A123456789" mono/>
              <FormField label="手機號碼 *" value={it.phone} onChange={v=>updateField(idx,"phone",v)} placeholder="0912345678" mono type="tel"/>
              {eventInfo.tixOnly && <>
                <FormField label="拓元帳號" value={it.tixAccount} onChange={v=>updateField(idx,"tixAccount",v)} placeholder="email 或帳號" mono/>
                <div>
                  <label style={{ fontSize:11,color:"#888",display:"block",marginBottom:3 }}>登入方式</label>
                  <select value={it.loginVia||""} onChange={e=>updateField(idx,"loginVia",e.target.value)} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #d4d0c8",fontSize:13,fontFamily:"inherit",background:"#fff" }}>
                    <option value="">— 請選 —</option>
                    <option value="facebook">Facebook</option>
                    <option value="google">Google</option>
                  </select>
                </div>
                <FormField label="會員編號" value={it.memberNo} onChange={v=>updateField(idx,"memberNo",v)} placeholder="如有請填,沒有可空" mono/>
                <label style={{ display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#666",cursor:"pointer",paddingTop:2 }}>
                  <input type="checkbox" checked={!!it.locked} onChange={e=>updateField(idx,"locked",e.target.checked)} style={{ width:16,height:16,cursor:"pointer" }}/>
                  此拓元帳號目前被鎖定 🔒
                </label>
              </>}
            </div>
          </div>
        ))}

        <button onClick={addBlock} style={{ width:"100%",padding:"10px",borderRadius:8,border:"1px dashed #c4b89a",background:"#fff9ec",fontSize:13,cursor:"pointer",color:"#8b6a2d",fontWeight:600,fontFamily:"inherit",marginBottom:14 }}>+ 新增一份實名</button>

        {totalQtySum !== expectedQty && (
          <div style={{ background:"#fff0eb",border:"1px solid #e0a890",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#8b3a3a",marginBottom:12 }}>
            ⚠ 目前總張數 {totalQtySum} 張,跟訂購的 {expectedQty} 張不符。送出前請確認張數。
          </div>
        )}

        {error && <div style={{ background:"#fff0eb",border:"1px solid #e0a890",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#8b3a3a",marginBottom:12 }}>{error}</div>}

        <button onClick={()=>handleSubmit(0)} disabled={saving} style={{ width:"100%",padding:"14px",borderRadius:10,border:"none",background:saving?"#999":"#b8531a",color:"#fff",fontSize:15,cursor:saving?"wait":"pointer",fontWeight:700,fontFamily:"inherit",boxShadow:"0 4px 12px rgba(184,83,26,.25)" }}>
          {saving?"儲存中…":(savedAt?"✓ 已儲存 · 點此再次更新":"💾 送出 / 更新資料")}
        </button>

        {savedAt && (
          <div style={{ marginTop:10,padding:"10px 14px",background:"#e8f0e8",border:"1px solid #b8d4b8",borderRadius:8,fontSize:12,color:"#4a7a4a",textAlign:"center" }}>
            ✓ 已成功儲存 ({savedAt.toLocaleTimeString("zh-TW",{hour12:false})})
          </div>
        )}

        <div style={{ marginTop:30,textAlign:"center",fontSize:10,color:"#bbb",letterSpacing:1 }}>實名資料僅供票券登記用</div>
      </div>
    </div>
  );
}

// 小元件:單一欄位
function FormField({ label, value, onChange, placeholder, mono = false, type = "text" }) {
  return (
    <div>
      <label style={{ fontSize:11,color:"#888",display:"block",marginBottom:3 }}>{label}</label>
      <input type={type} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #d4d0c8",fontSize:13,fontFamily:mono?"ui-monospace, monospace":"inherit",background:"#fff",boxSizing:"border-box" }}/>
    </div>
  );
}

// ─── 主 app 內顯示「實名連結」的 modal ───
function RealnameLinkModal({ event, buyer, onClose, onRegenerate }) {
  const [copied, setCopied] = useState(null);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}${window.location.pathname}?fill=${buyer.realnameToken}`
    : `?fill=${buyer.realnameToken}`;
  const totalQty = (buyer.batches || []).reduce((s, b) => s + (b.qty || 0), 0) || buyer.qty || 1;
  const lineMsg = `Hi ${buyer.name},您訂的「${event.name}」共 ${totalQty} 張票,請點下方連結填寫實名資料:
${url}

填寫完即可關閉,資料會自動同步。`;

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(()=>setCopied(null), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setCopied(key); setTimeout(()=>setCopied(null), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:14,padding:"20px 22px",width:"100%",maxWidth:520,boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <h3 style={{ margin:"0 0 4px",fontSize:16,fontWeight:700 }}>🔗 實名連結 — {buyer.name}</h3>
        <div style={{ fontSize:12,color:"#888",marginBottom:14 }}>{event.name} · 共 {totalQty} 張</div>

        <div style={{ fontSize:11,color:"#888",marginBottom:4 }}>專屬連結（請只傳給此訂購人）</div>
        <div style={{ display:"flex",gap:6,marginBottom:12 }}>
          <input readOnly value={url} onFocus={e=>e.target.select()} style={{ flex:1,padding:"8px 10px",borderRadius:7,border:"1px solid #d4d0c8",fontSize:11,fontFamily:"ui-monospace, monospace",background:"#faf9f6",color:"#555" }}/>
          <button onClick={()=>copyText(url, "url")} style={{ padding:"8px 14px",borderRadius:7,border:"none",background:copied==="url"?"#5a7a5a":"#2d2a26",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"inherit",whiteSpace:"nowrap" }}>{copied==="url"?"✓ 已複製":"📋 複製"}</button>
        </div>

        <div style={{ fontSize:11,color:"#888",marginBottom:4 }}>建議 LINE 訊息（含連結）</div>
        <div style={{ display:"flex",gap:6,marginBottom:14 }}>
          <textarea readOnly value={lineMsg} onFocus={e=>e.target.select()} rows={4} style={{ flex:1,padding:"8px 10px",borderRadius:7,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6",color:"#555",resize:"vertical" }}/>
          <button onClick={()=>copyText(lineMsg, "msg")} style={{ padding:"8px 14px",borderRadius:7,border:"none",background:copied==="msg"?"#5a7a5a":"#2d2a26",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"inherit",whiteSpace:"nowrap",alignSelf:"flex-start" }}>{copied==="msg"?"✓ 已複製":"📋 複製"}</button>
        </div>

        <div style={{ background:"#fff9ec",border:"1px solid #e4d4a0",borderRadius:7,padding:"8px 12px",fontSize:11,color:"#7a6028",marginBottom:14,lineHeight:1.6 }}>
          ⚠ 此連結是 <b>{buyer.name}</b> 專屬,請勿傳給其他人<br/>
          ✓ 連結可重複進入修改,訂購人填完資料會自動同步到 app
        </div>

        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",gap:8 }}>
          <button onClick={onRegenerate} title="作廢舊連結,產一個新的(舊連結會立刻失效)" style={{ padding:"7px 12px",borderRadius:7,border:"1px solid #e0a890",background:"#fff",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b3a3a",fontFamily:"inherit" }}>🔄 重新產生</button>
          <button onClick={onClose} style={{ padding:"8px 22px",borderRadius:8,border:"none",background:"#2d2a26",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>完成</button>
        </div>
      </div>
    </div>
  );
}

// ─── 識別人(代購層) 細項實名連結 Modal ───
function IdentityRealnameLinkModal({ event, buyer, identity, onClose, onRegenerate }) {
  const [copied, setCopied] = useState(null);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}${window.location.pathname}?fill=${identity.realnameToken}`
    : `?fill=${identity.realnameToken}`;
  const identityQty = identity.qty || 1;
  const lineMsg = `Hi ${identity.name||"代購"},您透過 ${buyer.name} 訂的「${event.name}」共 ${identityQty} 張票,請點下方連結填寫實名資料:
${url}

填寫完即可關閉,資料會自動同步。`;

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key); setTimeout(()=>setCopied(null), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setCopied(key); setTimeout(()=>setCopied(null), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:14,padding:"20px 22px",width:"100%",maxWidth:520,boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <h3 style={{ margin:"0 0 4px",fontSize:16,fontWeight:700 }}>🔗 細項實名連結 — {identity.name||"(未命名)"}</h3>
        <div style={{ fontSize:12,color:"#888",marginBottom:14 }}>{event.name} · 透過 {buyer.name} · 共 {identityQty} 張</div>

        <div style={{ fontSize:11,color:"#888",marginBottom:4 }}>專屬連結 — 只傳給代購本人 ({identity.name||"未命名"})</div>
        <div style={{ display:"flex",gap:6,marginBottom:12 }}>
          <input readOnly value={url} onFocus={e=>e.target.select()} style={{ flex:1,padding:"8px 10px",borderRadius:7,border:"1px solid #d4d0c8",fontSize:11,fontFamily:"ui-monospace, monospace",background:"#faf9f6",color:"#555" }}/>
          <button onClick={()=>copyText(url, "url")} style={{ padding:"8px 14px",borderRadius:7,border:"none",background:copied==="url"?"#5a7a5a":"#2d2a26",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"inherit",whiteSpace:"nowrap" }}>{copied==="url"?"✓ 已複製":"📋 複製"}</button>
        </div>

        <div style={{ fontSize:11,color:"#888",marginBottom:4 }}>建議 LINE 訊息(含連結)</div>
        <div style={{ display:"flex",gap:6,marginBottom:14 }}>
          <textarea readOnly value={lineMsg} onFocus={e=>e.target.select()} rows={4} style={{ flex:1,padding:"8px 10px",borderRadius:7,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6",color:"#555",resize:"vertical" }}/>
          <button onClick={()=>copyText(lineMsg, "msg")} style={{ padding:"8px 14px",borderRadius:7,border:"none",background:copied==="msg"?"#5a7a5a":"#2d2a26",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"inherit",whiteSpace:"nowrap",alignSelf:"flex-start" }}>{copied==="msg"?"✓ 已複製":"📋 複製"}</button>
        </div>

        <div style={{ background:"#fff9ec",border:"1px solid #e4d4a0",borderRadius:7,padding:"8px 12px",fontSize:11,color:"#7a6028",marginBottom:14,lineHeight:1.6 }}>
          ⚠ 此連結是 <b>{identity.name||"代購"}</b> 專屬,請勿傳給其他代購<br/>
          ✓ 代購可填 {identityQty} 筆細項實名(他底下的客人姓名/身分證/電話...),填完自動同步<br/>
          🔒 此連結只能編輯 {identity.name||"此代購"} 自己的細項,看不到其他代購的資料
        </div>

        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",gap:8 }}>
          <button onClick={onRegenerate} title="作廢舊連結,產一個新的(舊連結會立刻失效)" style={{ padding:"7px 12px",borderRadius:7,border:"1px solid #e0a890",background:"#fff",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b3a3a",fontFamily:"inherit" }}>🔄 重新產生</button>
          <button onClick={onClose} style={{ padding:"8px 22px",borderRadius:8,border:"none",background:"#2d2a26",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>完成</button>
        </div>
      </div>
    </div>
  );
}

// ─── 批次匯入實名 — 解析 helpers ───
const normalizePhoneForImport = (raw) => {
  if (raw === undefined || raw === null) return "";
  let p = String(raw).replace(/[\s\-+()]/g, ""); // 去掉空白/橫線/+/括號
  if (p.startsWith("886")) p = "0" + p.slice(3);
  if (/^9\d{8}$/.test(p)) p = "0" + p; // Google Sheet 砍 0 的補回來
  return p;
};
const normalizeLoginForImport = (raw) => {
  if (!raw) return "";
  const v = String(raw).trim().toLowerCase();
  if (["facebook","fb","f","臉書"].includes(v)) return "facebook";
  if (["google","g","gmail","谷歌"].includes(v)) return "google";
  return "";
};
const normalizeLockedForImport = (raw) => {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim().toLowerCase();
  return ["是","✓","✔","true","1","y","yes","lock","鎖","已鎖"].includes(v);
};
// 合併場次 Modal — 把目前場次併入另一個場次
function MergeEventModal({ fromEvent, allEvents, onClose, onConfirm }) {
  const [targetId, setTargetId] = useState("");
  const candidates = useMemo(() => {
    // 排除自己,排除已完成的;按名字相似度 + 字數差排序(同名最前)
    const fromNorm = (fromEvent.name || "").trim().toLowerCase();
    return (allEvents || [])
      .filter(e => e.id !== fromEvent.id)
      .map(e => {
        const eNorm = (e.name || "").trim().toLowerCase();
        const exact = eNorm === fromNorm;
        const contains = !exact && (eNorm.includes(fromNorm) || fromNorm.includes(eNorm));
        const totalQ = (e.buyers || []).reduce((s, b) => s + (b.qty || 0), 0);
        return { ...e, _exact: exact, _contains: contains, _totalQ: totalQ };
      })
      .sort((a, b) => {
        if (a._exact !== b._exact) return a._exact ? -1 : 1;
        if (a._contains !== b._contains) return a._contains ? -1 : 1;
        return (a.name||"").localeCompare(b.name||"", "zh-TW");
      });
  }, [fromEvent, allEvents]);
  const fromQ = (fromEvent.buyers || []).reduce((s, b) => s + (b.qty || 0), 0);
  const targetEvt = candidates.find(e => e.id === targetId);
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:12,padding:"20px 22px",maxWidth:560,width:"100%",maxHeight:"85vh",overflow:"auto",boxShadow:"0 8px 30px rgba(0,0,0,.2)",fontFamily:"inherit" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}>
          <h3 style={{ margin:0,fontSize:16,fontWeight:700,color:"#2d2a26" }}>🔗 合併場次</h3>
          <button onClick={onClose} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#999",lineHeight:1 }}>×</button>
        </div>
        <p style={{ fontSize:12,color:"#666",margin:"0 0 14px",lineHeight:1.6 }}>
          要把【<b style={{color:"#b8531a"}}>{fromEvent.name}</b>】({fromQ} 張) 併入哪一個場次?<br/>
          <span style={{ color:"#888" }}>合併後同名訂購人會自動合 batches + identities,本場次會被刪除。</span>
        </p>
        <div style={{ marginBottom:12 }}>
          <span style={{ fontSize:11,color:"#888",marginBottom:6,display:"block" }}>選擇要併入的場次:</span>
          <select value={targetId} onChange={e=>setTargetId(e.target.value)}
            style={{ width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid #c4b89a",fontSize:13,fontFamily:"inherit",background:"#fffdf5" }}>
            <option value="">(請選擇)</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>
                {c._exact ? "⭐ " : c._contains ? "🔸 " : ""}{c.name} · {c._totalQ} 張 · {c.status === "done" ? "已完成" : c.status === "picked" ? "已取票" : "進行中"}
              </option>
            ))}
          </select>
        </div>
        {targetEvt && (
          <div style={{ padding:"10px 12px",background:"#f5f0e0",borderRadius:7,marginBottom:14,fontSize:12,color:"#5a4a2a",lineHeight:1.6 }}>
            <b>合併預覽:</b><br/>
            ・「{fromEvent.name}」<b style={{color:"#b8531a"}}>{fromQ}</b> 張 → 併入「{targetEvt.name}」<b>{targetEvt._totalQ}</b> 張<br/>
            ・合併後「{targetEvt.name}」共 <b style={{color:"#b8531a"}}>{fromQ + targetEvt._totalQ}</b> 張<br/>
            ・同名訂購人會自動合併(例:妙 18 + 妙 110 = 妙 128)<br/>
            ・原本的「{fromEvent.name}」場次會刪除
          </div>
        )}
        <div style={{ display:"flex",gap:8 }}>
          <button onClick={onClose} style={{ flex:1,padding:"9px 14px",borderRadius:7,border:"1px solid #d4d0c8",background:"#faf9f6",cursor:"pointer",fontSize:12,fontWeight:700,color:"#666",fontFamily:"inherit" }}>取消</button>
          <button disabled={!targetId} onClick={()=>{onConfirm(targetId);onClose();}}
            style={{ flex:2,padding:"9px 14px",borderRadius:7,border:"1px solid #5a8055",background:targetId?"#e6f0e0":"#eee",cursor:targetId?"pointer":"not-allowed",fontSize:12,fontWeight:700,color:targetId?"#3a5a35":"#aaa",fontFamily:"inherit",opacity:targetId?1:.5 }}>✓ 確認合併</button>
        </div>
      </div>
    </div>
  );
}

// 批次供應方快編 Modal — 點 buyer 上方的「佩盈姐 110」badge 開啟
function BatchSupplierEditor({ event, buyer, onChange, onClose }) {
  // 從整場次蒐集已知上游(給下拉用)
  const knownSuppliers = useMemo(() => {
    const set = new Set();
    (event.buyers || []).forEach(bb => {
      (bb.batches || []).forEach(bt => {
        const m = (bt.detail || "").match(/([^\s·]+?)供/);
        if (m) set.add(m[1]);
      });
      (bb.identities || []).forEach(it => { if (it.supplier) set.add(it.supplier); });
    });
    return Array.from(set).sort((a,b)=>a.localeCompare(b, "zh-TW"));
  }, [event]);
  const batches = buyer.batches || [];
  const getSup = (detail) => {
    const m = (detail || "").match(/([^\s·]+?)供/);
    return m ? m[1] : "";
  };
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:12,padding:"20px 22px",maxWidth:520,width:"100%",maxHeight:"80vh",overflow:"auto",boxShadow:"0 8px 30px rgba(0,0,0,.2)",fontFamily:"inherit" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
          <h3 style={{ margin:0,fontSize:16,fontWeight:700,color:"#2d2a26" }}>📦 編輯各批次上游 — {buyer.name}</h3>
          <button onClick={onClose} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#999",lineHeight:1 }}>×</button>
        </div>
        <p style={{ fontSize:12,color:"#888",margin:"0 0 14px",lineHeight:1.5 }}>每筆分批可獨立設定上游。改完關掉視窗就好,會即時存。<br/>例:同一批 10 張可分成「君儀姐 6 + 佩盈姐 4」 → 各自分批設定。</p>
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {batches.map((bt, bi) => {
            const cur = getSup(bt.detail);
            const otherDetail = (bt.detail || "").replace(/[^\s·]+?供\s*/g, "").trim();
            return (
              <div key={bi} style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"#faf9f6",borderRadius:7,border:"1px solid #e4e0d8",flexWrap:"wrap" }}>
                <span style={{ fontSize:12,fontWeight:700,color:"#666",minWidth:60 }}>分批 #{bi+1}</span>
                <span style={{ fontSize:12,color:"#555" }}><b>{bt.qty || 0}</b> 張</span>
                <span style={{ fontSize:10,color:"#aaa" }}>·</span>
                <span style={{ fontSize:11,color:"#888" }}>上游:</span>
                <select value={cur} onChange={e=>onChange(bi, e.target.value)}
                  style={{ padding:"4px 8px",borderRadius:5,border:"1px solid #c4b89a",fontSize:12,fontFamily:"inherit",background:"#fff",cursor:"pointer" }}>
                  <option value="">(未設定)</option>
                  {knownSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
                  {cur && !knownSuppliers.includes(cur) && <option value={cur}>{cur}</option>}
                </select>
                <input value={cur} onChange={e=>onChange(bi, e.target.value)} placeholder="或自填新上游" style={{ padding:"4px 8px",borderRadius:5,border:"1px solid #d4cdb8",fontSize:11,fontFamily:"inherit",background:"#fff",width:100 }}/>
                {otherDetail && <span style={{ fontSize:10,color:"#999",fontStyle:"italic" }}>(另含備註:「{otherDetail}」)</span>}
              </div>
            );
          })}
        </div>
        {batches.length === 0 && <div style={{ fontSize:12,color:"#888",padding:"20px 0",textAlign:"center" }}>還沒有分批 — 先用「＋ 分批」加一筆</div>}
        <div style={{ marginTop:14,padding:"8px 10px",background:"#f5f0e0",borderRadius:6,fontSize:11,color:"#7a6028",lineHeight:1.5 }}>
          💡 想加新上游?關掉此視窗 → 按「<b>＋ 分批</b>」新增一筆 → 再回來這裡選上游
        </div>
        <button onClick={onClose} style={{ marginTop:14,padding:"8px 16px",borderRadius:7,border:"1px solid #d4d0c8",background:"#faf9f6",cursor:"pointer",fontSize:12,fontWeight:700,color:"#666",fontFamily:"inherit",width:"100%" }}>完成</button>
      </div>
    </div>
  );
}

const normalizeQtyForImport = (raw) => {
  const n = parseInt(String(raw||"").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
// 「label:value」格式(從 LINE 貼來的客人原始訊息) → 行物件
const LINE_FIELD_MAP = {
  "姓名": "name",
  "身分證字號": "idNumber", "身份證字號": "idNumber", "身份證": "idNumber", "身分證": "idNumber", "ID": "idNumber", "id": "idNumber",
  "電話": "phone", "手機": "phone", "手機號碼": "phone", "聯絡電話": "phone",
  "拓元帳號": "tixAccount", "拓元": "tixAccount", "帳號": "tixAccount", "Email": "tixAccount", "email": "tixAccount",
  "登入方式": "loginVia", "登入": "loginVia",
  "拿幾張": "qty", "幾張": "qty", "張數": "qty", "數量": "qty", "票數": "qty",
  "代購": "agent", "識別人": "agent", "上層": "agent", "上層代購": "agent", "屬於": "agent",
  "來自": "agentSupplier", "來源": "agentSupplier", "上游": "agentSupplier", "由誰提供": "agentSupplier",
  "會員編號": "memberNo", "會員號": "memberNo", "會員#": "memberNo", "會員": "memberNo",
};
// 「斜線一行式」格式 — 從本 app 的「📋 輸出本場實名」LINE 模式匯出的內容,長這樣:
//   📌 場次名 (X 筆)            ← 場次標頭(可選,會略過)
//   【區段名】                    ← 訂購人 group(可選,連續區段下同一 buyer)
//     姓名:X / 拿 N 張 / 電話:X / 身分證:X / 拓元:X / 登入:X / 會員#:X / 🔒帳號鎖
//     ...
// 每行一個人,欄位用 " / " 分隔,【】裡的名字當訂購人(buyer);可重複貼到不同 app 用 ✓
const parseSlashLineFormat = (rawText, opts = {}) => {
  const ignoreSections = !!opts.ignoreSections;
  const rows = [];
  let currentSection = ''; // 【】 內的訂購人名
  const lines = String(rawText || "").split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('📌')) continue; // 略過場次標題
    // 【區段名】 視為訂購人 — 若 ignoreSections 為 true 則忽略不記
    const sec = line.match(/^[【\[]\s*(.+?)\s*[】\]]\s*$/);
    if (sec) {
      if (!ignoreSections) currentSection = sec[1].trim();
      continue;
    }
    // 用 " / " 切割欄位
    const parts = line.split(/\s*\/\s*/).filter(p => p.trim());
    if (parts.length === 0) continue;
    const person = {};
    let locked = false;
    for (const part of parts) {
      // 「拿 N 張」(無冒號的特殊張數寫法)
      const qm = part.match(/^拿\s*(\d+)\s*張$/);
      if (qm) { person.qty = qm[1]; continue; }
      // 🔒 / 帳號鎖 emoji / 文字
      if (/🔒|帳號鎖|帳號被鎖/.test(part)) { locked = true; continue; }
      // 標準 key:value
      const m = part.match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const val = m[2].trim();
      const mapped = LINE_FIELD_MAP[key];
      if (mapped && !person[mapped]) person[mapped] = val;
    }
    if (person.name) {
      rows.push({
        idx: rows.length,
        raw: line,
        buyer: currentSection,
        agent: '',
        agentSupplier: '',
        name: person.name,
        qty: normalizeQtyForImport(person.qty),
        phone: normalizePhoneForImport(person.phone || ''),
        idNumber: (person.idNumber || '').trim().toUpperCase(),
        tixAccount: (person.tixAccount || '').trim(),
        loginVia: normalizeLoginForImport(person.loginVia || ''),
        memberNo: (person.memberNo || '').trim(),
        locked,
      });
    }
  }
  return rows;
};

const parseLineBlocks = (rawText) => {
  // 用空行分割多個人,每個 block 內依 「key: value」或「key:value」抓取
  const blocks = String(rawText||"").split(/\r?\n\s*\r?\n+/);
  const rows = [];
  blocks.forEach((block, idx) => {
    const person = {};
    block.split(/\r?\n/).forEach(line => {
      // 支援全形冒號(:) + 半形冒號(:)
      const m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/);
      if (!m) return;
      const key = m[1].trim();
      const val = m[2].trim();
      const mapped = LINE_FIELD_MAP[key];
      if (mapped && !person[mapped]) person[mapped] = val;
    });
    if (person.name) {
      rows.push({
        idx: rows.length,
        raw: block.trim(),
        buyer: "", // 訂購人在 LINE 訊息裡通常沒有,由「預設訂購人」補
        agent: (person.agent || "").trim(), // 代購 (identity 層名),若有則此 row 變成 subItem
        agentSupplier: (person.agentSupplier || "").trim(), // 指定要塞到哪個 supplier 的代購(同名代購有多個時用)
        name: person.name,
        qty: normalizeQtyForImport(person.qty),
        phone: normalizePhoneForImport(person.phone || ""),
        idNumber: (person.idNumber || "").trim().toUpperCase(),
        tixAccount: (person.tixAccount || "").trim(),
        loginVia: normalizeLoginForImport(person.loginVia || ""),
        locked: false,
      });
    }
  });
  return rows;
};
// 解析貼上內容:自動偵測是「LINE 原文」還是「試算表 TSV」還是「斜線一行式」
// opts.ignoreSections: 斜線一行式裡的【區段】是否要當訂購人名?(預設 false → 用區段;true → 忽略,改用 defaultBuyer)
const parseImportRows = (rawText, defaultBuyer = "", defaultAgent = "", opts = {}) => {
  if (!rawText || !rawText.trim()) return { rows: [], hasHeader: false, format: "tsv" };
  // 偵測「斜線一行式」: 同行有 "姓名:" + " / " 分隔 (app 本身輸出的 LINE 文字格式)
  const isSlashLine = /姓名\s*[:：][^\n/]*\s\/\s/.test(rawText);
  if (isSlashLine) {
    const rows = parseSlashLineFormat(rawText, { ignoreSections: !!opts.ignoreSections });
    const applied = rows.map(r => ({ ...r, buyer: r.buyer || defaultBuyer.trim(), agent: r.agent || defaultAgent.trim() }));
    return { rows: applied, hasHeader: false, format: "slashline" };
  }
  // 偵測 LINE 區塊格式:文字裡含「姓名:」或「姓名:」且多人用空行分隔
  const isLineFormat = /(^|\n)\s*姓名\s*[:：]/.test(rawText);
  if (isLineFormat) {
    const rows = parseLineBlocks(rawText);
    // 預設訂購人/代購套用到每一列(已填的不蓋過)
    const applied = rows.map(r => ({ ...r, buyer: r.buyer || defaultBuyer.trim(), agent: r.agent || defaultAgent.trim() }));
    return { rows: applied, hasHeader: false, format: "line" };
  }
  // 否則走原本 TSV 解析
  const lines = String(rawText).split(/\r?\n/).map(l => l.replace(/\s+$/,"")).filter(l => l.trim());
  if (lines.length === 0) return { rows: [], hasHeader: false, format: "tsv" };
  const HEADER_KEYWORDS = ["訂購人","姓名","電話","手機","身分證","身份證","拿幾張","張數","拓元","登入","鎖","代購","識別人","來自","來源","上游"];
  const firstCells = lines[0].split("\t");
  const hasHeader = firstCells.some(c => HEADER_KEYWORDS.some(k => c.includes(k)));
  let columnMap, dataLines;
  if (hasHeader) {
    columnMap = {};
    firstCells.forEach((cell, i) => {
      const c = cell.trim();
      if (c.includes("訂購人")) columnMap.buyer = i;
      else if (c.includes("代購") || c.includes("識別人") || (c.includes("上層") && !c.includes("上游"))) columnMap.agent = i;
      else if (c.includes("來自") || c.includes("來源") || c.includes("上游")) columnMap.agentSupplier = i;
      else if (c.includes("姓名")) columnMap.name = i;
      else if (c.includes("拿幾張") || c === "張數") columnMap.qty = i;
      else if (c.includes("電話") || c.includes("手機")) columnMap.phone = i;
      else if (c.includes("身分證") || c.includes("身份證")) columnMap.idNumber = i;
      else if (c.includes("拓元")) columnMap.tixAccount = i;
      else if (c.includes("登入")) columnMap.loginVia = i;
      else if (c.includes("鎖")) columnMap.locked = i;
    });
    dataLines = lines.slice(1);
  } else {
    columnMap = { buyer:0, name:1, qty:2, phone:3, idNumber:4, tixAccount:5, loginVia:6, locked:7 };
    dataLines = lines;
  }
  const rows = dataLines.map((line, idx) => {
    const cells = line.split("\t");
    const get = (k) => columnMap[k] !== undefined ? (cells[columnMap[k]] || "") : "";
    const rawBuyer = get("buyer").trim();
    const rawAgent = columnMap.agent !== undefined ? get("agent").trim() : "";
    const rawAgentSup = columnMap.agentSupplier !== undefined ? get("agentSupplier").trim() : "";
    return {
      idx,
      raw: line,
      buyer: rawBuyer || defaultBuyer.trim(),
      agent: rawAgent || defaultAgent.trim(),
      agentSupplier: rawAgentSup,
      name: get("name").trim(),
      qty: normalizeQtyForImport(get("qty")),
      phone: normalizePhoneForImport(get("phone")),
      idNumber: get("idNumber").trim().toUpperCase(),
      tixAccount: get("tixAccount").trim(),
      loginVia: normalizeLoginForImport(get("loginVia")),
      locked: normalizeLockedForImport(get("locked")),
    };
  });
  return { rows, hasHeader, columnMap, format: "tsv" };
};

// 批次匯入實名 Modal
function BatchImportIdentityModal({ event, onClose, onConfirm }) {
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [assignments, setAssignments] = useState({}); // rowIdx -> 指派的訂購人名(覆寫)
  const [newBuyerNames, setNewBuyerNames] = useState({}); // rowIdx -> 新訂購人名(顯示輸入框時用)
  const [skipped, setSkipped] = useState({}); // rowIdx -> bool
  const [defaultBuyer, setDefaultBuyer] = useState(""); // 預設訂購人(LINE 原文無訂購人欄時必填)
  const [defaultAgent, setDefaultAgent] = useState(""); // 預設代購(識別人層) — 若填,匯入時整批變成這個代購底下的「細項實名」
  const [ignoreSections, setIgnoreSections] = useState(false); // 斜線一行式裡的【區段】是否要當訂購人名?關掉 → 全部用預設訂購人

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // 偵測桌面版的 CSS zoom (1.3),調整 maxHeight 避免上下被切
  const zoomFactor = useMemo(() => {
    if (typeof window === "undefined") return 1;
    try {
      const bodyZoom = parseFloat(window.getComputedStyle(document.body).zoom) || 1;
      const htmlZoom = parseFloat(window.getComputedStyle(document.documentElement).zoom) || 1;
      return bodyZoom * htmlZoom;
    } catch { return 1; }
  }, []);
  const modalMaxHeight = `${Math.floor(88 / zoomFactor)}vh`;

  const doParse = () => {
    const result = parseImportRows(rawText, defaultBuyer, defaultAgent, { ignoreSections });
    setParsed(result);
    setAssignments({});
    setNewBuyerNames({});
    setSkipped({});
  };

  const buyerNamesList = (event.buyers || []).map(b => b.name);
  const matchBuyer = (name) => {
    const target = (name || "").trim().toLowerCase();
    if (!target) return null;
    return (event.buyers || []).find(b => (b.name||"").trim().toLowerCase() === target);
  };

  // 預計算每列狀態
  const processedRows = (parsed?.rows || []).map(r => {
    // 決定 target buyer:優先用 newBuyerName(新增),其次 assignments(覆寫),最後 row.buyer
    const newBn = newBuyerNames[r.idx];
    const ovBn = assignments[r.idx];
    const targetBuyerName = newBn !== undefined ? newBn : (ovBn || r.buyer);
    const matched = newBn !== undefined ? null : matchBuyer(targetBuyerName);
    // 如果是新訂購人模式,只要名字非空就算 ok
    const willCreateNewBuyer = newBn !== undefined && newBn.trim();

    let status = "ok";
    let issue = "";
    if (!r.name) { status = "error"; issue = "缺姓名"; }
    else if (!matched && !willCreateNewBuyer) {
      status = "needAssign";
      issue = r.buyer ? `找不到訂購人「${r.buyer}」` : "缺訂購人";
    }

    // 重複偵測
    let dupInfo = null;
    if (matched) {
      const dup = (matched.identities || []).find(it =>
        (r.idNumber && it.idNumber && it.idNumber.toUpperCase() === r.idNumber) ||
        (r.phone && it.phone && it.phone === r.phone) ||
        (r.name && it.name && it.name === r.name)
      );
      if (dup) dupInfo = `已有相似資料:${dup.name}/${dup.phone||"-"}/${dup.idNumber||"-"}`;
    }

    return { ...r, targetBuyerName, matched, willCreateNewBuyer, status, issue, dupInfo };
  });

  const okCount = processedRows.filter(r => r.status === "ok" && !skipped[r.idx]).length;
  const skippedCount = processedRows.filter(r => skipped[r.idx]).length;
  const needAssignCount = processedRows.filter(r => r.status === "needAssign" && !skipped[r.idx]).length;
  const errorCount = processedRows.filter(r => r.status === "error" && !skipped[r.idx]).length;
  // 重複偵測:有 dupInfo 且還沒被跳過的列數 (可以一鍵跳過)
  const dupCount = processedRows.filter(r => r.dupInfo && !skipped[r.idx]).length;
  const skipAllDups = () => {
    const next = { ...skipped };
    processedRows.forEach(r => { if (r.dupInfo) next[r.idx] = true; });
    setSkipped(next);
  };

  const doConfirm = () => {
    const additions = {};
    processedRows.forEach(r => {
      if (skipped[r.idx]) return;
      if (r.status !== "ok") return;
      const buyerKey = r.matched ? r.matched.name : r.targetBuyerName.trim();
      if (!buyerKey || !r.name) return;
      if (!additions[buyerKey]) additions[buyerKey] = [];
      additions[buyerKey].push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${r.idx}`,
        agent: (r.agent || "").trim(), // 若非空,此筆變成 agent 識別人底下的 subItem;空則照舊變 identity
        agentSupplier: (r.agentSupplier || "").trim(), // 若非空,優先塞到對應 supplier 的代購
        name: r.name,
        phone: r.phone,
        idNumber: r.idNumber,
        tixAccount: r.tixAccount,
        loginVia: r.loginVia,
        locked: r.locked,
        memberNo: r.memberNo || "",
        qty: r.qty,
      });
    });
    onConfirm(additions);
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:16,padding:"20px 22px",width:"100%",maxWidth:760,maxHeight:modalMaxHeight,display:"flex",flexDirection:"column",boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:6 }}>
          <h3 style={{ margin:0,fontSize:17,fontWeight:700 }}>📥 批次匯入實名</h3>
          <span style={{ fontSize:12,color:"#888" }}>{event.name}</span>
        </div>
        <div style={{ fontSize:11,color:"#888",marginBottom:8,lineHeight:1.6 }}>
          支援兩種格式 — 自動偵測:<br/>
          <b style={{color:"#666"}}>📋 試算表 TSV</b>:從 Google Sheet 整批複製;欄位「訂購人/<span style={{color:"#b8531a"}}>代購</span>/姓名/拿幾張/電話/身分證/拓元/登入/鎖」<br/>
          <b style={{color:"#666"}}>💬 LINE 原文</b>:客人直接傳的「姓名: / 電話: / <span style={{color:"#b8531a"}}>代購:</span> / 身分證:...」,多人空行分隔<br/>
          智能修補:電話砍 0、登入方式 FB/Google 都認得 · <b style={{color:"#b8531a"}}>「代購」欄填的話 → 該筆變成「細項實名」放在識別人底下</b>
        </div>
        <div style={{ background:"#f7f3ec",borderRadius:7,padding:"6px 10px",fontSize:11,marginBottom:8,color:"#7a6850" }}>
          此場目前訂購人 ({buyerNamesList.length}):{buyerNamesList.length>0?buyerNamesList.join(", "):"(無)"}
        </div>

        {!parsed ? (
          <>
            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap" }}>
              <span style={{ fontSize:11,color:"#888",whiteSpace:"nowrap" }}>預設訂購人:</span>
              <input value={defaultBuyer} onChange={e=>setDefaultBuyer(e.target.value)} placeholder="整批套用這個訂購人(如「窗口」)" style={{ flex:1,minWidth:140,padding:"6px 10px",borderRadius:6,border:"1px solid #c4b89a",background:"#fffdf5",fontSize:12,fontFamily:"inherit",color:"#5a4a2a" }} list="batch-import-buyer-list"/>
              <datalist id="batch-import-buyer-list">
                {buyerNamesList.map(n => <option key={n} value={n}/>)}
              </datalist>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap" }}>
              <span style={{ fontSize:11,color:"#888",whiteSpace:"nowrap" }}>預設代購:</span>
              <input value={defaultAgent} onChange={e=>setDefaultAgent(e.target.value)} placeholder="(選填)整批變成 XX 識別人底下的細項實名(如「訂購人」)" style={{ flex:1,minWidth:140,padding:"6px 10px",borderRadius:6,border:"1px solid #c4b89a",background:"#fffdf5",fontSize:12,fontFamily:"inherit",color:"#5a4a2a" }}/>
              <span style={{ fontSize:10,color:"#aaa" }} title="不填 = 每筆變成識別人;填了 = 每筆變成這個識別人底下的細項實名">ⓘ</span>
            </div>
            <label style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8,padding:"6px 10px",background:"#fff9ec",borderRadius:6,border:"1px solid #e4d4a0",cursor:"pointer",fontSize:11,color:"#7a6028" }}>
              <input type="checkbox" checked={ignoreSections} onChange={e=>setIgnoreSections(e.target.checked)} style={{ cursor:"pointer",margin:0 }}/>
              <span><b>忽略【區段】訂購人</b> — 斜線一行式裡的【A君】【B君】這種區段都忽略,整批改用「預設訂購人」</span>
            </label>
            <textarea value={rawText} onChange={e=>setRawText(e.target.value)} placeholder="貼 Google Sheet 整批 row,或直接貼 LINE 訊息 (姓名: / 電話: / 身分證:... 多人用空行分隔)" style={{ flex:1,minHeight:220,padding:"10px 12px",borderRadius:8,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"ui-monospace, monospace",background:"#faf9f6",resize:"vertical",lineHeight:1.5 }}/>
            <div style={{ display:"flex",gap:8,marginTop:12,justifyContent:"flex-end" }}>
              <button onClick={onClose} style={{ padding:"8px 16px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:13,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>取消</button>
              <button onClick={doParse} disabled={!rawText.trim()} style={{ padding:"8px 22px",borderRadius:8,border:"none",background:rawText.trim()?"#2d2a26":"#999",color:"#faf9f6",fontSize:13,cursor:rawText.trim()?"pointer":"not-allowed",fontWeight:700,fontFamily:"inherit" }}>🔍 解析預覽</button>
            </div>
          </>
        ) : (
          <>
            {/* 摘要 */}
            <div style={{ background:errorCount+needAssignCount>0?"#fff0eb":"#e8f0e8",borderRadius:8,padding:"8px 12px",fontSize:12,marginBottom:10,border:`1px solid ${errorCount+needAssignCount>0?"#e0a890":"#b8d4b8"}`,display:"flex",alignItems:"center",flexWrap:"wrap",gap:4 }}>
              <span>
                共 {processedRows.length} 筆 · <b style={{color:"#5a7a5a"}}>{okCount} 可匯入</b>
                {needAssignCount>0 && <> · <span style={{color:"#c47070"}}>{needAssignCount} 需指派訂購人</span></>}
                {errorCount>0 && <> · <span style={{color:"#c47070"}}>{errorCount} 缺姓名</span></>}
                {dupCount>0 && <> · <span style={{color:"#c89030"}}>{dupCount} 重複</span></>}
                {skippedCount>0 && <> · <span style={{color:"#999"}}>{skippedCount} 跳過</span></>}
                {parsed.format === "slashline" && <span style={{color:"#5a7a5a",marginLeft:6}}>(斜線一行式 — 含【區段】訂購人)</span>}
                {parsed.format === "line" && <span style={{color:"#5a7a5a",marginLeft:6}}>(LINE 原文)</span>}
                {parsed.format === "tsv" && parsed.hasHeader && <span style={{color:"#5a7a5a",marginLeft:6}}>(TSV 已辨識表頭)</span>}
                {parsed.format === "tsv" && !parsed.hasHeader && <span style={{color:"#5a7a5a",marginLeft:6}}>(TSV 預設順序)</span>}
              </span>
              {dupCount>0 && (
                <button onClick={skipAllDups} title="把所有偵測到重複的列一鍵標為跳過" style={{ marginLeft:"auto",padding:"3px 10px",borderRadius:6,border:"1px solid #c89030",background:"#fffaeb",fontSize:11,cursor:"pointer",fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>⊝ 跳過全部重複 ({dupCount})</button>
              )}
            </div>
            {/* 全部指派 — 一鍵把所有「找不到訂購人」的列指派給選好的訂購人 */}
            {needAssignCount > 0 && buyerNamesList.length > 0 && (
              <div style={{ background:"#fff9ec",borderRadius:7,padding:"6px 10px",fontSize:11,marginBottom:8,border:"1px solid #e4d4a0",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                <span style={{ color:"#7a6028",fontWeight:600 }}>⚡ 全部 {needAssignCount} 筆「找不到」一鍵指派給:</span>
                <select onChange={e => {
                  const v = e.target.value;
                  if (!v) return;
                  const next = { ...assignments };
                  processedRows.forEach(r => { if (r.status === "needAssign" && !skipped[r.idx]) next[r.idx] = v; });
                  setAssignments(next);
                  e.target.value = "";
                }} style={{ padding:"4px 10px",borderRadius:5,border:"1px solid #c4b89a",fontSize:11,fontFamily:"inherit",background:"#fff",cursor:"pointer" }}>
                  <option value="">選訂購人...</option>
                  {buyerNamesList.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {/* row list */}
            <div style={{ flex:1,minHeight:0,overflowY:"auto",border:"1px solid #e4e0d8",borderRadius:8,padding:"4px 8px" }}>
              {processedRows.map(r => {
                const isSkipped = !!skipped[r.idx];
                const bg = isSkipped ? "#f5f5f5" : r.status==="ok" ? "#fff" : r.status==="needAssign" ? "#fffaeb" : "#fff0eb";
                const icon = isSkipped ? "⊝" : r.status==="ok" ? "✓" : r.status==="needAssign" ? "⚠" : "✗";
                const iconColor = isSkipped ? "#bbb" : r.status==="ok" ? "#5a7a5a" : r.status==="needAssign" ? "#c89030" : "#c47070";
                return (
                  <div key={r.idx} style={{ padding:"8px 10px",borderBottom:"1px solid #f5f3ef",background:bg,opacity:isSkipped?0.5:1 }}>
                    <div style={{ display:"flex",alignItems:"baseline",gap:8 }}>
                      <span style={{ fontSize:14,color:iconColor,fontWeight:700,minWidth:14 }}>{icon}</span>
                      <span style={{ fontSize:13,fontWeight:700,minWidth:80 }}>
                        {r.matched ? r.matched.name : (r.willCreateNewBuyer ? `${r.targetBuyerName} ✨新` : (r.buyer || "(無)"))}
                      </span>
                      {r.agent && <span style={{ fontSize:11,color:"#b8531a",fontWeight:700,padding:"1px 6px",background:"#fff5ea",borderRadius:5 }}>↳ {r.agent}</span>}
                      <span style={{ fontSize:12,color:"#888" }}>→</span>
                      <span style={{ fontSize:12,color:"#444" }}>
                        {r.name||<span style={{color:"#c47070"}}>(缺姓名)</span>}
                        {r.qty>1 && <span style={{color:"#888"}}> ×{r.qty}</span>}
                        {r.idNumber && <span style={{color:"#666"}}> · 🆔{r.idNumber}</span>}
                        {r.phone && <span style={{color:"#666"}}> · 📱{r.phone}</span>}
                        {r.tixAccount && <span style={{color:"#666"}}> · 🎫{r.tixAccount}</span>}
                        {r.loginVia && <span style={{color:"#666"}}> · {r.loginVia==="facebook"?"FB":"G"}</span>}
                        {r.locked && <span style={{color:"#8b3a3a"}}> · 🔒</span>}
                      </span>
                      <button onClick={()=>setSkipped(s=>({...s,[r.idx]:!s[r.idx]}))} style={{ marginLeft:"auto",padding:"2px 8px",borderRadius:6,border:"1px solid #d4d0c8",background:"#fff",fontSize:11,cursor:"pointer",color:isSkipped?"#5a7a5a":"#888",fontFamily:"inherit" }}>{isSkipped?"恢復":"跳過"}</button>
                    </div>
                    {r.issue && !isSkipped && (
                      <div style={{ marginTop:6,marginLeft:22,fontSize:11,color:"#c47070" }}>{r.issue}</div>
                    )}
                    {r.status==="needAssign" && !isSkipped && (
                      <div style={{ marginTop:6,marginLeft:22,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" }}>
                        <span style={{ fontSize:11,color:"#888" }}>指派給:</span>
                        <select value={assignments[r.idx]||""} onChange={e=>{setAssignments(a=>({...a,[r.idx]:e.target.value}));setNewBuyerNames(n=>{const c={...n};delete c[r.idx];return c;});}} style={{ padding:"3px 8px",borderRadius:6,border:"1px solid #c4b89a",fontSize:11,fontFamily:"inherit",background:"#fff" }}>
                          <option value="">(請選)</option>
                          {buyerNamesList.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span style={{ fontSize:11,color:"#888" }}>或</span>
                        {newBuyerNames[r.idx] !== undefined ? (
                          <>
                            <input value={newBuyerNames[r.idx]} onChange={e=>setNewBuyerNames(n=>({...n,[r.idx]:e.target.value}))} placeholder="新訂購人名" style={{ padding:"3px 8px",borderRadius:6,border:"1px solid #b8d4b8",fontSize:11,fontFamily:"inherit",background:"#f5faf5",width:120 }} autoFocus/>
                            <button onClick={()=>setNewBuyerNames(n=>{const c={...n};delete c[r.idx];return c;})} style={{ padding:"2px 6px",borderRadius:5,border:"none",background:"transparent",cursor:"pointer",fontSize:11,color:"#888" }}>✕</button>
                          </>
                        ) : (
                          <button onClick={()=>setNewBuyerNames(n=>({...n,[r.idx]:r.buyer||""}))} style={{ padding:"3px 10px",borderRadius:6,border:"1px solid #b8d4b8",background:"#e8f0e8",fontSize:11,cursor:"pointer",fontWeight:600,color:"#4a7a4a",fontFamily:"inherit" }}>+ 新增訂購人</button>
                        )}
                      </div>
                    )}
                    {r.dupInfo && !isSkipped && r.status==="ok" && (
                      <div style={{ marginTop:6,marginLeft:22,fontSize:11,color:"#c89030" }}>⚠ {r.dupInfo}(仍會新增為另一筆)</div>
                    )}
                  </div>
                );
              })}
              {processedRows.length === 0 && <div style={{ padding:30,textAlign:"center",color:"#999",fontSize:13 }}>沒有解析到任何 row</div>}
            </div>
            <div style={{ display:"flex",gap:8,marginTop:12,justifyContent:"space-between",alignItems:"center" }}>
              <button onClick={()=>{setParsed(null);}} style={{ padding:"8px 14px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,color:"#888",fontFamily:"inherit" }}>← 重新貼上</button>
              <div style={{ display:"flex",gap:8 }}>
                <button onClick={onClose} style={{ padding:"8px 16px",borderRadius:8,border:"1px solid #d4d0c8",background:"#fff",fontSize:13,cursor:"pointer",fontWeight:600,color:"#666",fontFamily:"inherit" }}>取消</button>
                <button onClick={doConfirm} disabled={okCount===0} style={{ padding:"8px 22px",borderRadius:8,border:"none",background:okCount>0?"#2d2a26":"#999",color:"#faf9f6",fontSize:13,cursor:okCount>0?"pointer":"not-allowed",fontWeight:700,fontFamily:"inherit" }}>✓ 確認匯入 {okCount} 筆</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 訂購人輸出 Modal:把訂購人清單轉成 LINE 文字 / Excel / CSV
function BuyerExportModal({ buyers, title, onClose }) {
  const [mode, setMode] = useState("text"); // text | sheet | csv
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const totalBuyers = buyers.length;
  const totalOrders = buyers.reduce((s, b) => s + b.orders.length, 0);
  const totalQty = buyers.reduce((s, b) => s + b.totalQty, 0);

  // 從 batches 推算這筆訂單的「主要狀態」
  const orderStatusLabel = (o) => {
    if (!o.batches || o.batches.length === 0) return "";
    const order = ["unpaid","refund","picked","refunded","normal"];
    for (const st of order) {
      const hit = o.batches.filter(x => x.st === st);
      if (hit.length > 0) {
        const qty = hit.reduce((s, x) => s + (x.qty || 0), 0);
        const label = st === "unpaid" ? "未付款" : st === "refund" ? "待退費" : st === "picked" ? "已取票" : st === "refunded" ? "已退款" : "";
        if (label) return `${qty}張${label}`;
      }
    }
    return "";
  };
  const evtStatusLabel = (s) => s === "done" ? "已完成" : s === "picked" ? "已取票" : "進行中";

  // 文字格式(給 LINE,依訂購人分群)
  const textOutput = (() => {
    const lines = [];
    lines.push(`📊 訂購人總覽 (${totalBuyers} 人 · ${totalQty} 張)`);
    lines.push("");
    buyers.forEach(b => {
      const tags = [];
      if (b.unpaidQty > 0) tags.push(`未付${b.unpaidQty}張`);
      if (b.refundCount > 0) tags.push(`待退${b.refundCount}筆`);
      if (b.refundedCount > 0) tags.push(`已退${b.refundedCount}筆`);
      if (b.pickedQty > 0) tags.push(`已取${b.pickedQty}張`);
      const tagStr = tags.length > 0 ? ` [${tags.join(" / ")}]` : "";
      lines.push(`👤 ${b.name} — ${b.totalQty} 張 · ${b.orders.length} 場${tagStr}`);
      b.orders.forEach(o => {
        const extras = [];
        const ost = orderStatusLabel(o);
        if (ost) extras.push(ost);
        if (o.note) extras.push(o.note);
        const extraStr = extras.length > 0 ? ` (${extras.join(" · ")})` : "";
        const sl = evtStatusLabel(o.eventStatus);
        lines.push(`   • ${o.eventName} × ${o.qty}張 [${sl}]${extraStr}`);
      });
      lines.push("");
    });
    return lines.join("\n").trim();
  })();

  // Excel/Sheet 跟 CSV 用 per-order rows
  const headers = ["訂購人","場次","場次狀態","票價","張數","批次明細","備註"];
  const buildRows = () => {
    const rows = [];
    buyers.forEach(b => {
      b.orders.forEach(o => {
        const batchStr = (o.batches || []).map(bt => {
          const lbl = bt.st === "unpaid" ? "未付款" : bt.st === "refund" ? "待退費" : bt.st === "picked" ? "已取票" : bt.st === "refunded" ? "已退款" : "正常";
          return `${bt.qty}張${lbl}${bt.detail?`(${bt.detail})`:""}`;
        }).join(" / ");
        rows.push([b.name, o.eventName, evtStatusLabel(o.eventStatus), o.eventPrice||"", o.qty, batchStr, o.note||""]);
      });
    });
    return rows;
  };

  const sheetOutput = (() => {
    const rows = buildRows();
    return [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
  })();

  const csvOutput = (() => {
    const escape = v => `"${String(v||"").replace(/"/g,'""')}"`;
    const rows = buildRows();
    return [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
  })();

  const currentOutput = mode === "text" ? textOutput : mode === "sheet" ? sheetOutput : csvOutput;

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentOutput);
      setCopied(true);
      setTimeout(()=>setCopied(false), 2000);
    } catch (err) {
      alert("複製失敗,請手動全選複製");
    }
  };

  const doDownload = () => {
    const bom = "﻿";
    const blob = new Blob([bom + csvOutput], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0,10);
    a.download = `訂購人_${title.replace(/[\/:*?"<>|]/g,"_")}_${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff",borderRadius:16,padding:"20px 22px",width:"100%",maxWidth:680,maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
        <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:12 }}>
          <h3 style={{ margin:0, fontSize:17, fontWeight:700 }}>👤 訂購人輸出</h3>
          <span style={{ fontSize:12, color:"#888" }}>{title} · {totalBuyers} 人 · {totalOrders} 筆訂單 · {totalQty} 張</span>
        </div>

        {totalBuyers === 0 ? (
          <div style={{ padding:"40px 20px",textAlign:"center",color:"#999",fontSize:14 }}>沒有訂購人可以輸出</div>
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
              {mode==="text" && "適合貼到 LINE 給客人對帳。每人聚合所有訂單,標出未付/待退/已取等狀態。"}
              {mode==="sheet" && "適合貼到 Excel / Google Sheet。一筆訂單一列(同人多場會展開)。按複製後到表格 Ctrl+V 自動分欄。"}
              {mode==="csv" && "下載 CSV 檔(含 BOM,Excel 開不會亂碼),適合做財務報表或匯入其他系統。"}
            </div>

            <textarea readOnly value={currentOutput} style={{ flex:1,minHeight:240,padding:"10px 12px",borderRadius:8,border:"1px solid #e4e0d8",fontSize:12,fontFamily:"ui-monospace, monospace",background:"#faf9f6",resize:"vertical",lineHeight:1.5 }}/>

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

function IdentityExportModal({ events, title, onClose }) {
  const [mode, setMode] = useState("text"); // text | sheet | csv
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

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

function MainApp() {
  const [events, setEvents] = useState(() => { try { const s = window.localStorage?.getItem?.("tkm-v3"); if (s) return JSON.parse(s); } catch {} return INITIAL_EVENTS; });
  const [buyerNames, setBuyerNames] = useState(() => { try { const s = window.localStorage?.getItem?.("tkm-v3-names"); if (s) return JSON.parse(s); } catch {} return KNOWN_BUYERS; });

  // 自動偵測「4 層 mode」— 若資料中任一識別人有 subItems / realnameToken / supplier → 啟用上游/代購完整 UI
  // 否則回到簡單版面(3 層:Event → Buyer → Identity 作為實名人)
  const is4LayerMode = useMemo(() => {
    return (events || []).some(evt =>
      (evt.buyers || []).some(b =>
        (b.identities || []).some(it =>
          (Array.isArray(it.subItems) && it.subItems.length > 0) ||
          (it.realnameToken && it.realnameToken.length > 0) ||
          (it.supplier && it.supplier.length > 0)
        )
      )
    );
  }, [events]);
  const [tab, setTab] = useState("active");
  const [orderLogSupplierFilter, setOrderLogSupplierFilter] = useState("all"); // "all" | supplier name
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [editingDetail, setEditingDetail] = useState(null);
  const [showLog, setShowLog] = useState(false);
  // 每日自動備份 + 健康監測
  const [dataDiffModal, setDataDiffModal] = useState(null); // 開啟差異對照 modal
  const [dailySnapshots, setDailySnapshots] = useState(() => {
    try { const s = window.localStorage?.getItem?.("tkm-v3-daily"); if (s) return JSON.parse(s); } catch {}
    return {};
  });
  const dailySnapshotCheckedRef = useRef(false);
  const [logs, setLogs] = useState(() => { try { const s = window.localStorage?.getItem?.("tkm-v3-logs"); if (s) return JSON.parse(s); } catch {} return []; });
  const [confirmModal, setConfirmModal] = useState(null);
  const [inputModal, setInputModal] = useState(null);
  const [identityExportModal, setIdentityExportModal] = useState(null); // { events:[evt], title }
  const [importIdentityModal, setImportIdentityModal] = useState(null); // { eventId } 批次匯入實名
  const [realnameLinkModal, setRealnameLinkModal] = useState(null); // { eventId, buyerIdx } 訂購人實名連結

  const openRealnameLink = (eventId, buyerIdx) => {
    const evt = events.find(e => e.id === eventId);
    const b = evt?.buyers?.[buyerIdx];
    if (!evt || !b) return;
    if (!b.realnameToken) {
      // 第一次開:產生 token
      const token = generateRealnameToken();
      updateEvent(eventId, e => {
        e.buyers[buyerIdx] = { ...e.buyers[buyerIdx], realnameToken: token };
        return e;
      });
      addLog(`【${evt.name}】產生「${b.name}」的實名連結`, snap());
    }
    setRealnameLinkModal({ eventId, buyerIdx });
  };

  const regenerateRealnameLink = (eventId, buyerIdx) => {
    const evt = events.find(e => e.id === eventId);
    const b = evt?.buyers?.[buyerIdx];
    if (!evt || !b) return;
    setConfirmModal({
      msg: `確定要重新產生「${b.name}」的實名連結嗎?\n\n舊連結會立刻失效,訂購人需要重新拿新連結才能進入。`,
      onYes: () => {
        const newToken = generateRealnameToken();
        updateEvent(eventId, e => {
          e.buyers[buyerIdx] = { ...e.buyers[buyerIdx], realnameToken: newToken };
          return e;
        });
        addLog(`【${evt.name}】重新產生「${b.name}」的實名連結(舊連結作廢)`, snap());
        setConfirmModal(null);
      }
    });
  };

  // ─── 識別人 (代購層) 的細項實名連結 ───
  const [identityLinkModal, setIdentityLinkModal] = useState(null); // { eventId, buyerIdx, identityId }
  const openIdentityRealnameLink = (eventId, buyerIdx, identityId) => {
    const evt = events.find(e => e.id === eventId);
    const b = evt?.buyers?.[buyerIdx];
    const it = b?.identities?.find(x => x.id === identityId);
    if (!evt || !b || !it) return;
    if (!it.realnameToken) {
      const token = generateRealnameToken();
      updateEvent(eventId, e => {
        e.buyers[buyerIdx] = {
          ...e.buyers[buyerIdx],
          identities: e.buyers[buyerIdx].identities.map(x => x.id === identityId ? { ...x, realnameToken: token } : x),
        };
        return e;
      });
      addLog(`【${evt.name}】${b.name} → 產生「${it.name||"(未命名)"}」的細項實名連結`, snap());
    }
    setIdentityLinkModal({ eventId, buyerIdx, identityId });
  };
  const regenerateIdentityRealnameLink = (eventId, buyerIdx, identityId) => {
    const evt = events.find(e => e.id === eventId);
    const b = evt?.buyers?.[buyerIdx];
    const it = b?.identities?.find(x => x.id === identityId);
    if (!evt || !b || !it) return;
    setConfirmModal({
      msg: `確定要重新產生「${it.name||"(未命名)"}」的細項實名連結嗎?\n\n舊連結會立刻失效。`,
      onYes: () => {
        const newToken = generateRealnameToken();
        updateEvent(eventId, e => {
          e.buyers[buyerIdx] = {
            ...e.buyers[buyerIdx],
            identities: e.buyers[buyerIdx].identities.map(x => x.id === identityId ? { ...x, realnameToken: newToken } : x),
          };
          return e;
        });
        addLog(`【${evt.name}】${b.name} → 重新產生「${it.name||""}」的細項實名連結(舊連結作廢)`, snap());
        setConfirmModal(null);
      }
    });
  };
  const [buyerExportModal, setBuyerExportModal] = useState(null); // { buyers: [...], title }
  const [editingPrice, setEditingPrice] = useState(null);
  const [priceVal, setPriceVal] = useState("");
  const [editingName, setEditingName] = useState(null);
  const [nameVal, setNameVal] = useState("");
  const [addingBatch, setAddingBatch] = useState(null);  // {eventId, idx}
  const [editingBatch, setEditingBatch] = useState(null); // {eventId, idx, bi}
  const [supplierEditModal, setSupplierEditModal] = useState(null); // {eventId, buyerIdx} — 批次供應方快編
  const [mergeEventModal, setMergeEventModal] = useState(null); // {fromEventId}
  const [expandedIdentity, setExpandedIdentity] = useState(null); // identity key
  const [expandedSubItem, setExpandedSubItem] = useState(null); // subItem key
  const [editingCatalogKey, setEditingCatalogKey] = useState(null); // 實名簿正在編輯的 key
  const [timelineFilter, setTimelineFilter] = useState(null); // null = 全部, 否則為 kind 名稱
  const fileInputRef = useRef(null);

  // addLog 限制:只保留最近 10 筆的 snapshot,更舊的丟掉只留 msg
  // 避免 logs 累積太大讓 localStorage 和雲端 payload 爆掉
  const SNAPSHOT_KEEP = 10;
  // localStorage 寫入時更精簡:只保留最近 3 筆 snapshot
  // (因為 localStorage 容量限制 5-10MB,比 Supabase 嚴格)
  const LOCAL_SNAPSHOT_KEEP = 3;
  const addLog = (msg, snapshot) => setLogs(prev => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const newLog = { id, time: Date.now(), msg, snapshot };
    const arr = [newLog, ...prev].slice(0, 500);
    return arr.map((l, idx) => idx < SNAPSHOT_KEEP ? l : { ...l, snapshot: null });
  });
  const snap = () => JSON.parse(JSON.stringify(events));

  // 從每日快照還原
  const restoreFromDaily = (dateKey) => {
    const ds = dailySnapshots[dateKey];
    if (!ds || !ds.payload) return;
    // 預先算 newLogs 才能一次到位 (而不是 addLog + setEvents 分開)
    const restoreLog = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      time: Date.now(),
      msg: `📅 從 ${dateKey} 的每日快照還原`,
      snapshot: snap(),
    };
    const newLogs = [restoreLog, ...(logs||[])].slice(0, 500)
      .map((l, idx) => idx < SNAPSHOT_KEEP ? l : { ...l, snapshot: null });
    const targetEvents = ds.payload.events || [];
    const targetNames = ds.payload.buyerNames || [];
    // 標記被還原的場次都「我動過」,避免 polling 之後把它沖回去
    targetEvents.forEach(e => recordEventAction(e.id, "touch"));
    (events || []).forEach(e => { if (!targetEvents.find(t => t.id === e.id)) recordEventAction(e.id, "delete"); });
    setEvents(targetEvents);
    setBuyerNames(targetNames);
    setLogs(newLogs);
    // 立刻 force-push 上雲,避免被別的同步路徑沖掉
    if (SUPABASE_READY) {
      (async () => {
        savingInFlightRef.current = true;
        try {
          setSyncStatus("saving");
          const force = await saveToSupabase({ events: targetEvents, buyerNames: targetNames, logs: slimLogsForCloud(newLogs) }, null, { force: true });
          if (force.ok) {
            setSyncStatus("saved");
            setLastSyncedAt(force.updatedAt);
            lastSyncedAtRef.current = force.updatedAt;
            lastSavedSignature.current = makeSignature(targetEvents, targetNames, newLogs);
            updateBase({ events: targetEvents, buyerNames: targetNames, logs: newLogs });
          } else { setSyncStatus("error"); }
        } finally { savingInFlightRef.current = false; }
      })();
    }
  };

  // 同步寫 log:只在合併後 events 真的跟當下不同時才記,避免 polling 洗版
  // snapshot 是「當下還沒被覆蓋的版本」,可供「還原中心」倒回
  const logSyncIfChanged = (newEvents, msg) => {
    try {
      const before = stableStringify(events);
      const after = stableStringify(newEvents);
      if (before === after) return;
    } catch {}
    addLog(msg, snap());
  };

  // 同步寫 log helper:回傳「插入 sync log 後」的新 logs 陣列 (pure function)
  // 解決 addLog + setLogs 衝突造成 log 被吃掉的 bug
  // 用法:const newLogs = buildSyncLogs(mergedEvents, msg, mergedLogs); setLogs(newLogs);
  const buildSyncLogs = (newEvents, msg, baseLogs) => {
    try {
      const before = stableStringify(events);
      const after = stableStringify(newEvents);
      if (before === after) return baseLogs;
    } catch {}
    const newLog = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      time: Date.now(),
      msg,
      snapshot: snap(),
    };
    return [newLog, ...(baseLogs || [])].slice(0, 500)
      .map((l, idx) => idx < SNAPSHOT_KEEP ? l : { ...l, snapshot: null });
  };

  // Sync status: 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'offline'
  const [syncStatus, setSyncStatus] = useState(SUPABASE_READY ? "loading" : "offline");
  // 偵測瀏覽器是否離線(navigator.onLine)
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const lastSyncedAtRef = useRef(null);
  const initialLoadDone = useRef(false);
  const saveTimer = useRef(null);
  // 「上次成功同步的內容指紋」——下次想上傳前比對，如果指紋一樣表示「內容沒變」就不上傳
  const lastSavedSignature = useRef(null);
  // 「使用者是否最近有互動」——閒置 5 分鐘以上的視窗不會主動上傳
  const lastInteractionRef = useRef(Date.now());
  // 追蹤「我最近動過哪些場次」,用來在多人協作時做 per-event 決策
  // Map: eventId -> { action: "touch" | "delete", time: ms }
  const eventActionRef = useRef(new Map());
  const recordEventAction = (eventId, action) => {
    if (eventId) eventActionRef.current.set(eventId, { action, time: Date.now() });
  };
  const getRecentEventAction = (eventId) => {
    const rec = eventActionRef.current.get(eventId);
    if (!rec) return null;
    if (Date.now() - rec.time > 5 * 60 * 1000) return null;
    return rec.action;
  };
  const storageWarnedRef = useRef(false);
  const IDLE_MS = 5 * 60 * 1000;
  // STICKY_WINDOW_MS:互動後的「保護期」。期間內衝突一律強制保留本地,不做自動合併,避免被別的裝置/分頁覆寫
  const STICKY_WINDOW_MS = 5 * 60 * 1000; // 5 分鐘

  // 計算總覽:場次/訂購人/張數
  const computeTotals = (evts) => {
    let totalBuyers = 0;
    let totalQty = 0;
    (evts || []).forEach(e => {
      const buyers = e.buyers || [];
      totalBuyers += buyers.length;
      buyers.forEach(b => {
        const bs = Array.isArray(b.batches) && b.batches.length > 0 ? b.batches : [{qty: b.qty || 0}];
        totalQty += bs.reduce((s, x) => s + (x.qty || 0), 0);
      });
    });
    return { totalEvents: (evts || []).length, totalBuyers, totalQty };
  };

  // 把 events/buyerNames/logs 變成一個字串指紋(用 JSON.stringify 簡單夠用)
  // 注意:logs 的 snapshot 欄位在計算指紋時要被剝掉,
  // 因為雲端為了省空間只保留前 CLOUD_SNAPSHOT_KEEP 筆 snapshot,
  // 本地 React state 可能保留更多 → snapshot 不同會讓 sig 永遠不符 → 一直誤判要重新上傳
  const makeSignature = (events, buyerNames, logs) => {
    try {
      const slimLogs = (logs||[]).slice(0,20).map(l => l && l.snapshot ? { ...l, snapshot: null } : l);
      return JSON.stringify({ e: events, n: buyerNames, l: slimLogs });
    } catch { return ""; }
  };

  // 雲端 snapshot 上限:只保留最近 3 筆有 snapshot 的紀錄,避免 payload 接近 Supabase JSONB 限制
  const CLOUD_SNAPSHOT_KEEP = 3;
  const slimLogsForCloud = (logs) =>
    (logs || []).map((l, idx) => idx < CLOUD_SNAPSHOT_KEEP ? l : (l && l.snapshot ? { ...l, snapshot: null } : l));

  // 「目前內容指紋」用 useMemo 快取,避免每次 render 都跑 JSON.stringify 卡頓
  const currentSig = useMemo(() => makeSignature(events, buyerNames, logs), [events, buyerNames, logs]);

  // 上次成功同步時的「基準快照」,用於 3-way merge
  const baseSnapshotRef = useRef(null);
  // 「使用者放棄處理的衝突指紋」——按背景關掉衝突彈窗時記下當下 sig,
  // 在資料下次變動 (sig 改變) 之前不再自動重觸發 save,避免無窮彈窗
  const dismissedConflictSig = useRef(null);
  // 「目前正在送出的上傳」標記——避免 polling/refetch 跟 in-flight save 撞車造成 race
  const savingInFlightRef = useRef(false);

  // 更新 base 同時持久化到 localStorage(避免重新整理後消失)
  const updateBase = (snapshot) => {
    baseSnapshotRef.current = snapshot;
    try {
      window.localStorage?.setItem?.("tkm-v3-base", JSON.stringify(snapshot));
    } catch {
      // base 寫不下就算了,記憶體裡有就好
      // (重新整理後沒有 base 時,載入邏輯會 fallback 用雲端版本當 base)
    }
  };

  // 穩定的 JSON stringify:把 key 排序,避免不同來源資料 key 順序不同造成的誤判衝突
  const stableStringify = (obj) => {
    if (obj === null || obj === undefined) return JSON.stringify(obj);
    if (typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
    const keys = Object.keys(obj).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
  };

  // 比較兩個 event 是否實質相同(用 stable stringify,避免 key 順序差異)
  const eventEqual = (a, b) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    try { return stableStringify(a) === stableStringify(b); } catch { return false; }
  };

  // 用 stable stringify 比對兩個 buyer 是否相同(忽略 key 順序)
  const buyerEqual = (a, b) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    try { return stableStringify(a) === stableStringify(b); } catch { return false; }
  };

  // buyer-level 3-way merge:兩台改同場次的不同訂購人 → 自動合併
  // 回傳 { mergedBuyers, hasConflict } - hasConflict=true 表示 buyer 本身有衝突無法自動合併
  const mergeBuyers = (myBuyers, baseBuyers, remoteBuyers) => {
    const baseByName = new Map((baseBuyers||[]).map(b => [b.name, b]));
    const myByName = new Map((myBuyers||[]).map(b => [b.name, b]));
    const remoteByName = new Map((remoteBuyers||[]).map(b => [b.name, b]));
    const allNames = new Set([...myByName.keys(), ...remoteByName.keys(), ...baseByName.keys()]);
    const merged = [];
    let hasConflict = false;

    for (const name of allNames) {
      const my = myByName.get(name);
      const base = baseByName.get(name);
      const remote = remoteByName.get(name);

      if (!my && !remote) continue;
      if (my && !remote) {
        if (!base) { merged.push(my); continue; } // 我新增
        if (buyerEqual(my, base)) continue; // 對方刪除,我沒改
        hasConflict = true; merged.push(my); continue;
      }
      if (!my && remote) {
        if (!base) { merged.push(remote); continue; } // 對方新增
        if (buyerEqual(remote, base)) continue; // 我刪除,對方沒改
        hasConflict = true; merged.push(remote); continue;
      }
      const myChanged = !buyerEqual(my, base);
      const remoteChanged = !buyerEqual(remote, base);
      if (!myChanged && !remoteChanged) { merged.push(my); continue; }
      if (myChanged && !remoteChanged) { merged.push(my); continue; }
      if (!myChanged && remoteChanged) { merged.push(remote); continue; }
      if (buyerEqual(my, remote)) { merged.push(my); continue; }
      // 同一訂購人雙方都改 → 真衝突
      hasConflict = true;
      merged.push(my); // 保留我的
    }
    return { mergedBuyers: merged, hasConflict };
  };

  // 3-way merge:合併本地、雲端、基準三方版本
  // 回傳 { merged, conflicts: [{id, name, my, remote}] }
  const mergeEvents = (myEvents, baseEvents, remoteEvents) => {
    const baseById = new Map((baseEvents||[]).map(e => [e.id, e]));
    const myById = new Map((myEvents||[]).map(e => [e.id, e]));
    const remoteById = new Map((remoteEvents||[]).map(e => [e.id, e]));
    const allIds = new Set([...myById.keys(), ...remoteById.keys(), ...baseById.keys()]);
    const merged = [];
    const conflicts = [];

    for (const id of allIds) {
      const my = myById.get(id);
      const base = baseById.get(id);
      const remote = remoteById.get(id);

      // 雙方都刪除 / 都沒有
      if (!my && !remote) continue;

      // 只有一方有
      if (my && !remote) {
        // 我有,對方沒有 -> 可能是我新增 (base 沒有 & my 有) 或對方刪除 (base 有 & my 沒改)
        if (!base) { merged.push(my); continue; } // 我新增
        if (eventEqual(my, base)) continue; // 對方刪除,我沒改 -> 接受刪除
        // 我改了,對方刪了 -> 衝突,保留我的
        conflicts.push({ id, name: my.name, my, remote: null });
        merged.push(my);
        continue;
      }
      if (!my && remote) {
        if (!base) { merged.push(remote); continue; } // 對方新增
        if (eventEqual(remote, base)) continue; // 我刪除,對方沒改 -> 接受刪除
        // 我刪了,對方改了 -> 衝突,保留對方的
        conflicts.push({ id, name: remote.name, my: null, remote });
        merged.push(remote);
        continue;
      }

      // 雙方都有
      const myChanged = !eventEqual(my, base);
      const remoteChanged = !eventEqual(remote, base);

      if (!myChanged && !remoteChanged) { merged.push(my); continue; } // 都沒改
      if (myChanged && !remoteChanged) { merged.push(my); continue; } // 只有我改
      if (!myChanged && remoteChanged) { merged.push(remote); continue; } // 只有對方改
      if (eventEqual(my, remote)) { merged.push(my); continue; } // 雙方改成一樣

      // 雙方都改同場次 → 試 buyer-level 合併
      // 比對非 buyers 的欄位是否相同(name/price/status)
      const stripBuyers = (e) => { const x = {...e}; delete x.buyers; return x; };
      const myMeta = stripBuyers(my);
      const baseMeta = base ? stripBuyers(base) : null;
      const remoteMeta = stripBuyers(remote);
      const metaConflict = baseMeta && !buyerEqual(myMeta, baseMeta) && !buyerEqual(remoteMeta, baseMeta) && !buyerEqual(myMeta, remoteMeta);

      if (!metaConflict) {
        // 場次本身(名稱/價格/狀態)沒衝突 → 試 buyer-level 合併
        const { mergedBuyers, hasConflict } = mergeBuyers(my.buyers||[], base?.buyers||[], remote.buyers||[]);
        if (!hasConflict) {
          // buyer 也沒衝突 → 自動合併成功!
          const mergedEvent = { ...my };
          // meta 用「有改的那邊」
          if (baseMeta && !buyerEqual(myMeta, baseMeta)) Object.assign(mergedEvent, myMeta);
          else if (baseMeta && !buyerEqual(remoteMeta, baseMeta)) Object.assign(mergedEvent, remoteMeta);
          mergedEvent.buyers = mergedBuyers;
          merged.push(mergedEvent);
          continue;
        }
      }

      // 真衝突(meta 衝突或 buyer 衝突無法合併)
      conflicts.push({ id, name: my.name, my, remote });
      merged.push(my); // 預設先用我的
    }
    return { merged, conflicts };
  };

  // 合併 logs:聯集 + 按時間排序 + 去重 + 截前 500 + 只保留最近 30 筆 snapshot
  const mergeLogs = (myLogs, remoteLogs) => {
    const seen = new Set();
    const all = [];
    for (const l of (myLogs||[])) { const k = l.id ? `id:${l.id}` : `${l.time}_${l.msg}`; if (!seen.has(k)) { seen.add(k); all.push(l); } }
    for (const l of (remoteLogs||[])) { const k = l.id ? `id:${l.id}` : `${l.time}_${l.msg}`; if (!seen.has(k)) { seen.add(k); all.push(l); } }
    all.sort((a, b) => b.time - a.time);
    // 截前 500 + 只保留最近 30 筆 snapshot(避免合併後 payload 爆掉)
    return all.slice(0, 500).map((l, idx) => idx < SNAPSHOT_KEEP ? l : { ...l, snapshot: null });
  };

  // 合併 buyerNames:聯集去重
  const mergeBuyerNames = (myNames, remoteNames) => {
    return Array.from(new Set([...(myNames||[]), ...(remoteNames||[])]));
  };

  // 1) On mount: load from Supabase + 智慧合併本地未上傳的修改
  useEffect(() => {
    if (!SUPABASE_READY) { initialLoadDone.current = true; return; }

    // 同步偵測:這台是不是「真.新裝置」(localStorage 從未存過 tkm-v3)
    // 必須在 await 之前做,否則 save useEffect 會搶先把 INITIAL_EVENTS 寫進 localStorage,
    // 之後就分不出到底是新裝置還是被清空過。
    let isFreshDevice = false;
    try {
      const raw = window.localStorage?.getItem?.("tkm-v3");
      if (!raw) isFreshDevice = true;
    } catch { isFreshDevice = true; }

    let cancelled = false;
    (async () => {
      try {
        const res = await loadFromSupabase();
        if (cancelled) return;
        if (res && res.payload) {
          const remoteP = res.payload;
          // 讀取上次同步時記下的 base snapshot(從 localStorage)
          let storedBase = null;
          try {
            const s = window.localStorage?.getItem?.("tkm-v3-base");
            if (s) storedBase = JSON.parse(s);
          } catch {}

          if (isFreshDevice) {
            // ── 真.新裝置 ──
            // 本地 events 是寫死的 INITIAL_EVENTS,完全不是「使用者的修改」。
            // 如果走 merge 邏輯,INITIAL_EVENTS 會被當成「我的新編輯」覆蓋雲端 → 災難。
            // 因此直接吃雲端版本,不做任何合併。
            if (Array.isArray(remoteP.events)) setEvents(remoteP.events);
            if (Array.isArray(remoteP.buyerNames)) setBuyerNames(remoteP.buyerNames);
            if (Array.isArray(remoteP.logs)) setLogs(remoteP.logs);
          } else {
            // ── 本地原本就有資料 ──
            // 比對本地跟雲端 sig
            const localSig = makeSignature(events, buyerNames, logs);
            const remoteSig = makeSignature(remoteP.events||[], remoteP.buyerNames||[], remoteP.logs||[]);

            if (localSig === remoteSig) {
              // 完全一樣 → 直接用雲端版本
              if (Array.isArray(remoteP.events)) setEvents(remoteP.events);
              if (Array.isArray(remoteP.buyerNames)) setBuyerNames(remoteP.buyerNames);
              if (Array.isArray(remoteP.logs)) setLogs(remoteP.logs);
            } else {
              // 本地跟雲端不同 → 本地可能有未上傳的修改,用 mergeEvents 合併。
              // 注意:storedBase 缺失時 fallback 用「本地」當 base,
              // 而不是用「雲端」當 base(那會讓本地版本被誤判成「我的新編輯」 → 覆蓋雲端)。
              // 用本地當 base 的代價是雲端的修改一律會被當成「對方改了」勝出,
              // 比起回朔風險,這是可以接受的退讓。
              const base = storedBase || { events, buyerNames, logs };
              const mergeResult = mergeEvents(events, base.events||[], remoteP.events||[]);
              const mergedNames = mergeBuyerNames(buyerNames, remoteP.buyerNames||[]);
              const mergedLogs = mergeLogs(logs, remoteP.logs||[]);
              const finalLogs = buildSyncLogs(mergeResult.merged, `🔄 開啟 app 時合併雲端與本地`, mergedLogs);
              setEvents(mergeResult.merged);
              setBuyerNames(mergedNames);
              setLogs(finalLogs);
              if (mergeResult.conflicts.length > 0) {
                console.warn("載入時有衝突場次:", mergeResult.conflicts.map(c=>c.name));
              }
            }
          }
          setLastSyncedAt(res.updatedAt);
          lastSyncedAtRef.current = res.updatedAt;
          lastSavedSignature.current = makeSignature(remoteP.events||[], remoteP.buyerNames||[], remoteP.logs||[]);
          updateBase({ events: remoteP.events||[], buyerNames: remoteP.buyerNames||[], logs: remoteP.logs||[] });
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
  }, []);  // 追蹤使用者互動——點擊、按鍵、滑動都算
  useEffect(() => {
    const onInteract = () => { lastInteractionRef.current = Date.now(); };
    window.addEventListener("click", onInteract);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("touchstart", onInteract);
    return () => {
      window.removeEventListener("click", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("touchstart", onInteract);
    };
  }, []);

  // 每日自動備份:初始載入完成後檢查,今天還沒拍就拍一張
  useEffect(() => {
    if (dailySnapshotCheckedRef.current) return;
    if (!initialLoadDone.current) return;
    if ((events || []).length === 0) return; // 沒資料不拍,避免初始化前覆寫好的快照
    dailySnapshotCheckedRef.current = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (dailySnapshots[today]) return; // 今天已拍過
      const totals = computeTotals(events);
      const newSnap = {
        time: Date.now(),
        ...totals,
        // 存 events + buyerNames,不存 logs(節省空間)
        payload: { events: JSON.parse(JSON.stringify(events)), buyerNames: [...buyerNames] },
      };
      const merged = { ...dailySnapshots, [today]: newSnap };
      // 只保留最近 7 天
      const keys = Object.keys(merged).sort().reverse();
      const trimmed = {};
      keys.slice(0, 7).forEach(k => { trimmed[k] = merged[k]; });
      setDailySnapshots(trimmed);
      try { window.localStorage.setItem("tkm-v3-daily", JSON.stringify(trimmed)); }
      catch (e) {
        // 空間滿:嘗試只存 totals 不存 payload
        const slim = {};
        Object.keys(trimmed).forEach(k => {
          const { payload, ...rest } = trimmed[k];
          slim[k] = rest;
        });
        try { window.localStorage.setItem("tkm-v3-daily", JSON.stringify(slim)); } catch {}
      }
    } catch (e) { console.warn("Daily snapshot failed:", e); }
  }, [events, buyerNames, dailySnapshots]);

  // 2) On change: save to localStorage immediately + debounced safe-save to Supabase
  useEffect(() => {
    // localStorage 寫入策略:三層降級避免 quota 滿
    // Level 1:正常寫入(logs 只保留最近 3 筆 snapshot)
    // Level 2:logs 完全不含 snapshot
    // Level 3:只寫 events 和 names,不寫 logs
    const writeLevel1 = () => {
      const slimLogs = (logs || []).map((l, idx) => idx < LOCAL_SNAPSHOT_KEEP ? l : (l.snapshot ? { ...l, snapshot: null } : l));
      window.localStorage.setItem("tkm-v3", JSON.stringify(events));
      window.localStorage.setItem("tkm-v3-names", JSON.stringify(buyerNames));
      window.localStorage.setItem("tkm-v3-logs", JSON.stringify(slimLogs));
    };
    const writeLevel2 = () => {
      const noSnap = (logs || []).map(l => l.snapshot ? { ...l, snapshot: null } : l);
      window.localStorage.setItem("tkm-v3", JSON.stringify(events));
      window.localStorage.setItem("tkm-v3-names", JSON.stringify(buyerNames));
      window.localStorage.setItem("tkm-v3-logs", JSON.stringify(noSnap));
    };
    const writeLevel3 = () => {
      // 最後手段:logs 完全不寫
      try { window.localStorage.removeItem("tkm-v3-logs"); } catch {}
      window.localStorage.setItem("tkm-v3", JSON.stringify(events));
      window.localStorage.setItem("tkm-v3-names", JSON.stringify(buyerNames));
    };
    let storageOk = false;
    try { writeLevel1(); storageOk = true; }
    catch (e1) {
      console.warn("localStorage Level 1 失敗,改用 Level 2:", e1);
      try { writeLevel2(); storageOk = true; }
      catch (e2) {
        console.warn("localStorage Level 2 失敗,改用 Level 3:", e2);
        try { writeLevel3(); storageOk = true; }
        catch (e3) {
          console.warn("localStorage 完全失敗:", e3);
          if (!storageWarnedRef.current) {
            storageWarnedRef.current = true;
            setConfirmModal({
              msg: "⚠️ 本機儲存空間不足!\n\n您的瀏覽器無法在本機保存最新資料。雲端同步仍然正常運作,但建議:\n\n1. 點「💾 匯出備份」存一份檔案\n2. 進「📋 紀錄」按「清除舊快照」釋放空間",
              yesLabel: "知道了",
              onYes: () => setConfirmModal(null),
            });
          }
        }
      }
    }

    if (!SUPABASE_READY || !initialLoadDone.current) return;

    // 防護 1:檢查內容是否真的變了。如果指紋跟上次一樣表示是 React 重新渲染、不是真的改動。
    if (currentSig === lastSavedSignature.current) return; // 內容沒變不上傳

    // 防護 1.4:使用者剛剛點背景關掉了衝突彈窗 → 在資料下次真的變動前不重觸發
    // (一旦 currentSig 變了,自然就 !== dismissedConflictSig,會自動恢復)
    if (dismissedConflictSig.current === currentSig) return;

    // 防護 1.5:衝突彈窗開著時不要繼續上傳,避免覆蓋掉前一個彈窗
    // (彈窗被覆蓋的話前一個衝突狀態會丟失)
    if (confirmModal) {
      // 把 saveTimer 清掉避免 setTimeout 觸發
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      return;
    }

    // 防護 2:檢查使用者是否最近有互動。閒置太久的視窗不主動上傳。
    const idle = Date.now() - lastInteractionRef.current > IDLE_MS;
    if (idle) return; // 閒置中,不上傳

    setSyncStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      savingInFlightRef.current = true;
      try {
      const res = await saveToSupabase({ events, buyerNames, logs: slimLogsForCloud(logs) }, lastSyncedAtRef.current);
      if (res.ok) {
        setSyncStatus("saved");
        setLastSyncedAt(res.updatedAt);
        lastSyncedAtRef.current = res.updatedAt;
        lastSavedSignature.current = currentSig;
        // 更新合併基準為「我剛上傳的版本」
        updateBase({ events, buyerNames, logs });
      } else if (res.reason === "stale" && res.remote && res.remote.payload) {
        // ── 防線 A:剛剛動過 → 逐場智能合併,保留多人協作 ──
        // 對於我最近動過的場次 → 我的版本贏
        // 對於我沒動的場次(可能是員工改的) → 用雲端版本
        // 對於只有雲端有的場次(員工新增的) → 收進來
        // 對於只有本地有的場次(我新增的) → 保留
        // 對於只有本地刪除的場次 → 不要從雲端重新撈回
        if (Date.now() - lastInteractionRef.current < STICKY_WINDOW_MS) {
          const remoteEvents = res.remote.payload.events || [];
          const baseSnap = baseSnapshotRef.current || { events, buyerNames, logs };
          const baseEvents = baseSnap.events || [];
          const remoteById = new Map(remoteEvents.map(e => [e.id, e]));
          const myById = new Map((events || []).map(e => [e.id, e]));
          const baseById = new Map(baseEvents.map(e => [e.id, e]));
          const allIds = new Set([...myById.keys(), ...remoteById.keys()]);
          const smartMerged = [];
          let myWinCount = 0, remoteWinCount = 0, deletedSkipCount = 0;

          for (const id of allIds) {
            const my = myById.get(id);
            const remote = remoteById.get(id);
            const baseE = baseById.get(id);
            const recent = getRecentEventAction(id);

            if (my && remote) {
              // 兩邊都有 → 看我有沒有最近動過
              if (recent === "touch") {
                smartMerged.push(my); // 我動過,我贏
                myWinCount++;
              } else {
                // 沒動過 → 標準 3-way 合併
                const myChanged = !baseE || !eventEqual(my, baseE);
                const remoteChanged = !baseE || !eventEqual(remote, baseE);
                if (myChanged && !remoteChanged) smartMerged.push(my);
                else if (!myChanged && remoteChanged) { smartMerged.push(remote); remoteWinCount++; }
                else if (!myChanged && !remoteChanged) smartMerged.push(my);
                else smartMerged.push(my); // 都改了 → 預設 my,但這場我沒最近動過比較少見
              }
            } else if (my && !remote) {
              smartMerged.push(my); // 我新增的
            } else if (!my && remote) {
              if (recent === "delete") {
                // 我剛刪掉的,雲端不要重新塞回來
                deletedSkipCount++;
              } else {
                smartMerged.push(remote); // 員工新增的場次
                remoteWinCount++;
              }
            }
          }

          // buyerNames 採聯集 (誰新增的都保留)
          const mergedNames = mergeBuyerNames(buyerNames, res.remote.payload.buyerNames || []);
          // logs 採聯集 (雙方的記錄都保留)
          const mergedLogs = mergeLogs(logs, res.remote.payload.logs || []);

          // 預先算未來 sig (含保護 log) 避免 setLogs 觸發迴圈
          const SNAPSHOT_KEEP_LOCAL = 10;
          const detailMsg = remoteWinCount > 0 || deletedSkipCount > 0
            ? `🛡 雲端衝突,智能合併 (我贏 ${myWinCount} 場, 採用雲端 ${remoteWinCount} 場${deletedSkipCount>0?`, 拒收 ${deletedSkipCount} 個雲端版本`:""})`
            : `🛡 偵測雲端衝突,因您 5 分鐘內動過,強制保留本地版本`;
          const newProtectLog = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
            time: Date.now(),
            msg: detailMsg,
            snapshot: snap(),
          };
          const newLogs = [newProtectLog, ...mergedLogs].slice(0, 500)
            .map((l, idx) => idx < SNAPSHOT_KEEP_LOCAL ? l : { ...l, snapshot: null });
          const futureSig = makeSignature(smartMerged, mergedNames, newLogs);
          const fres = await saveToSupabase({ events: smartMerged, buyerNames: mergedNames, logs: slimLogsForCloud(newLogs) }, null, { force: true });
          if (fres.ok) {
            setSyncStatus("saved");
            setLastSyncedAt(fres.updatedAt);
            lastSyncedAtRef.current = fres.updatedAt;
            lastSavedSignature.current = futureSig;
            updateBase({ events: smartMerged, buyerNames: mergedNames, logs: newLogs });
            setEvents(smartMerged); // 把合併結果反映到本地畫面 (員工的非衝突改動也會出現)
            setBuyerNames(mergedNames);
            setLogs(newLogs);
          } else {
            setSyncStatus("error");
          }
          return;
        }
        // ── 防線 A 沒觸發 → 走原本的 3-way merge ──
        // 衝突:雲端有更新的版本。嘗試 3-way merge
        const remoteP = res.remote.payload;
        const remoteTs = res.remote.updatedAt;
        // base 缺失時 fallback 用「本地」而非空陣列,避免空 base 造成的偽衝突
        const base = baseSnapshotRef.current || { events, buyerNames, logs };

        const mergeResult = mergeEvents(events, base.events, remoteP.events || []);
        const mergedNames = mergeBuyerNames(buyerNames, remoteP.buyerNames || []);
        const mergedLogs = mergeLogs(logs, remoteP.logs || []);

        if (mergeResult.conflicts.length === 0) {
          // 沒有真衝突 -> 自動合併並上傳
          const mergedEvents = mergeResult.merged;
          const finalLogs = buildSyncLogs(mergedEvents, `🔄 上傳時偵測到雲端更新,自動合併`, mergedLogs);
          setEvents(mergedEvents);
          setBuyerNames(mergedNames);
          setLogs(finalLogs);
          setSyncStatus("saving");
          // 上傳合併後版本(用 remoteTs 當基準,確保不會再撞)
          const force = await saveToSupabase({ events: mergedEvents, buyerNames: mergedNames, logs: slimLogsForCloud(finalLogs) }, remoteTs);
          if (force.ok) {
            setSyncStatus("saved");
            setLastSyncedAt(force.updatedAt);
            lastSyncedAtRef.current = force.updatedAt;
            lastSavedSignature.current = makeSignature(mergedEvents, mergedNames, finalLogs);
            updateBase({ events: mergedEvents, buyerNames: mergedNames, logs: finalLogs });
          } else {
            // 第二次又撞?稍後重試(下次資料變動時會自動再來)
            setSyncStatus("error");
          }
        } else {
          // 有真衝突:同一個場次雙方都改了。列出衝突場次給使用者看
          const remoteTime = new Date(remoteTs).toLocaleString("zh-TW", { hour12: false });
          const conflictNames = mergeResult.conflicts.map(c => c.name).join("、");
          const safeMergedEvents = mergeResult.merged; // 已套上「我的優先」
          const otherChoiceEvents = mergeResult.merged.map(e => {
            const c = mergeResult.conflicts.find(x => x.id === e.id);
            return c && c.remote ? c.remote : e;
          });
          setSyncStatus("saved");
          setConfirmModal({
            msg: `偵測到衝突!\n\n以下場次你和其他裝置都改過:\n📌 ${conflictNames}\n\n其他人是在 ${remoteTime} 改的。\n\n👉「保留我的」=用我的版本(其他場次自動合併不影響)\n👉「採用對方」=用對方的版本(只針對衝突場次)\n\n建議先「💾 匯出備份」再決定。`,
            yesLabel: "✓ 保留我的",
            noLabel: "↓ 採用對方",
            maxWidth: 460,
            // 背景點擊:記下當下 sig,在資料下次變動前不再重觸發(避免無窮彈窗)
            onDismiss: () => {
              dismissedConflictSig.current = currentSig;
              setConfirmModal(null);
            },
            onYes: () => {
              dismissedConflictSig.current = null;
              setConfirmModal(null);
              (async () => {
                savingInFlightRef.current = true;
                try {
                  setSyncStatus("saving");
                  const finalLogs = buildSyncLogs(safeMergedEvents, `🛡 衝突解決:保留我的版本`, mergedLogs);
                  setEvents(safeMergedEvents);
                  setBuyerNames(mergedNames);
                  setLogs(finalLogs);
                  const force = await saveToSupabase({ events: safeMergedEvents, buyerNames: mergedNames, logs: slimLogsForCloud(finalLogs) }, null, { force: true });
                  if (force.ok) {
                    setSyncStatus("saved");
                    setLastSyncedAt(force.updatedAt);
                    lastSyncedAtRef.current = force.updatedAt;
                    lastSavedSignature.current = makeSignature(safeMergedEvents, mergedNames, finalLogs);
                    updateBase({ events: safeMergedEvents, buyerNames: mergedNames, logs: finalLogs });
                  } else { setSyncStatus("error"); }
                } finally { savingInFlightRef.current = false; }
              })();
            },
            onNo: () => {
              dismissedConflictSig.current = null;
              setConfirmModal(null);
              (async () => {
                savingInFlightRef.current = true;
                try {
                  setSyncStatus("saving");
                  // 注意:此 log 特別重要,因為「採用對方」會把本地資料替換成雲端,容易被誤點
                  const finalLogs = buildSyncLogs(otherChoiceEvents, `🔄 衝突解決:採用對方版本(本地被替換)`, mergedLogs);
                  setEvents(otherChoiceEvents);
                  setBuyerNames(mergedNames);
                  setLogs(finalLogs);
                  const force = await saveToSupabase({ events: otherChoiceEvents, buyerNames: mergedNames, logs: slimLogsForCloud(finalLogs) }, null, { force: true });
                  if (force.ok) {
                    setSyncStatus("saved");
                    setLastSyncedAt(force.updatedAt);
                    lastSyncedAtRef.current = force.updatedAt;
                    lastSavedSignature.current = makeSignature(otherChoiceEvents, mergedNames, finalLogs);
                    updateBase({ events: otherChoiceEvents, buyerNames: mergedNames, logs: finalLogs });
                  } else { setSyncStatus("error"); }
                } finally { savingInFlightRef.current = false; }
              })();
            }
          });
        }
      } else {
        setSyncStatus("error");
      }
      } finally { savingInFlightRef.current = false; }
    }, 800);
  }, [events, buyerNames, logs, confirmModal]);

  // 安全 refetch:用 mergeEvents 智慧合併,保留本地未上傳的修改
  const refetchFromCloud = async () => {
    if (!SUPABASE_READY) return;
    if (savingInFlightRef.current) return; // 正在上傳中,不打擾
    setSyncStatus("loading");
    // 5 秒 timeout 保護,避免 syncStatus 卡住
    const safetyTimer = setTimeout(() => {
      setSyncStatus(prev => prev === "loading" ? "error" : prev);
    }, 5000);
    try {
      const res = await loadFromSupabase();
      clearTimeout(safetyTimer);
      if (res && res.payload) {
        const remoteP = res.payload;
        // 用 mergeEvents 合併,而不是直接覆蓋
        // base 缺失時 fallback 用本地 (而不是空陣列),避免空 base 造成偽衝突
        const base = baseSnapshotRef.current || { events, buyerNames, logs };
        const mergeResult = mergeEvents(events, base.events, remoteP.events || []);
        const mergedNames = mergeBuyerNames(buyerNames, remoteP.buyerNames || []);
        const mergedLogs = mergeLogs(logs, remoteP.logs || []);

        // 如果有衝突,不要靜默覆蓋。把雲端拉下來但保留本地修改(本地優先)
        const finalEvents = mergeResult.merged;
        const finalLogs = buildSyncLogs(finalEvents, `🔄 頁面回前景,合併雲端更新`, mergedLogs);
        setEvents(finalEvents);
        setBuyerNames(mergedNames);
        setLogs(finalLogs);
        setLastSyncedAt(res.updatedAt);
        lastSyncedAtRef.current = res.updatedAt;
        // 「上次同步的版本」記成雲端的版本(不是合併後),
        // 這樣若合併進了本地修改,sig 會跟雲端不同 → 之後 save useEffect 會自動上傳
        lastSavedSignature.current = makeSignature(remoteP.events||[], remoteP.buyerNames||[], remoteP.logs||[]);
        updateBase({ events: remoteP.events||[], buyerNames: remoteP.buyerNames||[], logs: remoteP.logs||[] });
      }
      setSyncStatus("saved");
    } catch (e) {
      clearTimeout(safetyTimer);
      console.warn("refetch failed:", e);
      setSyncStatus("error");
    }
  };

  // 4) 頁面回到前景時:用智慧合併拉雲端,但「正在編輯/正在上傳」時不打斷
  useEffect(() => {
    if (!SUPABASE_READY) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!initialLoadDone.current) return;
      // 正在準備上傳(有 pending changes) → 不要 refetch 覆蓋
      if (saveTimer.current) return;
      // 正在 in-flight 上傳 → 不要打斷
      if (savingInFlightRef.current) return;
      // STICKY_WINDOW_MS 內有互動 → 使用者正在用,不打斷
      if (Date.now() - lastInteractionRef.current < STICKY_WINDOW_MS) return;
      // 衝突彈窗開著 → 不要干擾
      if (confirmModal) return;
      // 使用者正在編輯輸入框 → 不要打斷
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      // 編輯 state 開著(就算 input 沒 focus)→ 不打斷
      if (editingPrice || editingName || editingDetail || addingBatch || editingBatch || inputModal || identityExportModal || editingCatalogKey || buyerExportModal || dataDiffModal || importIdentityModal || realnameLinkModal) return;
      refetchFromCloud();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [events, buyerNames, logs, confirmModal, editingPrice, editingName, editingDetail, addingBatch, editingBatch, inputModal, identityExportModal, editingCatalogKey, buyerExportModal, dataDiffModal, importIdentityModal, realnameLinkModal]);

  // 6) 失敗自動重試:syncStatus 變 error 後 30 秒重試,若仍失敗持續每 30 秒重試
  useEffect(() => {
    if (!SUPABASE_READY) return;
    if (syncStatus !== "error") return;
    let cancelled = false;
    let timer = null;
    const tryRetry = () => {
      if (cancelled) return;
      // 觸發 save useEffect 重試:把 signature 設為 null 強制視為「有變動」
      lastSavedSignature.current = null;
      setLogs(prev => [...prev]); // 微小變動觸發 useEffect
      // 30 秒後若還是 error,再試一次(以新的 useEffect 啟動)
      // 注意:syncStatus 若已恢復 saved/saving,cleanup 會清掉這個 timer
      timer = setTimeout(tryRetry, 30000);
    };
    timer = setTimeout(tryRetry, 30000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [syncStatus]);

  // 7) 多分頁同步:同一瀏覽器開多個分頁時,A 改了東西寫 localStorage,
  // 透過 storage 事件通知 B 分頁立刻重新載入(不用等 30 秒 polling)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e) => {
      // 只關心 tkm-v3 主資料的變動
      if (e.key !== "tkm-v3" || !e.newValue) return;
      // 編輯中、有衝突彈窗、in-flight 上傳、最近有互動 → 不打斷
      if (confirmModal) return;
      if (saveTimer.current || savingInFlightRef.current) return;
      if (Date.now() - lastInteractionRef.current < STICKY_WINDOW_MS) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (editingPrice || editingName || editingDetail || addingBatch || editingBatch || inputModal || identityExportModal || editingCatalogKey || buyerExportModal || dataDiffModal || importIdentityModal || realnameLinkModal) return;
      try {
        const newEvents = JSON.parse(e.newValue);
        let nextLogs = logs;
        // buyerNames / logs 也跟著拉
        const namesStr = window.localStorage.getItem("tkm-v3-names");
        if (namesStr) { try { const nn = JSON.parse(namesStr); if (Array.isArray(nn)) setBuyerNames(nn); } catch {} }
        const logsStr = window.localStorage.getItem("tkm-v3-logs");
        if (logsStr) { try { const ll = JSON.parse(logsStr); if (Array.isArray(ll)) nextLogs = ll; } catch {} }
        if (Array.isArray(newEvents)) {
          // 直接用其他分頁寫入的版本,但插入一筆 sync log
          const finalLogs = buildSyncLogs(newEvents, `🔄 從其他分頁同步`, nextLogs);
          setEvents(newEvents);
          setLogs(finalLogs);
        } else {
          setLogs(nextLogs);
        }
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [confirmModal, editingPrice, editingName, editingDetail, addingBatch, editingBatch, inputModal, identityExportModal, editingCatalogKey, buyerExportModal, dataDiffModal, importIdentityModal, realnameLinkModal]);

  // 5) 定期 polling:每 30 秒自動拉一次雲端,讓多人協作能準即時看到對方修改。
  // 注意:這裡使用 mergeEvents 自動合併,避免覆蓋本地未上傳的修改。
  useEffect(() => {
    if (!SUPABASE_READY) return;
    const POLL_MS = 30 * 1000;
    const timer = setInterval(async () => {
      if (!initialLoadDone.current) return;
      if (document.visibilityState !== "visible") return; // 背景中不 poll
      if (saveTimer.current) return; // 正在準備上傳,跳過這次
      if (savingInFlightRef.current) return; // in-flight 上傳中,跳過這次
      // STICKY_WINDOW_MS 內有互動 → 使用者正在打字/點擊,不打斷,避免雲端覆寫本地修改
      if (Date.now() - lastInteractionRef.current < STICKY_WINDOW_MS) return;
      // 衝突彈窗開著 → 不要干擾
      if (confirmModal) return;
      // 編輯中(input/textarea focus 或 editing state) → 不打斷
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (editingPrice || editingName || editingDetail || addingBatch || editingBatch || inputModal || identityExportModal || editingCatalogKey || buyerExportModal || dataDiffModal || importIdentityModal || realnameLinkModal) return;

      try {
        const res = await loadFromSupabase();
        if (!res || !res.payload) return;
        // 雲端沒變化就跳過
        if (res.updatedAt === lastSyncedAtRef.current) return;

        const remoteP = res.payload;
        // base 缺失時 fallback 用本地,避免空 base 造成偽衝突
        const base = baseSnapshotRef.current || { events, buyerNames, logs };
        // 自動合併:把雲端新內容跟本地未上傳的修改合併
        const mergeResult = mergeEvents(events, base.events, remoteP.events || []);
        const mergedNames = mergeBuyerNames(buyerNames, remoteP.buyerNames || []);
        const mergedLogs = mergeLogs(logs, remoteP.logs || []);

        if (mergeResult.conflicts.length === 0) {
          // 無衝突:靜默合併 (但會在時間軸留下紀錄,方便排查資料變動來源)
          const finalLogs = buildSyncLogs(mergeResult.merged, `🔄 自動同步:雲端有新版本已合併`, mergedLogs);
          setEvents(mergeResult.merged);
          setBuyerNames(mergedNames);
          setLogs(finalLogs);
          setLastSyncedAt(res.updatedAt);
          lastSyncedAtRef.current = res.updatedAt;
          // sig 記成雲端版本(不是合併後),這樣本地修改 + sync log 會被視為「未上傳」自動觸發 save
          lastSavedSignature.current = makeSignature(remoteP.events||[], remoteP.buyerNames||[], remoteP.logs||[]);
          updateBase({ events: remoteP.events||[], buyerNames: remoteP.buyerNames||[], logs: remoteP.logs||[] });
        }
        // 有衝突:讓主要的 save useEffect 在下次資料變動時處理(避免重複彈窗)
      } catch (e) { /* silent */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [events, buyerNames, logs, confirmModal, editingPrice, editingName, editingDetail, addingBatch, editingBatch, inputModal, identityExportModal, editingCatalogKey, buyerExportModal, dataDiffModal, importIdentityModal, realnameLinkModal]);

  const activeEvents = events.filter(e => e.status === "active");
  const pickedEvents = events.filter(e => e.status === "picked");
  const doneEvents = events.filter(e => e.status === "done");
  const displayEvents = tab === "active" ? activeEvents : tab === "picked" ? pickedEvents : doneEvents;
  const filtered = displayEvents.filter(e => { if (!search) return true; const s = search.toLowerCase(); return e.name.toLowerCase().includes(s) || e.buyers?.some(b => b.name.toLowerCase().includes(s)); });
  const totalTickets = activeEvents.reduce((s, e) => s + (e.buyers || []).reduce((a, b) => a + buyerTotalQty(b), 0), 0);
  // 全域總覽(包含已取票、已完成,跟每日快照比較用)
  const allTotals = useMemo(() => computeTotals(events), [events]);

  // 智能差異比對:跟最近快照逐筆比 + 用 log 解釋每個消失/減少
  // 「有對應 log」= 你手動操作,「沒有對應 log」= 真的資料消失
  const dataDiff = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const keys = Object.keys(dailySnapshots).sort().reverse().filter(k => k !== today);
    if (keys.length === 0) return null;
    const prevKey = keys[0];
    const prev = dailySnapshots[prevKey];
    if (!prev.payload) return { prevKey, prev, noPayload: true, alert: false };
    const sinceTime = prev.time;
    const logsSince = (logs || []).filter(l => l.time > sinceTime);

    const prevEvents = prev.payload.events || [];
    const prevById = new Map(prevEvents.map(e => [e.id, e]));
    const currById = new Map((events || []).map(e => [e.id, e]));

    const sumBatches = (b) => {
      const bs = Array.isArray(b.batches) && b.batches.length > 0 ? b.batches : [{qty: b.qty || 0}];
      return bs.reduce((s, x) => s + (x.qty || 0), 0);
    };
    const findLog = (predicate) => logsSince.find(l => predicate(l.msg || ""));

    const eventsAdded = [];
    const eventsRemoved = [];
    const buyersAdded = [];
    const buyersRemoved = [];
    const qtyDecreases = [];

    // 場次 added / removed
    for (const [id, e] of currById) {
      if (!prevById.has(id)) eventsAdded.push({ name: e.name, id });
    }
    for (const [id, e] of prevById) {
      if (!currById.has(id)) {
        const explanation = findLog(m => m.includes(`刪除場次【${e.name}】`));
        eventsRemoved.push({
          name: e.name, id,
          buyerCount: (e.buyers || []).length,
          qty: (e.buyers || []).reduce((s, b) => s + sumBatches(b), 0),
          explained: !!explanation, explanation: explanation?.msg,
        });
      }
    }

    // 共有場次內的 buyer 跟 qty 變動
    for (const [id, currEvt] of currById) {
      const prevEvt = prevById.get(id);
      if (!prevEvt) continue;
      const prevBuyers = new Map((prevEvt.buyers || []).map(b => [b.name, b]));
      const currBuyers = new Map((currEvt.buyers || []).map(b => [b.name, b]));

      for (const [name, b] of currBuyers) {
        if (!prevBuyers.has(name)) buyersAdded.push({ eventName: currEvt.name, buyerName: name, qty: sumBatches(b) });
      }
      for (const [name, b] of prevBuyers) {
        if (!currBuyers.has(name)) {
          const explanation = findLog(m => m.includes(`【${currEvt.name}】移除「${name}」`));
          buyersRemoved.push({
            eventName: currEvt.name, buyerName: name, qty: sumBatches(b),
            explained: !!explanation, explanation: explanation?.msg,
          });
        }
      }
      // qty 減少 (增加不算「資料消失」,只追減少)
      for (const [name, prevB] of prevBuyers) {
        const currB = currBuyers.get(name);
        if (!currB) continue;
        const pq = sumBatches(prevB), cq = sumBatches(currB);
        if (cq < pq) {
          const explanation = findLog(m =>
            m.includes(`【${currEvt.name}】${name}`) // 分批變更 / 新增分批 / 移除分批 都符合
          );
          qtyDecreases.push({
            eventName: currEvt.name, buyerName: name, prevQty: pq, currQty: cq,
            explained: !!explanation, explanation: explanation?.msg,
          });
        }
      }
    }

    const unexplained =
      eventsRemoved.filter(x => !x.explained).length +
      buyersRemoved.filter(x => !x.explained).length +
      qtyDecreases.filter(x => !x.explained).length;

    return {
      prevKey, prev, sinceTime,
      eventsAdded, eventsRemoved, buyersAdded, buyersRemoved, qtyDecreases,
      unexplained, alert: unexplained > 0,
    };
  }, [events, logs, dailySnapshots]);

  // 保留舊 healthCheck 變數名給頂部 banner 用,改成 alias
  const healthCheck = dataDiff;
  const unpaidCount = activeEvents.reduce((s, e) => s + countStatusBatches(e.buyers, "unpaid"), 0);
  const pickedRefundCount = pickedEvents.reduce((s, e) => s + countStatusBatches(e.buyers, "refund"), 0);
  const getEventName = (id) => events.find(e => e.id === id)?.name || "?";

  // Aggregate buyers across all events (for 訂購人 tab)
  const buyersAggregated = useMemo(() => {
    const map = new Map();
    events.forEach(evt => {
      (evt.buyers || []).forEach(b => {
        if (!map.has(b.name)) map.set(b.name, { name: b.name, orders: [], totalQty: 0, unpaidQty: 0, refundCount: 0, refundedCount: 0, pickedQty: 0, supplierTotals: {}, identityNames: new Set() });
        const entry = map.get(b.name);
        const bs = getBatches(b);
        entry.orders.push({ eventId: evt.id, eventName: evt.name, eventStatus: evt.status, eventPrice: evt.price, qty: buyerTotalQty(b), batches: bs, note: b.note, addedAt: b.addedAt });
        bs.forEach(x => {
          entry.totalQty += x.qty;
          if (x.st === "unpaid") entry.unpaidQty += x.qty;
          if (x.st === "refund") entry.refundCount += 1;
          if (x.st === "refunded") entry.refundedCount += 1;
          if (x.st === "picked") entry.pickedQty += x.qty;
          // 累計每個上游的張數
          const m = (x.detail || "").match(/([^\s·]+?)供/);
          if (m) {
            const sup = m[1];
            entry.supplierTotals[sup] = (entry.supplierTotals[sup] || 0) + (x.qty || 0);
          }
        });
        // 收集識別人 + 細項實名的姓名 → 給訂購人分頁的搜尋用
        (b.identities || []).forEach(it => {
          if (it.name) entry.identityNames.add(it.name);
          (it.subItems || []).forEach(si => { if (si.name) entry.identityNames.add(si.name); });
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [events]);

  // 代購(識別人) 跨場次匯總:給訂購人分頁搜尋使用。
  // 結構: { name, totalQty, orders[{eventId, eventName, eventStatus, buyerName, qty, supplier}],
  //         supplierTotals, buyerNames(Set), buyerTotals }
  // 例:萬陽 在「Big bang 台北」妙底下 15 張(君儀)、48 張(佩盈) → totalQty +63
  const identitiesAggregated = useMemo(() => {
    const map = new Map();
    events.forEach(evt => {
      (evt.buyers || []).forEach(b => {
        (b.identities || []).forEach(it => {
          const nm = (it.name || "").trim();
          if (!nm) return;
          if (!map.has(nm)) map.set(nm, { name: nm, totalQty: 0, orders: [], supplierTotals: {}, buyerNames: new Set(), buyerTotals: {} });
          const e = map.get(nm);
          const q = Math.max(0, it.qty || 0);
          e.totalQty += q;
          e.orders.push({ eventId: evt.id, eventName: evt.name, eventStatus: evt.status, buyerName: b.name, qty: q, supplier: it.supplier || "" });
          e.buyerNames.add(b.name);
          e.buyerTotals[b.name] = (e.buyerTotals[b.name] || 0) + q;
          if (it.supplier) e.supplierTotals[it.supplier] = (e.supplierTotals[it.supplier] || 0) + q;
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [events]);

  // 實名資料記憶:依姓名收集歷史紀錄,給 autocomplete 用
  // 結構: Map<name, Array<{phone, idNumber, tixAccount, loginVia, locked}>>
  // 同名但身分證/電話/拓元帳號完全不同 → 視為不同人,各收一筆
  // 注意:不收 memberNo (每場不同) 也不收 qty
  const identityHistory = useMemo(() => {
    const map = new Map();
    // 由新到舊掃 (events 後面通常是後加的),這樣下拉列表新的在前面
    for (let ei = events.length - 1; ei >= 0; ei--) {
      const evt = events[ei];
      for (const b of (evt.buyers || [])) {
        for (const it of (b.identities || [])) {
          const nm = (it.name || "").trim();
          if (!nm) continue;
          if (!map.has(nm)) map.set(nm, []);
          const list = map.get(nm);
          // 去重 key:身分證 + 電話 + 拓元帳號 三項組合
          const dedupKey = `${it.idNumber || ""}|${it.phone || ""}|${it.tixAccount || ""}`;
          if (list.some(x => `${x.idNumber || ""}|${x.phone || ""}|${x.tixAccount || ""}` === dedupKey)) continue;
          list.push({
            phone: it.phone || "",
            idNumber: it.idNumber || "",
            tixAccount: it.tixAccount || "",
            loginVia: it.loginVia || "",
            locked: !!it.locked,
          });
        }
      }
    }
    return map;
  }, [events]);

  // 實名簿:每個獨立的實名資料一筆,附帶引用的場次清單
  // 結構:[{ key, name, phone, idNumber, tixAccount, loginVia, locked, refs: [{eventId, eventName, eventStatus, buyerName, identityId}] }]
  // 用相同的 dedup key (name|idNumber|phone|tixAccount),每個獨立組合一張卡
  const identityCatalog = useMemo(() => {
    const map = new Map();
    (events || []).forEach(evt => {
      (evt.buyers || []).forEach(b => {
        (b.identities || []).forEach(it => {
          const nm = (it.name || "").trim();
          if (!nm) return;
          const key = `${nm}|${it.idNumber || ""}|${it.phone || ""}|${it.tixAccount || ""}`;
          if (!map.has(key)) {
            map.set(key, {
              key,
              name: nm,
              phone: it.phone || "",
              idNumber: it.idNumber || "",
              tixAccount: it.tixAccount || "",
              loginVia: it.loginVia || "",
              locked: !!it.locked,
              refs: [],
            });
          }
          map.get(key).refs.push({
            eventId: evt.id,
            eventName: evt.name,
            eventStatus: evt.status,
            buyerName: b.name,
            identityId: it.id,
          });
        });
      });
    });
    // 依 zh-TW 字母順
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  }, [events]);

  // 批次更新:把 identityCatalog 的某筆改成新值,同步寫進所有引用該筆的 events 中
  // newValues 只動 name / phone / idNumber / tixAccount / loginVia / locked
  // 不動 memberNo (每場不同) 也不動 qty (場次相關)
  const updateIdentityAcrossEvents = (oldKey, newValues) => {
    const entry = identityCatalog.find(e => e.key === oldKey);
    if (!entry) return;
    // 建立 (eventId, identityId) → true 的快查表
    const refSet = new Set(entry.refs.map(r => `${r.eventId}|${r.identityId}`));
    // 只 update 有資料的 newValues 欄位,避免不小心把已填的清空
    const cleanUpdates = {};
    ["name","phone","idNumber","tixAccount","loginVia"].forEach(k => {
      if (newValues[k] !== undefined) cleanUpdates[k] = newValues[k];
    });
    if (newValues.locked !== undefined) cleanUpdates.locked = !!newValues.locked;
    addLog(`📇 批次更新實名「${entry.name}」(${entry.refs.length} 個場次)`, snap());
    // 標記:每個被影響的場次都算我動過
    entry.refs.forEach(r => recordEventAction(r.eventId, "touch"));
    setEvents(prev => prev.map(evt => {
      // 沒被引用就跳過,效能最佳化
      const hasRef = entry.refs.some(r => r.eventId === evt.id);
      if (!hasRef) return evt;
      return {
        ...evt,
        buyers: (evt.buyers || []).map(b => ({
          ...b,
          identities: (b.identities || []).map(it => {
            if (refSet.has(`${evt.id}|${it.id}`)) {
              return { ...it, ...cleanUpdates };
            }
            return it;
          }),
        })),
      };
    }));
  };

  // Order log data: 把所有 batch (買家批次 + 上游進貨批次) 依「訂購日期」分組,給「📅 訂購日曆」分頁用
  // 來源:
  //   1) 上游進貨 (event.supplierBatches) — 從 Excel 匯入,供應商何時送票來
  //   2) 買家批次 (buyer.batches[].addedAt) — 客戶何時下單/分批
  const orderLogData = useMemo(() => {
    const byDate = new Map();
    (events || []).forEach(evt => {
      // 上游進貨批次
      (evt.supplierBatches || []).forEach((sb, sbi) => {
        const ts = sb.addedAt || (sb.date ? new Date(sb.date + "T00:00:00").getTime() : null);
        if (!ts) return;
        const d = new Date(ts);
        if (isNaN(d.getTime())) return;
        const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        if (!byDate.has(dateKey)) byDate.set(dateKey, []);
        byDate.get(dateKey).push({
          source: "supplier",
          eventName: evt.name, eventId: evt.id, eventStatus: evt.status,
          supplier: sb.supplier || "",
          buyerName: sb.supplier || "上游", buyerIdx: -1, batchIdx: sbi,
          qty: sb.qty, st: sb.st || "normal", detail: "上游進貨", ts,
        });
      });
      // 買家批次
      (evt.buyers || []).forEach((b, bi) => {
        const batches = getBatches(b);
        batches.forEach((bt, bti) => {
          const ts = bt.addedAt || b.addedAt || null;
          if (!ts) return;
          const d = new Date(ts);
          if (isNaN(d.getTime())) return;
          const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          if (!byDate.has(dateKey)) byDate.set(dateKey, []);
          // 從 detail 抓上游名字 (例:「君儀姐供」/「待退費 · 佩盈姐供」)
          let supplier = "";
          const supMatch = (bt.detail || "").match(/([^\s·]+?)供/);
          if (supMatch) supplier = supMatch[1];
          byDate.get(dateKey).push({
            source: "buyer",
            eventName: evt.name, eventId: evt.id, eventStatus: evt.status,
            supplier,
            buyerName: b.name, buyerIdx: bi, batchIdx: bti,
            qty: bt.qty, st: bt.st, detail: bt.detail || "", ts
          });
        });
      });
    });
    // 排序:日期由新到舊
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => b.ts - a.ts),
        totalQty: items.reduce((s, x) => s + (x.qty || 0), 0),
        supplierQty: items.filter(x => x.source === "supplier").reduce((s, x) => s + (x.qty || 0), 0),
        buyerQty: items.filter(x => x.source === "buyer").reduce((s, x) => s + (x.qty || 0), 0),
      }));
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
      // 同步相關 (🔄 / 🛡 開頭) 優先比對,避免被下面其他規則匹掉
      if (/^🔄|^🛡/.test(msg))               { kind = "sync";   icon = "🔄"; color = "#5a8aab"; }
      else if (/^新增「/.test(rest))             { kind = "add";    icon = "➕"; color = "#3a7a3a"; }
      else if (/^移除「/.test(rest))        { kind = "remove"; icon = "✖";  color = "#c47070"; }
      else if (/張數/.test(rest))           { kind = "qty";    icon = "🔢"; color = "#4a7aab"; }
      else if (/狀態/.test(rest) || /待退費|已退款|已取票|未付款/.test(rest)) { kind = "status"; icon = "🏷"; color = "#a87830"; }
      else if (/實名|SID|給票|回傳照|帳號鎖|售票系統/.test(rest) || /批次更新實名/.test(msg)) { kind = "flag"; icon = "📝"; color = "#7a5a8b"; }
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

  const updateEvent = (id, fn) => {
    recordEventAction(id, "touch"); // 標記:這個場次我剛動過
    setEvents(evs => evs.map(e => e.id === id ? fn({ ...e, buyers: [...(e.buyers || [])] }) : e));
  };

  const addBuyerToEvent = (eventId, name) => {
    addLog(`【${getEventName(eventId)}】新增「${name}」`, snap());
    if (!buyerNames.includes(name)) setBuyerNames(ns => [...ns, name].sort((a, b) => a.localeCompare(b, "zh-TW")));
    updateEvent(eventId, e => { e.buyers.push({ name, qty: 1, addedAt: Date.now(), batches: [{ qty: 1, st: "normal", detail: "", addedAt: Date.now() }] }); return e; });
  };

  const updateBuyer = (eventId, idx, updates) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (b) {
      const parts = [];
      if (updates.note !== undefined && updates.note !== b.note) parts.push("備註更新");
      if (updates.name !== undefined && updates.name !== b.name) parts.push(`名字改為「${updates.name}」`);
      if (parts.length > 0) addLog(`【${evt.name}】${b.name}:${parts.join("、")}`, snap());
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
    addLog(`【${evt.name}】${b.name}:新增一筆代購`, snap());
    updateEvent(eventId, e => {
      const list = Array.isArray(e.buyers[idx].identities) ? [...e.buyers[idx].identities] : [];
      list.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name:"", qty:1, subItems: [] });
      e.buyers[idx] = { ...e.buyers[idx], identities: list }; // 不自動勾「需要實名」— 代購跟實名是獨立概念
      return e;
    });
  };
  // 批次匯入實名:additionsByBuyer = { 訂購人名: [identityOrSubItem, ...] }
  // 智慧分配:
  //   - 帶 agent 欄 → subItem 找對應代購名
  //     · 同名代購有多筆(不同 supplier) → 依序填,每個填滿就跳下一個
  //     · 帶 agentSupplier 欄 → 優先填對應 supplier 的代購
  //   - 不帶 agent → 變成新代購(沒 supplier)
  //   - ⚠ 不自動勾「需要實名」 — 代購跟實名是獨立概念
  const bulkImportIdentities = (eventId, additionsByBuyer) => {
    const evt = events.find(e => e.id === eventId);
    if (!evt) return { created: 0, addedTo: 0, identities: 0 };
    const totalRows = Object.values(additionsByBuyer).reduce((s, arr) => s + arr.length, 0);
    const buyerNamesCount = Object.keys(additionsByBuyer).length;
    addLog(`📥 批次匯入 ${totalRows} 筆實名到【${evt.name}】(${buyerNamesCount} 個訂購人)`, snap());
    updateEvent(eventId, e => {
      Object.entries(additionsByBuyer).forEach(([buyerName, newRows]) => {
        if (!newRows || newRows.length === 0) return;
        let bIdx = e.buyers.findIndex(b => (b.name||"").trim().toLowerCase() === buyerName.trim().toLowerCase());
        if (bIdx < 0) {
          // 新增訂購人,張數預設等於這次匯入的總張數
          const totalQ = newRows.reduce((s, n) => s + (n.qty||1), 0);
          e.buyers.push({
            name: buyerName,
            qty: totalQ,
            batches: [{ qty: totalQ, st: "normal", detail: "" }],
            identities: [],
            addedAt: Date.now(),
          });
          bIdx = e.buyers.length - 1;
        }
        const existing = e.buyers[bIdx].identities || [];
        const updatedIdentities = [...existing];

        // 分流:有 agent 的去 subItem,沒 agent 的當代購本身
        newRows.forEach(row => {
          const { agent, agentSupplier, ...identityFields } = row;
          if (agent && agent.trim()) {
            const agentName = agent.trim();
            const desiredSup = (agentSupplier || "").trim();
            // 找所有同名代購
            const candidates = [];
            updatedIdentities.forEach((it, idx) => {
              if ((it.name||"").trim().toLowerCase() === agentName.toLowerCase()) candidates.push(idx);
            });
            // 1. 若有指定 agentSupplier,先過濾出 supplier 對應的
            let pickedIdx = -1;
            if (desiredSup) {
              for (const i of candidates) {
                if ((updatedIdentities[i].supplier||"").toLowerCase() === desiredSup.toLowerCase()) {
                  pickedIdx = i; break;
                }
              }
            }
            // 2. 否則自動依序找第一個還有空位的代購
            if (pickedIdx < 0) {
              const rowQ = identityFields.qty || 1;
              for (const i of candidates) {
                const tgt = updatedIdentities[i];
                const curSub = (tgt.subItems||[]).reduce((s,si)=>s+(si.qty||1),0);
                const cap = tgt.qty || 1;
                if (curSub + rowQ <= cap) { pickedIdx = i; break; }
              }
              // 3. 全滿就放最後一個(overflow)
              if (pickedIdx < 0 && candidates.length > 0) pickedIdx = candidates[candidates.length - 1];
            }
            // 4. 都沒對應代購就建一個新的
            if (pickedIdx < 0) {
              updatedIdentities.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}_a`,
                name: agentName,
                supplier: desiredSup || "",
                qty: identityFields.qty || 1,
                subItems: [identityFields],
              });
            } else {
              const tgt = updatedIdentities[pickedIdx];
              updatedIdentities[pickedIdx] = { ...tgt, subItems: [...(tgt.subItems||[]), identityFields] };
            }
          } else {
            updatedIdentities.push({ ...identityFields, subItems: [] });
          }
        });
        e.buyers[bIdx] = {
          ...e.buyers[bIdx],
          identities: updatedIdentities,
          // ⚠ 不再自動設 needRealName — 代購跟實名獨立
        };
      });
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

  // ─── 細項實名(SubItems): 識別人底下再一層,給「上游」角色用 ───
  // 範例:妙(buyer,90張) → 萬陽(identity, 48張) → 萬陽底下的 48 個真實實名人(subItems)
  const addSubItem = (eventId, idx, identityId) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (!b) return;
    const it = (b.identities || []).find(x => x.id === identityId);
    addLog(`【${evt.name}】${b.name} → ${it?.name || ""}:新增細項實名`, snap());
    updateEvent(eventId, e => {
      const list = (e.buyers[idx].identities || []).map(it => {
        if (it.id !== identityId) return it;
        const subs = Array.isArray(it.subItems) ? [...it.subItems] : [];
        subs.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name:"", phone:"", idNumber:"", tixAccount:"", loginVia:"", locked:false, memberNo:"", qty:1 });
        return { ...it, subItems: subs };
      });
      e.buyers[idx] = { ...e.buyers[idx], identities: list };
      return e;
    });
  };
  const updateSubItem = (eventId, idx, identityId, subId, updates) => {
    updateEvent(eventId, e => {
      const list = (e.buyers[idx].identities || []).map(it => {
        if (it.id !== identityId) return it;
        const subs = (it.subItems || []).map(si => si.id === subId ? { ...si, ...updates } : si);
        return { ...it, subItems: subs };
      });
      e.buyers[idx] = { ...e.buyers[idx], identities: list };
      return e;
    });
  };
  const removeSubItem = (eventId, idx, identityId, subId) => {
    const evt = events.find(e => e.id === eventId); const b = evt?.buyers?.[idx];
    if (!b) return;
    const it = (b.identities || []).find(x => x.id === identityId);
    const si = (it?.subItems || []).find(x => x.id === subId);
    addLog(`【${evt.name}】${b.name} → ${it?.name || ""}:移除細項實名 ${si?.name || ""}`, snap());
    updateEvent(eventId, e => {
      const list = (e.buyers[idx].identities || []).map(it => {
        if (it.id !== identityId) return it;
        return { ...it, subItems: (it.subItems || []).filter(si => si.id !== subId) };
      });
      e.buyers[idx] = { ...e.buyers[idx], identities: list };
      return e;
    });
  };
  // helper:某 identity 已收的細項實名總張數
  const getSubItemQty = (it) => (it?.subItems || []).reduce((s, si) => s + (parseInt(si.qty) || 1), 0);

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
    if (b) addLog(`【${evt.name}】${b.name}:新增分批 ${batch.qty}張 ${BUYER_STATUS[batch.st]?.label||batch.st}`, snap());
    updateEvent(eventId, e => {
      const nb = migrateBuyer(e.buyers[idx]);
      nb.batches = [...nb.batches, { qty: batch.qty, st: batch.st, detail: batch.detail || "", addedAt: Date.now() }];
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
    setConfirmModal({ msg: `確定要刪除「${getEventName(eventId)}」嗎？可透過紀錄還原。`, onYes: () => { addLog(`刪除場次【${getEventName(eventId)}】`, snap()); recordEventAction(eventId, "delete"); setEvents(evs => evs.filter(e => e.id !== eventId)); setConfirmModal(null); } });
  };

  // 合併兩個場次:把 fromEvent 全部買家/分批/識別人灌進 toEvent → 同名訂購人自動合 batches+identities
  // 完成後 fromEvent 刪除
  const mergeIntoEvent = (fromId, toId) => {
    const fromEvt = events.find(e => e.id === fromId);
    const toEvt = events.find(e => e.id === toId);
    if (!fromEvt || !toEvt || fromId === toId) return;
    addLog(`🔗 合併場次:【${fromEvt.name}】(${(fromEvt.buyers||[]).reduce((s,b)=>s+(b.qty||0),0)}張) → 併入【${toEvt.name}】`, snap());
    setEvents(evs => {
      const next = [...evs];
      const toIdx = next.findIndex(e => e.id === toId);
      if (toIdx < 0) return evs;
      const merged = { ...next[toIdx] };
      merged.buyers = [...(merged.buyers || [])];
      // 對 fromEvent 每個 buyer:同名就併、不同名就 append
      (fromEvt.buyers || []).forEach(fb => {
        const tIdx = merged.buyers.findIndex(tb => (tb.name||"").trim().toLowerCase() === (fb.name||"").trim().toLowerCase());
        if (tIdx >= 0) {
          // 合併 batches + identities
          const existing = merged.buyers[tIdx];
          const allBatches = [...(existing.batches || []), ...(fb.batches || [])];
          const allIdentities = [...(existing.identities || []), ...(fb.identities || [])];
          const totalQ = allBatches.reduce((s, bt) => s + (bt.qty || 0), 0);
          merged.buyers[tIdx] = {
            ...existing,
            qty: totalQ,
            batches: allBatches,
            identities: allIdentities,
          };
        } else {
          merged.buyers.push({ ...fb });
        }
      });
      // 上游 supplierBatches 全部接上
      if (Array.isArray(fromEvt.supplierBatches) && fromEvt.supplierBatches.length > 0) {
        merged.supplierBatches = [...(merged.supplierBatches || []), ...fromEvt.supplierBatches];
      }
      next[toIdx] = merged;
      // 刪掉 fromEvent
      return next.filter(e => e.id !== fromId);
    });
  };

  const undoTo = (log) => {
    // 計算這個還原點之後（時間更新）的異動數
    const newerCount = (logs || []).filter(l => l.time > log.time).length;
    const d = new Date(log.time);
    const ts = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    setConfirmModal({
      msg: `即將還原到 ${ts}「${log.msg}」之前的版本。\n\n⚠ 之後的 ${newerCount} 筆異動會消失!\n\n👉 強烈建議先點「💾 匯出備份」存一份再還原,以防萬一。\n\n要繼續嗎?`,
      onYes: () => {
        // 預先算 newLogs 才能一次到位 (避免 addLog/setLogs 跟下面 save 不同步)
        const restoreLog = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
          time: Date.now(),
          msg: `⟲ 還原到 ${ts}`,
          snapshot: snap(),
        };
        const newLogs = [restoreLog, ...(logs||[])].slice(0, 500)
          .map((l, idx) => idx < SNAPSHOT_KEEP ? l : { ...l, snapshot: null });
        // 標記被還原的場次都「我動過」,避免 polling 之後把它沖回去
        (log.snapshot || []).forEach(e => recordEventAction(e.id, "touch"));
        (events || []).forEach(e => { if (!(log.snapshot||[]).find(s => s.id === e.id)) recordEventAction(e.id, "delete"); });
        setEvents(log.snapshot);
        setLogs(newLogs);
        setConfirmModal(null);
        // 還原後立刻強制上傳,避免被 polling 覆蓋
        if (SUPABASE_READY) {
          (async () => {
            savingInFlightRef.current = true;
            try {
              setSyncStatus("saving");
              const force = await saveToSupabase({ events: log.snapshot, buyerNames, logs: slimLogsForCloud(newLogs) }, null, { force: true });
              if (force.ok) {
                setSyncStatus("saved");
                setLastSyncedAt(force.updatedAt);
                lastSyncedAtRef.current = force.updatedAt;
                lastSavedSignature.current = makeSignature(log.snapshot, buyerNames, newLogs);
                updateBase({ events: log.snapshot, buyerNames, logs: newLogs });
              } else { setSyncStatus("error"); }
            } finally { savingInFlightRef.current = false; }
          })();
        }
      }
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
    a.download = `${APP_TITLE}備份_${new Date().toISOString().slice(0, 10)}.json`;
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
            // 匯入後立刻強制上傳到雲端,避免被 polling 覆蓋
            if (SUPABASE_READY) {
              (async () => {
                savingInFlightRef.current = true;
                try {
                  setSyncStatus("saving");
                  const importedLogs = Array.isArray(data.logs) ? data.logs : logs;
                  const importedNames = Array.isArray(data.buyerNames) ? data.buyerNames : buyerNames;
                  const force = await saveToSupabase({
                    events: data.events,
                    buyerNames: importedNames,
                    logs: slimLogsForCloud(importedLogs),
                  }, null, { force: true });
                  if (force.ok) {
                    setSyncStatus("saved");
                    setLastSyncedAt(force.updatedAt);
                    lastSyncedAtRef.current = force.updatedAt;
                    lastSavedSignature.current = makeSignature(data.events, importedNames, importedLogs);
                    updateBase({ events: data.events, buyerNames: importedNames, logs: importedLogs });
                  } else { setSyncStatus("error"); }
                } finally { savingInFlightRef.current = false; }
              })();
            }
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
    ctx.fillText(APP_TITLE, PAD, 36);
    ctx.fillStyle = "#8b7355";
    ctx.font = `10px ${F}`;
    ctx.fillText(APP_SUBTITLE, PAD + 105, 34);

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
    ctx.fillText(APP_TITLE, W / 2, y + 14);
    ctx.textAlign = "left";

    const filename = `${APP_TITLE}_進行中_${dateStr.replace(/\//g, "-")}_${timeStr.replace(":", "")}.png`;

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
              navigator.share({ files: [file], title: APP_TITLE }).catch(() => {
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
            <span style={{ fontSize:20,fontWeight:700,letterSpacing:1 }}>{APP_TITLE}</span>
            <span style={{ fontSize:11,color:"#8b7355",fontWeight:500 }}>{APP_SUBTITLE}</span>
            {SUPABASE_READY && (() => {
              const hasUnsaved = lastSavedSignature.current !== null && currentSig !== lastSavedSignature.current;
              return (
              <button onClick={refetchFromCloud} title={!isOnline?"目前離線\n資料只存在這台裝置,連上網路會自動同步":lastSyncedAt?`最後同步:${new Date(lastSyncedAt).toLocaleString("zh-TW")}${hasUnsaved?"\n⚠ 目前有修改尚未上傳":""}\n點擊從雲端重新載入(會智慧合併)`:"從雲端重新載入"}
                style={{ marginLeft:6,padding:"3px 9px",borderRadius:10,border:"none",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit",
                  background: !isOnline?"#a87830":syncStatus==="error"?"#7a3030":syncStatus==="saving"||syncStatus==="loading"?"#8b7355":hasUnsaved?"#a87830":"#3a5a3a",
                  color:"#faf9f6" }}>
                {!isOnline?"📴 離線":syncStatus==="loading"?"⟳ 載入中":syncStatus==="saving"?"⟳ 同步中":syncStatus==="error"?"⚠ 同步失敗":hasUnsaved?"● 未上傳":syncStatus==="saved"?"☁ 已同步":"○ 離線"}
              </button>
              );
            })()}
            {!SUPABASE_READY && (
              <span title="尚未設定雲端，資料只存本機" style={{ marginLeft:6,padding:"3px 9px",borderRadius:10,fontSize:10,fontWeight:700,background:"#555",color:"#bbb" }}>○ 本機</span>
            )}
          </div>
          <div style={{ display:"flex",gap:4,flexWrap:"wrap",alignItems:"center" }}>
            {(() => {
              const pendingTotal = events.filter(e=>e.status==="active"||e.status==="picked").reduce((s,e)=>s+countPendingFlag(e.buyers,"needRealName","gotRealName")+countPendingFlag(e.buyers,"needSid","gotSid")+countPendingFlag(e.buyers,"ticketDelivered","photoReceived"),0);
              return [{key:"active",label:`進行中 (${activeEvents.length})`},{key:"picked",label:`已取票 (${pickedEvents.length})`},{key:"done",label:`已完成 (${doneEvents.length})`},{key:"pending",label:`📋 待收${pendingTotal>0?` (${pendingTotal})`:""}`},{key:"buyers",label:`👤 訂購人 (${buyersAggregated.length})`},{key:"identity",label:`📇 實名簿 (${identityCatalog.length})`},{key:"orderlog",label:`📅 訂購日曆`},{key:"timeline",label:`🕒 時間軸`}].map(t=>(
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
        {/* 全域總覽 + 健康監測 (所有分頁可見) */}
        {!showLog && (
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14,padding:"8px 14px",background:healthCheck?.alert?"#fff0eb":"#f7f3ec",borderRadius:10,border:`1px solid ${healthCheck?.alert?"#e09080":"#e4e0d8"}`,fontSize:12,flexWrap:"wrap" }}>
            <span style={{ color:"#7a6850",fontWeight:600 }}>📊 全域總覽:</span>
            <span style={{ color:"#2d2a26",fontWeight:700 }}>{allTotals.totalEvents} 場</span>
            <span style={{ color:"#999" }}>·</span>
            <span style={{ color:"#2d2a26",fontWeight:700 }}>{allTotals.totalBuyers} 訂購人</span>
            <span style={{ color:"#999" }}>·</span>
            <span style={{ color:"#2d2a26",fontWeight:700 }}>{allTotals.totalQty} 張</span>
            {dataDiff && (() => {
              const c = dataDiff;
              if (c.noPayload) {
                return <span style={{ marginLeft:"auto",color:"#999",fontSize:11 }}>{c.prevKey} 快照只剩數字 · 無法比對細節</span>;
              }
              const totalChanges = c.eventsAdded.length + c.eventsRemoved.length + c.buyersAdded.length + c.buyersRemoved.length + c.qtyDecreases.length;
              if (totalChanges === 0) {
                return <span style={{ marginLeft:"auto",color:"#5a7a5a",fontSize:11 }}>✓ 跟 {c.prevKey} 對得起來</span>;
              }
              return (<>
                <button onClick={()=>setDataDiffModal(true)} style={{ marginLeft:"auto",padding:"3px 10px",borderRadius:7,border:`1px solid ${c.alert?"#c47070":"#c4b89a"}`,background:c.alert?"#fff":"#fff9ec",fontSize:11,cursor:"pointer",fontWeight:700,color:c.alert?"#8b3a3a":"#7a5a30",fontFamily:"inherit" }}>🔍 查看與 {c.prevKey} 的差異 ({totalChanges})</button>
                {c.alert && <span title={`有 ${c.unexplained} 筆資料消失但找不到對應 log,可能是同步異常!`} style={{ padding:"2px 8px",borderRadius:8,background:"#c47070",color:"#fff",fontSize:11,fontWeight:700 }}>⚠ {c.unexplained} 筆無法解釋</span>}
              </>);
            })()}
          </div>
        )}
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
            {tab==="buyers"&&(()=>{
              const s=search.toLowerCase();
              const fb=search?buyersAggregated.filter(b=>b.name.toLowerCase().includes(s)):buyersAggregated;
              return <button onClick={()=>setBuyerExportModal({ buyers: fb, title: search?`篩選: "${search}"`:"全部訂購人" })} disabled={fb.length===0} title="把目前清單上的訂購人輸出成文字或 Excel" style={{ padding:"10px 12px",borderRadius:10,border:"1.5px solid #c4b89a",background:"#fff9ec",fontSize:12,cursor:fb.length===0?"not-allowed":"pointer",fontWeight:700,color:"#8b6a2d",fontFamily:"inherit",opacity:fb.length===0?.5:1 }}>📋 輸出訂購人</button>;
            })()}
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

            {/* 每日快照 (自動備份) */}
            {Object.keys(dailySnapshots).length > 0 && (
              <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden" }}>
                <div style={{ padding:"12px 18px",borderBottom:"1px solid #f0ede8" }}>
                  <span style={{ fontWeight:700,fontSize:14 }}>📅 每日快照</span>
                  <span style={{ fontSize:11,color:"#999",marginLeft:8 }}>每天開 app 自動拍一張,最多保留 7 天</span>
                </div>
                <div>
                  {Object.keys(dailySnapshots).sort().reverse().map(dateKey => {
                    const ds = dailySnapshots[dateKey];
                    const t = new Date(ds.time);
                    const ts = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
                    return (
                      <div key={dateKey} style={{ padding:"10px 18px",borderBottom:"1px solid #f5f3ef",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,fontSize:13,flexWrap:"wrap" }}>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontWeight:700 }}>📅 {dateKey} <span style={{ color:"#999",fontSize:11,fontWeight:400 }}>· {ts} 拍</span></div>
                          <div style={{ fontSize:11,color:"#888",marginTop:2 }}>當時:{ds.totalEvents} 場 · {ds.totalBuyers} 訂購人 · {ds.totalQty} 張</div>
                        </div>
                        {ds.payload ? (
                          <button onClick={()=>setConfirmModal({
                            msg:`確定要還原到 ${dateKey} 的快照嗎?

當時:${ds.totalEvents} 場 · ${ds.totalBuyers} 訂購人 · ${ds.totalQty} 張

還原後,${dateKey} 之後的所有變更都會消失。建議先 💾 匯出備份再操作。`,
                            yesLabel:"確定還原",
                            onYes:()=>{restoreFromDaily(dateKey);setConfirmModal(null);}
                          })} style={{ padding:"5px 14px",borderRadius:7,border:"1.5px solid #d4cdb8",background:"#faf7f0",fontSize:12,cursor:"pointer",fontWeight:700,color:"#7a5a30",fontFamily:"inherit",whiteSpace:"nowrap" }}>⟲ 還原到此</button>
                        ) : (
                          <span style={{ fontSize:11,color:"#bbb" }}>空間不夠 · 只剩數字</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 完整紀錄按日期分組 */}
            <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden" }}>
              <div style={{ padding:"12px 18px",borderBottom:"1px solid #f0ede8",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6 }}>
                <span style={{ fontWeight:700,fontSize:14 }}>📚 完整歷史</span>
                <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
                  {logs.some(l=>l.snapshot)&&<button onClick={()=>{
                    const snapCount = logs.filter(l=>l.snapshot).length;
                    setConfirmModal({
                      msg:`清除舊快照可釋放本機儲存空間。\n\n目前有 ${snapCount} 筆紀錄帶有快照,清除後:\n• 異動歷史會保留(時間、訊息)\n• 但無法用「快捷還原」倒回\n\n建議先「💾 匯出備份」再操作。`,
                      yesLabel:"清除舊快照",
                      noLabel:"取消",
                      onYes:()=>{
                        setLogs(prev=>prev.map(l=>l.snapshot?{...l,snapshot:null}:l));
                        storageWarnedRef.current=false; // 重置警告,讓下次容量警告可再彈出
                        setConfirmModal(null);
                      }
                    });
                  }} style={{ padding:"5px 12px",borderRadius:7,border:"1px solid #c4b89a",background:"#fff9ec",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b6a2d",fontFamily:"inherit" }}>🧹 清除舊快照</button>}
                  {logs.length>0&&<button onClick={()=>setConfirmModal({msg:"確定要清除所有歷史紀錄嗎?\n清除後就不能再還原。",onYes:()=>{setLogs([]);setConfirmModal(null);}})} style={{ padding:"5px 12px",borderRadius:7,border:"1px solid #e8c4c4",background:"#fff",fontSize:11,cursor:"pointer",fontWeight:600,color:"#8b3a3a",fontFamily:"inherit" }}>清除紀錄</button>}
                </div>
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
                        <input
                          value={b.name||""}
                          onChange={e=>updateBuyer(evt.id,i,{name:e.target.value})}
                          placeholder="訂購人名"
                          title="點此編輯訂購人名字"
                          style={{ fontWeight:700,fontSize:14,minWidth:70,maxWidth:140,color:scMain.color,padding:"3px 8px",borderRadius:5,border:"1px solid transparent",background:"transparent",fontFamily:"inherit",cursor:"text",transition:"background .15s" }}
                          onFocus={e=>{e.target.style.background="#fff";e.target.style.border="1px solid #d4d0c8";}}
                          onBlur={e=>{e.target.style.background="transparent";e.target.style.border="1px solid transparent";}}
                        />
                        <span style={{ fontSize:13,fontWeight:700,color:"#555" }}>共 {totalQ} 張</span>
                        {(() => {
                          // 上游分流:依 batch.detail 抓「X供」分組
                          const supTotals = {};
                          batches.forEach(bt => {
                            const m = (bt.detail || "").match(/([^\s·]+?)供/);
                            const sup = m ? m[1] : null;
                            if (sup) supTotals[sup] = (supTotals[sup] || 0) + (bt.qty || 0);
                          });
                          const ents = Object.entries(supTotals);
                          if (ents.length === 0) return null;
                          return (
                            <span onClick={()=>setSupplierEditModal({eventId:evt.id,buyerIdx:i})} title="點此編輯各批次的上游"
                              style={{ fontSize:11,color:"#666",padding:"2px 8px",borderRadius:10,background:"rgba(255,255,255,.7)",border:"1px solid #d8d2c0",cursor:"pointer" }}>
                              {ents.map(([s,q],j) => (
                                <span key={s}>{j>0 && <span style={{opacity:.4,margin:"0 3px"}}>·</span>}<span style={{color:"#7a6850"}}>{s}</span> <b style={{color:"#b8531a"}}>{q}</b></span>
                              ))}
                              <span style={{ opacity:.5,marginLeft:5 }}>✎</span>
                            </span>
                          );
                        })()}
                        {b.note&&<span style={{ fontSize:11,color:"#999",marginLeft:4 }}>({b.note})</span>}
                        <div style={{ marginLeft:"auto",display:"flex",gap:4 }}>
                          <button onClick={()=>{setAddingBatch({eventId:evt.id,idx:i});setEditingBatch(null);}} title="新增分批（例如一部分已取票、一部分待退費）" style={{ padding:"3px 10px",borderRadius:7,border:"1px solid #c4b89a",background:"#fff9ec",cursor:"pointer",fontSize:11,fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>＋ 分批</button>
                          <button onClick={()=>openRealnameLink(evt.id,i)} title="產生這位訂購人的實名填寫連結(LINE 傳給他/她)" style={{ width:26,height:26,borderRadius:6,border:"1px solid #b8d4b8",background:"#e8f0e8",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",color:"#4a7a4a" }}>🔗</button>
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

                      {/* 代購清單（永遠顯示,不論是否需要實名）*/}
                      {(() => {
                        const idCount = (b.identities || []).length;
                        const idQty = (b.identities || []).reduce((s,x)=>s+(x.qty||1),0);
                        const diff = idQty - totalQ;
                        const matches = diff === 0;
                        const short = diff < 0;
                        return (
                        <div style={{ marginTop:8,padding:"8px 10px",background:"rgba(255,255,255,.55)",borderRadius:8,border:"1px dashed #d4cdb8" }}>
                          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:6 }}>
                            <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                              <span style={{ fontSize:11,fontWeight:700,color:"#7a6850" }}>👥 代購 {idCount} 人 {idCount > 0 ? `(${idQty} / ${totalQ} 張)` : ""}</span>
                              {idCount > 0 && (
                                matches
                                  ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#dfeadf",color:"#3a7a3a" }}>✅ 張數相符</span>
                                  : short
                                    ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#fce8e8",color:"#8b3a3a" }}>⚠ 還少 {-diff} 張</span>
                                    : <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#f6ecd8",color:"#8b6a2d" }}>多了 {diff} 張</span>
                              )}
                            </div>
                            <button onClick={()=>addIdentity(evt.id,i)} style={{ padding:"3px 10px",borderRadius:6,border:"1px solid #c4b89a",background:"#fff9ec",cursor:"pointer",fontSize:11,fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>＋ 新增代購</button>
                          </div>
                          {(!b.identities || b.identities.length === 0) && (
                            <div style={{ fontSize:11,color:"#a09080",padding:"4px 2px" }}>還沒有代購 — 點「＋ 新增代購」加,或用「📥 批次匯入實名」</div>
                          )}
                          {(b.identities||[]).map((it,k) => {
                            const ekey = `${evt.id}_${i}_${it.id}`;
                            const isOpen = expandedIdentity === ekey;
                            const itQty = it.qty || 1;
                            const subItems = it.subItems || [];
                            const subQty = getSubItemQty(it);
                            const subDiff = itQty - subQty;
                            return (
                              <div key={it.id} style={{ marginTop:k>0?6:0,padding:"6px 8px",background:"#fff",borderRadius:6,border:"1px solid #e4e0d8" }}>
                                <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                                  <button onClick={()=>setExpandedIdentity(isOpen?null:ekey)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:11,color:"#999",padding:"0 4px",fontFamily:"inherit" }}>{isOpen?"▾":"▸"}</button>
                                  <input value={it.name||""} onChange={e=>updateIdentity(evt.id,i,it.id,{name:e.target.value})} placeholder="代購姓名"
                                    style={{ padding:"3px 8px",borderRadius:5,border:"1px solid #e4e0d8",fontSize:12,fontFamily:"inherit",fontWeight:700,color:"#2d2a26",background:"#fff",width:100 }}/>
                                  <div style={{ display:"flex",alignItems:"center",gap:2 }}>
                                    <button onClick={(e)=>{e.stopPropagation();if(itQty>1)updateIdentity(evt.id,i,it.id,{qty:itQty-1});}} style={{ width:20,height:20,borderRadius:4,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontSize:11,fontWeight:700,color:"#666",fontFamily:"inherit",lineHeight:1 }}>−</button>
                                    <span style={{ fontSize:11,fontWeight:700,minWidth:36,textAlign:"center",color:"#666" }}>{itQty} 張</span>
                                    <button onClick={(e)=>{e.stopPropagation();updateIdentity(evt.id,i,it.id,{qty:itQty+1});}} style={{ width:20,height:20,borderRadius:4,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontSize:11,fontWeight:700,color:"#666",fontFamily:"inherit",lineHeight:1 }}>+</button>
                                  </div>
                                  {/* 上游 badge — 哪個上游供貨 (僅 4 層 mode) — 點下去展開可編輯 */}
                                  {is4LayerMode && it.supplier && (
                                    <span onClick={()=>setExpandedIdentity(isOpen?null:ekey)} title="點此編輯上游"
                                      style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:5,background:"#fffaeb",color:"#7a6028",border:"1px solid #e6d8a0",cursor:"pointer" }}>📦 {it.supplier} ✎</span>
                                  )}
                                  {/* 沒設上游的識別人 → 顯示「+ 上游」快捷 */}
                                  {is4LayerMode && !it.supplier && (
                                    <span onClick={()=>setExpandedIdentity(isOpen?null:ekey)} title="點此設定上游"
                                      style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:5,background:"#fafafa",color:"#999",border:"1px dashed #ccc",cursor:"pointer" }}>+ 上游</span>
                                  )}
                                  {/* 細項實名指示器 (僅 4 層 mode 顯示) */}
                                  {is4LayerMode && subItems.length > 0 && (
                                    subDiff === 0
                                      ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:5,background:"#dfeadf",color:"#3a7a3a" }}>📝 實名 {subQty}/{itQty} ✓</span>
                                      : subDiff > 0
                                        ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:5,background:"#fce8e8",color:"#8b3a3a" }}>📝 實名 {subQty}/{itQty} 缺 {subDiff}</span>
                                        : <span style={{ fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:5,background:"#f6ecd8",color:"#8b6a2d" }}>📝 實名 {subQty}/{itQty} 多 {-subDiff}</span>
                                  )}
                                  {is4LayerMode && (
                                    <button onClick={()=>openIdentityRealnameLink(evt.id,i,it.id)} title={`產生「${it.name||"此人"}」的細項實名連結 → LINE 給代購自填`} style={{ marginLeft:"auto",width:22,height:22,borderRadius:5,border:"1px solid #b8d4b8",background:"#e8f0e8",cursor:"pointer",fontSize:11,color:"#4a7a4a",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center" }}>🔗</button>
                                  )}
                                  <button onClick={()=>removeIdentity(evt.id,i,it.id)} style={{ marginLeft: is4LayerMode ? 0 : "auto",width:22,height:22,borderRadius:5,border:"1px solid #e8c4c4",background:"#fff",cursor:"pointer",fontSize:11,color:"#c47070",fontFamily:"inherit" }} title="刪除">×</button>
                                </div>
                                {isOpen && is4LayerMode && (
                                  <>
                                  {/* 代購本身的上游選擇(可選填) — 僅 4 層 mode */}
                                  {(() => {
                                    const supSet = new Set();
                                    (evt.buyers || []).forEach(bb => {
                                      (bb.batches || []).forEach(bt => {
                                        const m = (bt.detail || "").match(/([^\s·]+?)供/);
                                        if (m) supSet.add(m[1]);
                                      });
                                      (bb.identities || []).forEach(ii => { if (ii.supplier) supSet.add(ii.supplier); });
                                    });
                                    if (it.supplier) supSet.add(it.supplier);
                                    const supOpts = Array.from(supSet).sort((a,b)=>a.localeCompare(b, "zh-TW"));
                                    if (supOpts.length === 0 && !it.supplier) return null;
                                    return (
                                      <div style={{ marginTop:6,display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"4px 6px",background:"#fffaeb",borderRadius:5,border:"1px solid #f0e4b8" }}>
                                        <span style={{ color:"#7a6028",fontWeight:600 }}>📦 此代購的票來自:</span>
                                        <select value={it.supplier||""} onChange={e=>updateIdentity(evt.id,i,it.id,{supplier:e.target.value})}
                                          style={{ padding:"3px 7px",borderRadius:4,border:"1px solid #d4cdb8",fontSize:11,fontFamily:"inherit",background:"#fff" }}>
                                          <option value="">(未指定)</option>
                                          {supOpts.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                        <input value={it.supplier||""} onChange={e=>updateIdentity(evt.id,i,it.id,{supplier:e.target.value})} placeholder="或自填上游名" style={{ padding:"3px 7px",borderRadius:4,border:"1px solid #d4cdb8",fontSize:11,fontFamily:"inherit",background:"#fff",width:100 }}/>
                                      </div>
                                    );
                                  })()}
                                  {/* ─── 代購底下的實名清單(端客戶實際資料) — 僅 4 層 mode ─── */}
                                  <div style={{ marginTop:8,padding:"8px 10px",background:"#faf9f6",borderRadius:6,border:"1px dashed #d4cdb8" }}>
                                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:6 }}>
                                      <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                                        <span style={{ fontSize:11,fontWeight:700,color:"#7a6850" }}>📝 {it.name||"此代購"} 的實名 {subItems.length} 筆 ({subQty} / {itQty} 張)</span>
                                        {subItems.length > 0 && (
                                          subDiff === 0
                                            ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#dfeadf",color:"#3a7a3a" }}>✅ 張數齊</span>
                                            : subDiff > 0
                                              ? <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#fce8e8",color:"#8b3a3a" }}>⚠ 還差 {subDiff} 筆</span>
                                              : <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:8,background:"#f6ecd8",color:"#8b6a2d" }}>多了 {-subDiff} 張</span>
                                        )}
                                      </div>
                                      <button onClick={()=>addSubItem(evt.id,i,it.id)} style={{ padding:"3px 10px",borderRadius:6,border:"1px solid #c4b89a",background:"#fff9ec",cursor:"pointer",fontSize:11,fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>＋ 新增實名</button>
                                    </div>
                                    {subItems.length === 0 && (
                                      <div style={{ fontSize:10,color:"#a09080",padding:"2px 2px" }}>還沒有實名 — {it.name||"此代購"} 預計給 {itQty} 筆,可用 🔗 連結讓 {it.name||"此代購"} 自己填</div>
                                    )}
                                    {subItems.map((si, sik) => {
                                      const sekey = `${ekey}_${si.id}`;
                                      const siOpen = expandedSubItem === sekey;
                                      const siQty = si.qty || 1;
                                      return (
                                        <div key={si.id} style={{ marginTop:sik>0?5:0,padding:"5px 7px",background:"#fff",borderRadius:5,border:"1px solid #e8e3d4" }}>
                                          <div style={{ display:"flex",alignItems:"center",gap:5,flexWrap:"wrap" }}>
                                            <button onClick={()=>setExpandedSubItem(siOpen?null:sekey)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#999",padding:"0 3px",fontFamily:"inherit" }}>{siOpen?"▾":"▸"}</button>
                                            <input value={si.name||""} onChange={e=>updateSubItem(evt.id,i,it.id,si.id,{name:e.target.value})} placeholder="姓名"
                                              style={{ padding:"3px 6px",borderRadius:4,border:"1px solid #d4d0c8",fontSize:11,fontFamily:"inherit",background:"#fff",width:90 }}/>
                                            <div style={{ display:"flex",alignItems:"center",gap:1 }}>
                                              <button onClick={()=>{if(siQty>1)updateSubItem(evt.id,i,it.id,si.id,{qty:siQty-1});}} style={{ width:18,height:18,borderRadius:3,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontSize:10,fontWeight:700,color:"#666",fontFamily:"inherit",lineHeight:1 }}>−</button>
                                              <span style={{ fontSize:10,fontWeight:700,minWidth:30,textAlign:"center",color:"#666" }}>{siQty}張</span>
                                              <button onClick={()=>updateSubItem(evt.id,i,it.id,si.id,{qty:siQty+1})} style={{ width:18,height:18,borderRadius:3,border:"1px solid #d4d0c8",background:"#fff",cursor:"pointer",fontSize:10,fontWeight:700,color:"#666",fontFamily:"inherit",lineHeight:1 }}>+</button>
                                            </div>
                                            {!siOpen && si.idNumber && <span style={{ fontSize:10,color:"#888" }}>· {si.idNumber}</span>}
                                            {!siOpen && si.phone && <span style={{ fontSize:10,color:"#888" }}>· {si.phone}</span>}
                                            <button onClick={()=>removeSubItem(evt.id,i,it.id,si.id)} style={{ marginLeft:"auto",width:20,height:20,borderRadius:4,border:"1px solid #e8c4c4",background:"#fff",cursor:"pointer",fontSize:10,color:"#c47070",fontFamily:"inherit" }} title="刪除">×</button>
                                          </div>
                                          {siOpen && (
                                            <div style={{ marginTop:5,display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))",gap:5 }}>
                                              {[
                                                { key:"phone", label:"電話", ph:"09xx..." },
                                                { key:"idNumber", label:"身分證", ph:"A123..." },
                                                { key:"memberNo", label:"會員編號", ph:"" },
                                              ].map(field => (
                                                <label key={field.key} style={{ display:"flex",flexDirection:"column",gap:2,fontSize:9,color:"#888" }}>
                                                  <span style={{ fontWeight:600 }}>{field.label}</span>
                                                  <input value={si[field.key]||""} onChange={e=>updateSubItem(evt.id,i,it.id,si.id,{[field.key]:e.target.value})} placeholder={field.ph}
                                                    style={{ padding:"4px 6px",borderRadius:4,border:"1px solid #d4d0c8",fontSize:11,fontFamily:"inherit",background:"#faf9f6" }}/>
                                                </label>
                                              ))}
                                              {(evt.tixOnly !== false) && (
                                                <label style={{ display:"flex",flexDirection:"column",gap:2,fontSize:9,color:"#888" }}>
                                                  <span style={{ fontWeight:600 }}>拓元帳號</span>
                                                  <input value={si.tixAccount||""} onChange={e=>updateSubItem(evt.id,i,it.id,si.id,{tixAccount:e.target.value})} placeholder="帳號/Email"
                                                    style={{ padding:"4px 6px",borderRadius:4,border:"1px solid #d4d0c8",fontSize:11,fontFamily:"inherit",background:"#faf9f6" }}/>
                                                </label>
                                              )}
                                              {(evt.tixOnly !== false) && (
                                                <label style={{ display:"flex",flexDirection:"column",gap:2,fontSize:9,color:"#888" }}>
                                                  <span style={{ fontWeight:600 }}>登入方式</span>
                                                  <select value={si.loginVia||""} onChange={e=>updateSubItem(evt.id,i,it.id,si.id,{loginVia:e.target.value})}
                                                    style={{ padding:"4px 6px",borderRadius:4,border:"1px solid #d4d0c8",fontSize:11,fontFamily:"inherit",background:"#faf9f6" }}>
                                                    <option value="">未選</option>
                                                    <option value="facebook">Facebook</option>
                                                    <option value="google">Google</option>
                                                  </select>
                                                </label>
                                              )}
                                              {(evt.tixOnly !== false) && (
                                                <label style={{ display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#666",cursor:"pointer",alignSelf:"end",padding:"4px 0" }}>
                                                  <input type="checkbox" checked={!!si.locked} onChange={e=>updateSubItem(evt.id,i,it.id,si.id,{locked:e.target.checked})} style={{ cursor:"pointer",margin:0 }}/>
                                                  <span style={{ fontWeight:600 }}>🔒 帳號鎖</span>
                                                </label>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  </>
                                )}
                                {isOpen && !is4LayerMode && (
                                  <div style={{ marginTop:6,display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:6 }}>
                                    {[
                                      { key:"phone", label:"電話", ph:"09xx..." },
                                      { key:"idNumber", label:"身分證", ph:"A123..." },
                                      { key:"memberNo", label:"會員編號", ph:"" },
                                    ].map(field => (
                                      <label key={field.key} style={{ display:"flex",flexDirection:"column",gap:2,fontSize:10,color:"#888" }}>
                                        <span style={{ fontWeight:600 }}>{field.label}</span>
                                        <input value={it[field.key]||""} onChange={e=>updateIdentity(evt.id,i,it.id,{[field.key]:e.target.value})} placeholder={field.ph}
                                          style={{ padding:"5px 7px",borderRadius:5,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6" }}/>
                                      </label>
                                    ))}
                                    {(evt.tixOnly !== false) && (
                                      <label style={{ display:"flex",flexDirection:"column",gap:2,fontSize:10,color:"#888" }}>
                                        <span style={{ fontWeight:600 }}>拓元帳號</span>
                                        <input value={it.tixAccount||""} onChange={e=>updateIdentity(evt.id,i,it.id,{tixAccount:e.target.value})} placeholder="帳號 / Email"
                                          style={{ padding:"5px 7px",borderRadius:5,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6" }}/>
                                      </label>
                                    )}
                                    {(evt.tixOnly !== false) && (
                                      <label style={{ display:"flex",flexDirection:"column",gap:2,fontSize:10,color:"#888" }}>
                                        <span style={{ fontWeight:600 }}>登入方式</span>
                                        <select value={it.loginVia||""} onChange={e=>updateIdentity(evt.id,i,it.id,{loginVia:e.target.value})}
                                          style={{ padding:"5px 7px",borderRadius:5,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6" }}>
                                          <option value="">未選</option>
                                          <option value="facebook">Facebook</option>
                                          <option value="google">Google</option>
                                        </select>
                                      </label>
                                    )}
                                    {(evt.tixOnly !== false) && (
                                      <label style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#666",cursor:"pointer",alignSelf:"end",padding:"5px 0" }}>
                                        <input type="checkbox" checked={!!it.locked} onChange={e=>updateIdentity(evt.id,i,it.id,{locked:e.target.checked})} style={{ cursor:"pointer",margin:0 }}/>
                                        <span style={{ fontWeight:600 }}>🔒 拓元帳號被鎖</span>
                                      </label>
                                    )}
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
                  {/* 售票系統 toggle:預設拓元,點一下切換到「其他系統」 */}
                  <button onClick={()=>{
                    const wasTixOn = evt.tixOnly !== false;
                    const newVal = !wasTixOn;
                    addLog(`【${evt.name}】售票系統→${newVal?"拓元":"其他"}`,snap());
                    updateEvent(evt.id,e=>{ e.tixOnly = newVal; return e; });
                  }} style={(evt.tixOnly !== false) ? {
                    padding:"6px 14px",borderRadius:8,border:"1px solid #c4b89a",background:"#faf7f0",fontSize:12,cursor:"pointer",fontWeight:700,color:"#8b6a2d",fontFamily:"inherit"
                  } : {
                    padding:"6px 14px",borderRadius:8,border:"1px solid #c4d0d8",background:"#eef2f5",fontSize:12,cursor:"pointer",fontWeight:700,color:"#5a7080",fontFamily:"inherit"
                  }} title="點一下切換售票系統 (影響實名欄位顯示)">
                    {(evt.tixOnly !== false) ? "🎫 拓元場" : "🌐 非拓元場"}
                  </button>
                  {evt.status==="active"&&<button onClick={()=>setEventStatus(evt.id,"picked")} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #b8d4e8",background:"#e0eef6",fontSize:12,cursor:"pointer",fontWeight:600,color:"#2d6a8b",fontFamily:"inherit" }}>🎫 全部已取票</button>}
                  {(evt.buyers||[]).some(b=>(b.identities||[]).length>0)&&<button onClick={()=>setIdentityExportModal({events:[evt],title:evt.name})} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #c4b89a",background:"#fff9ec",fontSize:12,cursor:"pointer",fontWeight:700,color:"#8b6a2d",fontFamily:"inherit" }}>📋 輸出本場實名</button>}
                  <button onClick={()=>setImportIdentityModal({eventId:evt.id})} title="從試算表批次貼上,自動填入訂購人的實名資料" style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #b8d4b8",background:"#e8f0e8",fontSize:12,cursor:"pointer",fontWeight:700,color:"#4a7a4a",fontFamily:"inherit" }}>📥 批次匯入實名</button>
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
                  <button onClick={()=>setMergeEventModal({fromEventId:evt.id})} title="把此場次併入另一個場次(同名訂購人會自動合 batches+identities)" style={{ padding:"6px 14px",borderRadius:8,border:"1px solid #c4b89a",background:"#fffaeb",fontSize:12,cursor:"pointer",fontWeight:600,color:"#8b6a2d",fontFamily:"inherit" }}>🔗 合併</button>
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
            // 搜尋:訂購人名 / 上游名 / 識別人(代購)/ 細項實名姓名
            // 例:搜「萬陽」→ 找出所有底下有「萬陽」識別人或細項實名的訂購人
            const fb=search?buyersAggregated.filter(b=>
              b.name.toLowerCase().includes(s) ||
              Object.keys(b.supplierTotals||{}).some(sup => sup.toLowerCase().includes(s)) ||
              Array.from(b.identityNames||[]).some(nm => nm.toLowerCase().includes(s))
            ):buyersAggregated;
            if(fb.length===0 && (!search||identitiesAggregated.filter(idn=>idn.name.toLowerCase().includes(s)).length===0))return <div style={{ textAlign:"center",padding:40,color:"#999" }}>{search?"找不到結果":"目前沒有訂購人"}</div>;
            // 跨所有訂購人的上游總計 (供搜尋過濾後的小摘要)
            const grandSup={};
            fb.forEach(b=>{Object.entries(b.supplierTotals||{}).forEach(([k,v])=>{grandSup[k]=(grandSup[k]||0)+v;});});
            const grandSupEnts=Object.entries(grandSup).sort((a,b)=>b[1]-a[1]);
            // 搜尋時:若 search term 命中代購名 → 把代購匯總卡片列在最上面
            const matchedIdents = search ? identitiesAggregated.filter(idn => idn.name.toLowerCase().includes(s)) : [];
            return (<>
              {matchedIdents.length > 0 && (
                <div style={{ background:"#fffbf0",border:"1px solid #e4d4a0",borderRadius:10,padding:"10px 14px" }}>
                  <div style={{ fontSize:12,fontWeight:700,color:"#7a6028",marginBottom:8 }}>👥 代購匹配 ({matchedIdents.length}):這個名字以「代購層」存在於以下訂購人底下</div>
                  <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                    {matchedIdents.map(idn => {
                      const supEnts2 = Object.entries(idn.supplierTotals||{}).sort((a,b)=>b[1]-a[1]);
                      const buyerEnts = Object.entries(idn.buyerTotals||{}).sort((a,b)=>b[1]-a[1]);
                      const isExp2 = expandedId === `idn-${idn.name}`;
                      return (
                        <div key={idn.name} style={{ background:"#fff",borderRadius:8,border:"1px solid #e6d8a0",overflow:"hidden",borderLeft:"4px solid #c89030" }}>
                          <div onClick={()=>setExpandedId(isExp2?null:`idn-${idn.name}`)} style={{ padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                            <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                              <span style={{ fontWeight:700,fontSize:14,color:"#7a6028" }}>👥 {idn.name}</span>
                              <span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:10,background:"#f0ede8",color:"#8b7355" }}>{idn.totalQty} 張 · {idn.orders.length} 場</span>
                              {supEnts2.length > 0 && (
                                <span style={{ fontSize:11,padding:"2px 8px",borderRadius:10,background:"#fffaeb",border:"1px solid #e6d8a0",color:"#7a6028" }}>
                                  {supEnts2.map(([s,q],j)=>(<span key={s}>{j>0&&<span style={{opacity:.4,margin:"0 3px"}}>·</span>}<span>{s}</span> <b style={{color:"#b8531a"}}>{q}</b></span>))}
                                </span>
                              )}
                              <span style={{ fontSize:11,color:"#888" }}>↳ 訂購人: {buyerEnts.map(([n,q],j)=>(<span key={n}>{j>0 && ", "}{n}({q})</span>))}</span>
                            </div>
                            <span style={{ fontSize:14,color:"#ccc",transition:"transform .2s",transform:isExp2?"rotate(180deg)":"" }}>▾</span>
                          </div>
                          {isExp2 && (
                            <div style={{ padding:"0 14px 12px",borderTop:"1px solid #f0ede8" }}>
                              <div style={{ fontSize:11,color:"#888",margin:"8px 0 6px" }}>📅 各場次明細:</div>
                              <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                                {idn.orders.map((o,j) => (
                                  <div key={j} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#faf9f6",borderRadius:6,fontSize:12 }}>
                                    <span style={{ fontWeight:700,color:"#5a4a2a",flex:1 }}>{o.eventName}</span>
                                    <span style={{ color:"#666" }}>訂購人:<b style={{color:"#7a6850"}}>{o.buyerName}</b></span>
                                    <span style={{ color:"#888" }}>·</span>
                                    {o.supplier && <span style={{ fontSize:10,padding:"1px 6px",borderRadius:4,background:"#fffaeb",color:"#7a6028",border:"1px solid #e6d8a0" }}>📦 {o.supplier}</span>}
                                    <span style={{ fontWeight:700,color:"#b8531a",minWidth:50,textAlign:"right" }}>{o.qty} 張</span>
                                    <button onClick={()=>{setTab("active");setSearch("");setTimeout(()=>setExpandedId(o.eventId),50);}} style={{ fontSize:10,padding:"3px 8px",borderRadius:5,border:"1px solid #c4d0b0",background:"#e8f0e0",cursor:"pointer",color:"#5a7a3a",fontFamily:"inherit",fontWeight:600 }}>前往 →</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {grandSupEnts.length>0&&(
                <div style={{ background:"#fff9ec",border:"1px solid #e4d4a0",borderRadius:10,padding:"8px 14px",fontSize:12,color:"#7a6028" }}>
                  📦 上游總計 ({fb.length} 個訂購人):{grandSupEnts.map(([s,q],j)=>(<span key={s}>{j>0&&<span style={{opacity:.4,margin:"0 4px"}}>·</span>}<span style={{color:"#7a6850"}}>{s}</span> <b style={{color:"#b8531a"}}>{q}</b> 張</span>))}
                </div>
              )}
              {fb.map(buyer=>{
              const isExp=expandedId===`buyer-${buyer.name}`;
              const bc=buyer.unpaidQty>0?"#c47070":buyer.refundCount>0?"#c4a040":"#8b7355";
              const supEnts=Object.entries(buyer.supplierTotals||{}).sort((a,b)=>b[1]-a[1]);
              // 若搜尋是因為某個識別人名匹配上的,把命中的代購列出來給使用者線索
              const matchedIdentities = search ? Array.from(buyer.identityNames||[]).filter(nm => nm.toLowerCase().includes(s) && !buyer.name.toLowerCase().includes(s)) : [];
              return (<div key={buyer.name} className="anim-in" style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden",borderLeft:`4px solid ${bc}` }}>
                <div onClick={()=>setExpandedId(isExp?null:`buyer-${buyer.name}`)} style={{ padding:"14px 18px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700,fontSize:16 }}>{buyer.name}</span>
                      <span style={{ fontSize:12,fontWeight:700,padding:"2px 10px",borderRadius:12,background:"#f0ede8",color:"#8b7355" }}>{buyer.totalQty} 張 · {buyer.orders.length} 場</span>
                      {supEnts.length>0&&(
                        <span style={{ fontSize:11,padding:"2px 8px",borderRadius:10,background:"#fffaeb",border:"1px solid #e6d8a0",color:"#7a6028" }}>
                          {supEnts.map(([s,q],j)=>(<span key={s}>{j>0&&<span style={{opacity:.4,margin:"0 3px"}}>·</span>}<span>{s}</span> <b style={{color:"#b8531a"}}>{q}</b></span>))}
                        </span>
                      )}
                      {buyer.unpaidQty>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#fce8e8",color:"#8b3a3a" }}>未付款 {buyer.unpaidQty}張</span>}
                      {buyer.refundCount>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#f6f0e0",color:"#8b6a2d" }}>待退費 {buyer.refundCount}筆</span>}
                      {buyer.refundedCount>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#dfeadf",color:"#4a6b4a" }}>已退款 {buyer.refundedCount}筆</span>}
                      {buyer.pickedQty>0&&<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#e0eef6",color:"#2d6a8b" }}>已取票 {buyer.pickedQty}張</span>}
                    </div>
                    {matchedIdentities.length > 0 && (
                      <div style={{ marginTop:6,fontSize:11,color:"#7a6028",padding:"3px 8px",background:"#fffaeb",borderRadius:6,border:"1px solid #e6d8a0",display:"inline-block" }}>
                        🔍 命中代購: <b>{matchedIdentities.join(" · ")}</b>
                      </div>
                    )}
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
            })}
            </>);
            })()}
        </div>)}

        {/* Identity (實名簿) view */}
        {!showLog&&tab==="identity"&&(<div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {(() => {
            const s = search.toLowerCase();
            const fc = search ? identityCatalog.filter(e => e.name.toLowerCase().includes(s) || (e.phone||"").includes(s) || (e.idNumber||"").toLowerCase().includes(s) || (e.tixAccount||"").toLowerCase().includes(s)) : identityCatalog;
            if (fc.length === 0) return <div style={{ textAlign:"center",padding:40,color:"#999" }}>{search?"找不到結果":"目前還沒有實名資料"}</div>;
            return (<>
              <div style={{ background:"#fff3e0",borderRadius:12,border:"1px solid #e6b87a",padding:"10px 14px",fontSize:12,color:"#7a5a30",lineHeight:1.6 }}>
                📇 共 {identityCatalog.length} 筆獨立實名資料{search?` · 篩選後 ${fc.length} 筆`:""}<br/>
                <span style={{ fontSize:11,color:"#a08850" }}>同名但身分證/電話/拓元帳號不同 → 算成不同筆。在這邊改一筆會「同步」到所有使用該筆的場次。</span>
              </div>
              {fc.map(entry => {
                const isEditing = editingCatalogKey === entry.key;
                return (<div key={entry.key} className="anim-in" style={{ background:"#fff",borderRadius:14,border:"1px solid #e4e0d8",overflow:"hidden",borderLeft:"4px solid #8b7355" }}>
                  {isEditing ? (
                    <IdentityCatalogEditor
                      entry={entry}
                      onSave={form => {
                        setConfirmModal({
                          msg:`這個動作會更新 ${entry.refs.length} 個場次裡的「${entry.name}」實名資料。

確定要批改嗎？`,
                          yesLabel:"✓ 確定批改",
                          onYes:()=>{
                            updateIdentityAcrossEvents(entry.key, form);
                            setEditingCatalogKey(null);
                            setConfirmModal(null);
                          }
                        });
                      }}
                      onCancel={()=>setEditingCatalogKey(null)}
                    />
                  ) : (
                    <div style={{ padding:"14px 18px" }}>
                      <div style={{ display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap",marginBottom:8 }}>
                        <span style={{ fontWeight:700,fontSize:16 }}>{entry.name}</span>
                        <span style={{ fontSize:12,fontWeight:700,padding:"2px 10px",borderRadius:12,background:"#f0ede8",color:"#8b7355" }}>{entry.refs.length} 場次</span>
                        {entry.locked && <span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:10,background:"#fce8e8",color:"#8b3a3a" }}>🔒 帳號鎖</span>}
                        <button onClick={()=>setEditingCatalogKey(entry.key)} style={{ marginLeft:"auto",padding:"5px 14px",borderRadius:7,border:"1px solid #d4d0c8",background:"#faf9f6",fontSize:12,cursor:"pointer",fontWeight:700,color:"#8b7355",fontFamily:"inherit" }}>編輯</button>
                      </div>
                      <div style={{ display:"flex",gap:14,flexWrap:"wrap",fontSize:13,color:"#555",marginBottom:10 }}>
                        <span>📱 {entry.phone||<span style={{ color:"#bbb" }}>(未填)</span>}</span>
                        <span>🆔 {entry.idNumber||<span style={{ color:"#bbb" }}>(未填)</span>}</span>
                        <span>🎫 {entry.tixAccount||<span style={{ color:"#bbb" }}>(未填)</span>}</span>
                        {entry.loginVia && <span>登入: {entry.loginVia === "facebook" ? "FB" : "Google"}</span>}
                      </div>
                      <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                        {entry.refs.map((r, i) => {
                          const sl = r.eventStatus==="done"?"已完成":r.eventStatus==="picked"?"已取票":"進行中";
                          const sc = r.eventStatus==="done"?{bg:"#f0ede8",color:"#8b7355"}:r.eventStatus==="picked"?{bg:"#e0eef6",color:"#2d6a8b"}:{bg:"#dfeadf",color:"#4a6b4a"};
                          return (<button key={i} onClick={()=>jumpToEvent(r.eventId, r.eventStatus)} style={{ padding:"4px 10px",borderRadius:8,border:`1px solid ${sc.color}33`,background:sc.bg,fontSize:11,cursor:"pointer",fontWeight:600,color:sc.color,fontFamily:"inherit" }} title={`${sl} · 訂購人: ${r.buyerName} · 點擊前往`}>{r.eventName} <span style={{ opacity:.6 }}>({r.buyerName})</span> →</button>);
                        })}
                      </div>
                    </div>
                  )}
                </div>);
              })}
            </>);
          })()}
        </div>)}

        {/* Order Log (訂購日曆) view — 依訂購日期分組看 batch */}
        {!showLog&&tab==="orderlog"&&(<div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          {orderLogData.length===0?(
            <div style={{ background:"#fff",borderRadius:12,padding:"40px 20px",textAlign:"center",color:"#999" }}>
              <div style={{ fontSize:36,marginBottom:8 }}>📅</div>
              <div style={{ fontSize:14,fontWeight:700,marginBottom:4 }}>還沒有訂購紀錄</div>
              <div style={{ fontSize:11 }}>每次新增訂購人 / 分批時,系統會記錄訂購日期到這裡</div>
            </div>
          ):(<>
            {/* 上游切換 + 摘要 */}
            {(() => {
              // 收集所有有出現過的上游名稱
              const supplierSet = new Set();
              orderLogData.forEach(g => g.items.forEach(it => { if (it.supplier) supplierSet.add(it.supplier); }));
              const allSuppliers = Array.from(supplierSet).sort((a, b) => a.localeCompare(b, "zh-TW"));
              // 計算當前 filter 下的統計
              const passesFilter = (it) => orderLogSupplierFilter === "all" || it.supplier === orderLogSupplierFilter;
              const filteredGroups = orderLogData.map(g => {
                const filtered = g.items.filter(passesFilter);
                return { ...g, items: filtered, totalQty: filtered.reduce((s,x)=>s+x.qty,0), supplierQty: filtered.filter(x=>x.source==="supplier").reduce((s,x)=>s+x.qty,0), buyerQty: filtered.filter(x=>x.source==="buyer").reduce((s,x)=>s+x.qty,0) };
              }).filter(g => g.items.length > 0);
              const totalSup = filteredGroups.reduce((s,d)=>s+d.supplierQty,0);
              const totalBuy = filteredGroups.reduce((s,d)=>s+d.buyerQty,0);
              return (
                <>
                  {allSuppliers.length > 0 && (
                    <div style={{ background:"#fff",borderRadius:10,padding:"10px 12px",display:"flex",gap:6,flexWrap:"wrap",alignItems:"center" }}>
                      <span style={{ fontSize:11,color:"#888",marginRight:4 }}>上游:</span>
                      {[{key:"all",label:"全部"}, ...allSuppliers.map(s => ({key:s, label:s}))].map(opt => (
                        <button key={opt.key} onClick={()=>setOrderLogSupplierFilter(opt.key)} style={{ padding:"5px 12px",borderRadius:7,border:"none",fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:700,background:orderLogSupplierFilter===opt.key?"#b8531a":"#f7f3ec",color:orderLogSupplierFilter===opt.key?"#fff":"#666" }}>{opt.label}</button>
                      ))}
                    </div>
                  )}
                  <div style={{ background:"#fff9ec",border:"1px solid #e4d4a0",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#7a6028" }}>
                    📊 共 <b>{filteredGroups.length}</b> 個訂購日 · 
                    {totalSup>0 && <> <span style={{color:"#4a7a4a"}}>📦 上游進貨 <b>{totalSup}</b> 張</span> · </>}
                    {totalBuy>0 && <span style={{color:"#b8531a"}}>👥 買家異動 <b>{totalBuy}</b> 張</span>}
                    {orderLogSupplierFilter !== "all" && <span style={{ marginLeft:8,fontSize:10,color:"#aa7030" }}>(只看 {orderLogSupplierFilter})</span>}
                  </div>
                  {filteredGroups.map(group => {
              const d = new Date(group.date + "T00:00:00");
              const weekday = ["日","一","二","三","四","五","六"][d.getDay()];
              const monthDay = `${d.getMonth()+1}/${d.getDate()}`;
              const year = d.getFullYear();
              const byEvent = new Map();
              group.items.forEach(it => {
                if (!byEvent.has(it.eventName)) byEvent.set(it.eventName, { eventName: it.eventName, eventId: it.eventId, eventStatus: it.eventStatus, supplierItems: [], buyerItems: [], qty: 0 });
                const ev = byEvent.get(it.eventName);
                if (it.source === "supplier") ev.supplierItems.push(it);
                else ev.buyerItems.push(it);
                ev.qty += it.qty;
              });
              const eventGroups = Array.from(byEvent.values()).sort((a,b)=>b.qty-a.qty);
              return (
                <div key={group.date} style={{ background:"#fff",borderRadius:12,padding:"14px 16px",boxShadow:"0 2px 8px rgba(0,0,0,.04)" }}>
                  <div style={{ display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:10,paddingBottom:8,borderBottom:"1px solid #f0ece2" }}>
                    <div>
                      <span style={{ fontSize:18,fontWeight:800,color:"#2d2a26" }}>{monthDay}</span>
                      <span style={{ fontSize:11,color:"#888",marginLeft:8 }}>{year} · 週{weekday}</span>
                    </div>
                    <div style={{ fontSize:12,fontWeight:700 }}>
                      {group.supplierQty>0 && <span style={{color:"#4a7a4a",marginRight:8}}>📦 {group.supplierQty}</span>}
                      {group.buyerQty>0 && <span style={{color:"#b8531a"}}>👥 {group.buyerQty}</span>}
                    </div>
                  </div>
                  <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                    {eventGroups.map((eg, ei) => (
                      <div key={ei} style={{ padding:"4px 0",fontSize:12 }}>
                        <div style={{ display:"flex",alignItems:"baseline",gap:8,marginBottom:eg.supplierItems.length||eg.buyerItems.length?4:0 }}>
                          <button onClick={()=>jumpToEvent(eg.eventId, eg.eventStatus)} style={{ padding:"2px 8px",borderRadius:5,border:"1px solid #d4d0c8",background:"#faf9f6",fontSize:11,cursor:"pointer",fontFamily:"inherit",color:"#5a5046",fontWeight:600,minWidth:0,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }} title={eg.eventName}>{eg.eventName}</button>
                          <span style={{ color:"#b8531a",fontWeight:700,fontSize:11 }}>{eg.qty} 張</span>
                        </div>
                        {eg.supplierItems.length>0 && (
                          <div style={{ paddingLeft:10,fontSize:11,color:"#4a7a4a",marginTop:2 }}>
                            <span style={{ fontSize:10,opacity:.7,marginRight:4 }}>📦 上游</span>
                            {eg.supplierItems.map((b, bi) => (
                              <span key={bi} style={{ marginRight:8 }}>
                                {b.supplier||"上游"} <b>{b.qty}</b>
                              </span>
                            ))}
                          </div>
                        )}
                        {eg.buyerItems.length>0 && (
                          <div style={{ paddingLeft:10,fontSize:11,color:"#666",marginTop:2 }}>
                            <span style={{ fontSize:10,opacity:.7,marginRight:4 }}>👥 買家</span>
                            {eg.buyerItems.map((b, bi) => (
                              <span key={bi} style={{ marginRight:8 }}>
                                {b.buyerName} <b style={{color:"#b8531a"}}>{b.qty}</b>
                                {b.st!=="normal" && <span style={{ marginLeft:3,padding:"0 4px",borderRadius:3,background:BUYER_STATUS[b.st]?.bg||"#eee",color:BUYER_STATUS[b.st]?.color||"#999",fontSize:9,fontWeight:700 }}>{BUYER_STATUS[b.st]?.icon||""}</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
                </>
              );
            })()}
          </>)}
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
              { key:"sync", label:"同步/合併", icon:"🔄", count:counts.sync||0, color:"#5a8aab" },
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
          <AddEventForm onAdd={(name,price)=>{ addLog(`新增場次【${name}】`,snap()); setEvents(evs=>[...evs,{id:gid(),name,price,status:"active",tixOnly:true,buyers:[]}]); setShowAddEvent(false); }}/>
        </div>
      </div>)}

      {confirmModal&&<ConfirmModal msg={confirmModal.msg} onYes={confirmModal.onYes} onNo={confirmModal.onNo||(()=>setConfirmModal(null))} onDismiss={confirmModal.onDismiss||confirmModal.onNo||(()=>setConfirmModal(null))} yesLabel={confirmModal.yesLabel} noLabel={confirmModal.noLabel} maxWidth={confirmModal.maxWidth}/>}
      {inputModal&&<InputModal title={inputModal.title} label={inputModal.label} defaultValue={inputModal.defaultValue} placeholder={inputModal.placeholder} onSave={inputModal.onSave} onCancel={()=>setInputModal(null)}/>}
      {identityExportModal&&<IdentityExportModal events={identityExportModal.events} title={identityExportModal.title} onClose={()=>setIdentityExportModal(null)}/>}
      {buyerExportModal&&<BuyerExportModal buyers={buyerExportModal.buyers} title={buyerExportModal.title} onClose={()=>setBuyerExportModal(null)}/>}
      {importIdentityModal&&(()=>{const e=events.find(x=>x.id===importIdentityModal.eventId);return e?<BatchImportIdentityModal event={e} onClose={()=>setImportIdentityModal(null)} onConfirm={(additions)=>{bulkImportIdentities(e.id,additions);setImportIdentityModal(null);}}/>:null;})()}
      {realnameLinkModal&&(()=>{const e=events.find(x=>x.id===realnameLinkModal.eventId);const b=e?.buyers?.[realnameLinkModal.buyerIdx];return e&&b?<RealnameLinkModal event={e} buyer={b} onClose={()=>setRealnameLinkModal(null)} onRegenerate={()=>regenerateRealnameLink(realnameLinkModal.eventId,realnameLinkModal.buyerIdx)}/>:null;})()}
      {identityLinkModal&&(()=>{const e=events.find(x=>x.id===identityLinkModal.eventId);const b=e?.buyers?.[identityLinkModal.buyerIdx];const it=b?.identities?.find(x=>x.id===identityLinkModal.identityId);return e&&b&&it?<IdentityRealnameLinkModal event={e} buyer={b} identity={it} onClose={()=>setIdentityLinkModal(null)} onRegenerate={()=>regenerateIdentityRealnameLink(identityLinkModal.eventId,identityLinkModal.buyerIdx,identityLinkModal.identityId)}/>:null;})()}
      {supplierEditModal && (()=>{
        const e = events.find(x => x.id === supplierEditModal.eventId);
        const b = e?.buyers?.[supplierEditModal.buyerIdx];
        if (!e || !b) return null;
        const onChange = (bi, newSupplier) => {
          updateEvent(e.id, ev => {
            const batches = [...(ev.buyers[supplierEditModal.buyerIdx].batches || [])];
            const old = batches[bi].detail || "";
            // 移除舊的「X供」部分,加上新的(若有)
            const cleaned = old.replace(/[^\s·]+?供\s*/g, "").trim();
            const newDetail = newSupplier.trim() ? `${newSupplier.trim()}供${cleaned ? " " + cleaned : ""}` : cleaned;
            batches[bi] = { ...batches[bi], detail: newDetail };
            ev.buyers[supplierEditModal.buyerIdx] = { ...ev.buyers[supplierEditModal.buyerIdx], batches };
            return ev;
          });
        };
        return <BatchSupplierEditor event={e} buyer={b} onChange={onChange} onClose={()=>setSupplierEditModal(null)}/>;
      })()}
      {mergeEventModal && (()=>{
        const fromEvt = events.find(x => x.id === mergeEventModal.fromEventId);
        if (!fromEvt) return null;
        return <MergeEventModal fromEvent={fromEvt} allEvents={events} onClose={()=>setMergeEventModal(null)} onConfirm={(toId)=>mergeIntoEvent(fromEvt.id, toId)}/>;
      })()}
      {dataDiffModal&&dataDiff&&!dataDiff.noPayload&&<DataDiffModal diff={dataDiff} onClose={()=>setDataDiffModal(null)} onRestore={(key)=>{setConfirmModal({msg:`確定要還原到 ${key} 的快照嗎?\n\n${key} 之後的所有變更都會消失。建議先 💾 匯出備份再操作。`,yesLabel:"確定還原",onYes:()=>{restoreFromDaily(key);setConfirmModal(null);setDataDiffModal(null);}});}}/>}
    </div>
  );
}

// 實名姓名 input 帶 autocomplete:輸入時下拉顯示歷史候選,
// 點選後一鍵帶入 phone / idNumber / tixAccount / loginVia / locked (memberNo 不帶,每場不同)
// 已填的欄位不會被覆蓋
function IdentityNameAutocomplete({ identity, history, onFill, isTix = true }) {
  const [showDropdown, setShowDropdown] = useState(false);
  // 下拉位置:預設往下,空間不夠時翻到上面;maxH 跟著可用空間調
  const [pos, setPos] = useState({ dir: "down", maxH: 280, left: 0, width: 0, topPx: 0, bottomPx: 0 });
  const ref = useRef(null);
  const inputRef = useRef(null);
  // 觸控捲動偵測:手指滑動超過 8px 就視為「在捲動」,不要觸發 onClick
  const dragRef = useRef({ y: 0, moved: false });
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setShowDropdown(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // 開啟下拉時動態計算位置 / 高度,避免超出畫面
  useEffect(() => {
    if (!showDropdown) return;
    const recalc = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      // 偵測祖先的 CSS zoom (桌機是 1.3,手機是 1)
      // getBoundingClientRect 回傳的是視覺座標 (已乘 zoom),
      // 但 fixed 元素的 top/left 又會再被 zoom 一次 → 必須除以 zoom 抵消
      let zoom = 1;
      try {
        const bz = parseFloat(getComputedStyle(document.body).zoom) || 1;
        const hz = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        zoom = bz * hz;
      } catch {}
      // 全部轉成 layout 單位
      const lLeft = rect.left / zoom;
      const lWidth = rect.width / zoom;
      const lTop = rect.top / zoom;
      const lBottom = rect.bottom / zoom;
      const lVh = window.innerHeight / zoom;
      const PAD = 8;
      const below = lVh - lBottom - PAD;
      const above = lTop - PAD;
      // PREFERRED:取「440px」跟「視窗 70%」較小者
      const PREFERRED = Math.min(440, Math.floor(lVh * 0.7));
      // 因為改 position:fixed,maxH 直接夾在可用空間內,不會超出螢幕
      let dir, maxH;
      if (below >= above) { dir = "down"; maxH = Math.min(PREFERRED, Math.max(120, below)); }
      else { dir = "up"; maxH = Math.min(PREFERRED, Math.max(120, above)); }
      setPos({
        dir, maxH,
        left: lLeft, width: lWidth,
        topPx: lBottom + 4,
        bottomPx: lVh - lTop + 4,
      });
    };
    recalc();
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [showDropdown]);

  const q = (identity.name || "").trim().toLowerCase();
  const candidates = useMemo(() => {
    const items = [];
    for (const [nm, records] of history.entries()) {
      const nmLc = nm.toLowerCase();
      if (q && !nmLc.includes(q)) continue;
      records.forEach(r => items.push({ name: nm, ...r }));
    }
    // 排序:完全相符 > 前綴相符 > 子字串相符 > zh-TW 字母順
    if (q) {
      items.sort((a, b) => {
        const aL = a.name.toLowerCase(), bL = b.name.toLowerCase();
        const aExact = aL === q ? 0 : 1, bExact = bL === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        const aStart = aL.startsWith(q) ? 0 : 1, bStart = bL.startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return a.name.localeCompare(b.name, "zh-TW");
      });
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
    }
    return items.slice(0, 30); // 最多 30 筆,避免下拉太長
  }, [history, q]);

  const handlePick = (record) => {
    // 只填空欄位 (不覆蓋使用者已經填的);
    // 且只在「記錄裡真的有資料」時才填,避免寫入空字串造成假上傳
    const updates = { name: record.name };
    if (!identity.phone && record.phone) updates.phone = record.phone;
    if (!identity.idNumber && record.idNumber) updates.idNumber = record.idNumber;
    // 拓元專屬欄位:非拓元場不帶,避免悄悄寫入隱藏欄位造成困惑
    if (isTix) {
      if (!identity.tixAccount && record.tixAccount) updates.tixAccount = record.tixAccount;
      if (!identity.loginVia && record.loginVia) updates.loginVia = record.loginVia;
      if ((identity.locked === undefined || identity.locked === null) && record.locked) {
        updates.locked = true;
      }
    }
    // 注意:不填 memberNo (每場不同) 也不填 qty (是當前場次的張數)
    onFill(updates);
    setShowDropdown(false);
  };

  return (
    <label style={{ display:"flex",flexDirection:"column",gap:2,fontSize:10,color:"#888",position:"relative" }} ref={ref}>
      <span style={{ fontWeight:600 }}>姓名</span>
      <input
        ref={inputRef}
        value={identity.name || ""}
        onChange={e => { onFill({ name: e.target.value }); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        placeholder="中文姓名 (打字看歷史)"
        style={{ padding:"5px 7px",borderRadius:5,border:"1px solid #d4d0c8",fontSize:12,fontFamily:"inherit",background:"#faf9f6" }}
      />
      {showDropdown && candidates.length > 0 && (
        <div
          onTouchStart={e=>{ dragRef.current = { y: e.touches[0].clientY, moved: false }; }}
          onTouchMove={e=>{ if (Math.abs(e.touches[0].clientY - dragRef.current.y) > 8) dragRef.current.moved = true; }}
          style={{
            position:"fixed", left:pos.left, width:pos.width, zIndex:1000,
            background:"#fff", borderRadius:6,
            border:"1px solid #c4b89a", boxShadow:"0 6px 18px rgba(0,0,0,.15)",
            maxHeight:pos.maxH, overflowY:"auto", WebkitOverflowScrolling:"touch",
            ...(pos.dir === "down" ? { top:pos.topPx - 2 } : { bottom:pos.bottomPx - 2 })
        }}>
          {candidates.map((c, ci) => (
            <div key={ci} onClick={() => { if (dragRef.current.moved) return; handlePick(c); }}
              style={{
                padding:"7px 10px", cursor:"pointer",
                borderBottom: ci < candidates.length - 1 ? "1px solid #f0ede8" : "none",
                fontFamily:"inherit"
              }}
              onMouseOver={e => e.currentTarget.style.background = "#faf7f0"}
              onMouseOut={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ fontSize:13, fontWeight:700, color:"#2d2a26" }}>{c.name}</div>
              <div style={{ fontSize:10, color:"#999", marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
                {c.idNumber && <span>🆔 {c.idNumber}</span>}
                {c.phone && <span>📱 {c.phone}</span>}
                {isTix && c.tixAccount && <span>🎫 {c.tixAccount}</span>}
                {isTix && c.loginVia === "facebook" && <span>FB</span>}
                {isTix && c.loginVia === "google" && <span>G</span>}
                {isTix && c.locked && <span style={{ color:"#c47070" }}>🔒</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </label>
  );
}

// 實名簿編輯器:單一卡片內的編輯模式,儲存時呼叫 onSave 帶上新值
function IdentityCatalogEditor({ entry, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: entry.name,
    phone: entry.phone,
    idNumber: entry.idNumber,
    tixAccount: entry.tixAccount,
    loginVia: entry.loginVia,
    locked: entry.locked,
  });
  const update = (patch) => setForm(prev => ({ ...prev, ...patch }));
  return (
    <div style={{ padding:"14px 18px",background:"#fff9ec",borderTop:"1px dashed #d8c4a8" }}>
      <div style={{ display:"flex",alignItems:"baseline",gap:10,marginBottom:10 }}>
        <span style={{ fontSize:13,fontWeight:700,color:"#7a5a30" }}>編輯實名資料</span>
        <span style={{ fontSize:11,color:"#a08850" }}>(會同步到 {entry.refs.length} 個場次)</span>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:10,marginBottom:12 }}>
        {[
          { key:"name", label:"姓名", ph:"中文姓名" },
          { key:"phone", label:"電話", ph:"09xx..." },
          { key:"idNumber", label:"身分證", ph:"A123..." },
          { key:"tixAccount", label:"拓元帳號", ph:"帳號 / Email" },
        ].map(field => (
          <label key={field.key} style={{ display:"flex",flexDirection:"column",gap:3,fontSize:11,color:"#888" }}>
            <span style={{ fontWeight:600 }}>{field.label}</span>
            <input value={form[field.key]||""} onChange={e=>update({[field.key]: e.target.value})} placeholder={field.ph}
              style={{ padding:"7px 10px",borderRadius:6,border:"1px solid #d4d0c8",fontSize:13,fontFamily:"inherit",background:"#fff" }}/>
          </label>
        ))}
        <label style={{ display:"flex",flexDirection:"column",gap:3,fontSize:11,color:"#888" }}>
          <span style={{ fontWeight:600 }}>登入方式</span>
          <select value={form.loginVia||""} onChange={e=>update({loginVia: e.target.value})}
            style={{ padding:"7px 10px",borderRadius:6,border:"1px solid #d4d0c8",fontSize:13,fontFamily:"inherit",background:"#fff" }}>
            <option value="">未選</option>
            <option value="facebook">Facebook</option>
            <option value="google">Google</option>
          </select>
        </label>
        <label style={{ display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#666",cursor:"pointer",alignSelf:"end",padding:"7px 0" }}>
          <input type="checkbox" checked={!!form.locked} onChange={e=>update({locked: e.target.checked})} style={{ cursor:"pointer",margin:0 }}/>
          <span style={{ fontWeight:600 }}>🔒 拓元帳號被鎖</span>
        </label>
      </div>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
        <button onClick={onCancel} style={{ padding:"7px 16px",borderRadius:7,border:"1px solid #d4d0c8",background:"#fff",fontSize:12,cursor:"pointer",fontWeight:600,color:"#999",fontFamily:"inherit" }}>取消</button>
        <button onClick={()=>onSave(form)} style={{ padding:"7px 18px",borderRadius:7,border:"none",background:"#2d2a26",color:"#faf9f6",fontSize:12,cursor:"pointer",fontWeight:700,fontFamily:"inherit" }}>儲存(批改)</button>
      </div>
    </div>
  );
}

function AddBuyerRow({ eventId, buyerNames, onAdd }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState("");
  // 下拉位置:預設往下,空間不夠時翻到上面;maxH 跟著可用空間調
  const [pos, setPos] = useState({ dir: "down", maxH: 280, left: 0, width: 0, topPx: 0, bottomPx: 0 });
  const ref = useRef(null);
  const inputRef = useRef(null);
  // 觸控捲動偵測:手指滑動超過 8px 就視為「在捲動」,不要觸發 onClick
  const dragRef = useRef({ y: 0, moved: false });
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setShowDropdown(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);

  // 開啟下拉時動態計算位置 / 高度,避免超出畫面
  useEffect(() => {
    if (!showDropdown) return;
    const recalc = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      // 偵測祖先的 CSS zoom (桌機是 1.3,手機是 1)
      // getBoundingClientRect 回傳的是視覺座標 (已乘 zoom),
      // 但 fixed 元素的 top/left 又會再被 zoom 一次 → 必須除以 zoom 抵消
      let zoom = 1;
      try {
        const bz = parseFloat(getComputedStyle(document.body).zoom) || 1;
        const hz = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        zoom = bz * hz;
      } catch {}
      // 全部轉成 layout 單位
      const lLeft = rect.left / zoom;
      const lWidth = rect.width / zoom;
      const lTop = rect.top / zoom;
      const lBottom = rect.bottom / zoom;
      const lVh = window.innerHeight / zoom;
      const PAD = 8;
      const below = lVh - lBottom - PAD;
      const above = lTop - PAD;
      // PREFERRED:取「440px」跟「視窗 70%」較小者
      const PREFERRED = Math.min(440, Math.floor(lVh * 0.7));
      // 因為改 position:fixed,maxH 直接夾在可用空間內,不會超出螢幕
      let dir, maxH;
      if (below >= above) { dir = "down"; maxH = Math.min(PREFERRED, Math.max(120, below)); }
      else { dir = "up"; maxH = Math.min(PREFERRED, Math.max(120, above)); }
      setPos({
        dir, maxH,
        left: lLeft, width: lWidth,
        topPx: lBottom + 4,
        bottomPx: lVh - lTop + 4,
      });
    };
    recalc();
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [showDropdown]);

  const q = filter.trim().toLowerCase();
  const fl = buyerNames.filter(n => !q || n.toLowerCase().includes(q));
  // 排序:完全相符 > 前綴相符 > 子字串相符 > zh-TW 字母順
  if (q) {
    fl.sort((a, b) => {
      const aL = a.toLowerCase(), bL = b.toLowerCase();
      const aExact = aL === q ? 0 : 1, bExact = bL === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStart = aL.startsWith(q) ? 0 : 1, bStart = bL.startsWith(q) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return a.localeCompare(b, "zh-TW");
    });
  }

  return (
    <div ref={ref} style={{ position:"relative",marginTop:10 }}>
      <div style={{ display:"flex",gap:6 }}>
        <input ref={inputRef} value={filter} onChange={e=>{setFilter(e.target.value);setShowDropdown(true);}} onFocus={()=>setShowDropdown(true)} placeholder="選擇或輸入新客人名字..."
          style={{ flex:1,padding:"8px 12px",borderRadius:8,border:"1.5px solid #d4d0c8",fontSize:14,fontFamily:"inherit",background:"#faf9f6" }}/>
        {filter.trim()&&!buyerNames.includes(filter.trim())&&(
          <button onClick={()=>{onAdd(eventId,filter.trim());setFilter("");setShowDropdown(false);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",background:"#2d2a26",color:"#faf9f6",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap" }}>＋ 新增「{filter.trim()}」</button>
        )}
      </div>
      {showDropdown&&fl.length>0&&(
        <div
          onTouchStart={e=>{ dragRef.current = { y: e.touches[0].clientY, moved: false }; }}
          onTouchMove={e=>{ if (Math.abs(e.touches[0].clientY - dragRef.current.y) > 8) dragRef.current.moved = true; }}
          style={{
            position:"fixed",left:pos.left,width:pos.width,
            background:"#fff",borderRadius:10,border:"1px solid #e4e0d8",boxShadow:"0 8px 24px rgba(0,0,0,.12)",
            maxHeight:pos.maxH,overflowY:"auto",WebkitOverflowScrolling:"touch",zIndex:1000,
            ...(pos.dir === "down" ? { top:pos.topPx } : { bottom:pos.bottomPx })
          }}>
          {fl.map(name=>(<div key={name} onClick={()=>{ if (dragRef.current.moved) return; onAdd(eventId,name);setFilter("");setShowDropdown(false);}} style={{ padding:"8px 14px",cursor:"pointer",fontSize:14,borderBottom:"1px solid #f5f3ef",transition:"background .1s" }} onMouseOver={e=>e.target.style.background="#f5f3ef"} onMouseOut={e=>e.target.style.background="transparent"}>{name}</div>))}
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

// ─── 入口 wrapper:有 ?fill=TOKEN 就走實名填寫頁,否則走主 app ───
export default function App() {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const fillToken = params.get("fill");
    if (fillToken) return <RealnameFormPage token={fillToken} />;
  }
  return <MainApp />;
}
