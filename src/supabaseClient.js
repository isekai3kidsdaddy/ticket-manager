import { createClient } from "@supabase/supabase-js";

// Vercel 環境變數會在 build 時自動注入到 import.meta.env
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_READY = Boolean(URL && KEY);
export const supabase = SUPABASE_READY ? createClient(URL, KEY) : null;

const ROW_ID = 1;
const TABLE = "app_state";

export async function loadFromSupabase() {
  if (!SUPABASE_READY) return null;
  const { data, error } = await supabase.from(TABLE).select("payload, updated_at").eq("id", ROW_ID).maybeSingle();
  if (error) { console.warn("Supabase load error:", error); return null; }
  if (!data) return null;
  return { payload: data.payload, updatedAt: data.updated_at };
}

// Optimistic concurrency control: 上傳前比對 lastKnownUpdatedAt
// - 如果雲端的 updated_at 比 lastKnownUpdatedAt 新 → 表示有其他裝置改過 → 不要覆蓋
// - 回傳 { ok: false, reason: "stale", remote: {...} } 讓上層決定怎麼處理
export async function saveToSupabase(payload, lastKnownUpdatedAt) {
  if (!SUPABASE_READY) return { ok: false, reason: "no-config" };

  // 1) 先檢查雲端目前的 updated_at
  if (lastKnownUpdatedAt) {
    const { data: remote, error: readErr } = await supabase.from(TABLE).select("updated_at").eq("id", ROW_ID).maybeSingle();
    if (readErr) { console.warn("Supabase precheck error:", readErr); return { ok: false, reason: readErr.message }; }
    if (remote && remote.updated_at && remote.updated_at !== lastKnownUpdatedAt) {
      // 雲端有更新的版本，可能是其他裝置改的
      // 把最新的拉下來給呼叫者，讓它決定要合併還是放棄
      const fresh = await loadFromSupabase();
      return { ok: false, reason: "stale", remote: fresh };
    }
  }

  // 2) 安全上傳
  const newTs = new Date().toISOString();
  const { error } = await supabase.from(TABLE).upsert({
    id: ROW_ID,
    payload,
    updated_at: newTs,
  });
  if (error) { console.warn("Supabase save error:", error); return { ok: false, reason: error.message }; }
  return { ok: true, updatedAt: newTs };
}
