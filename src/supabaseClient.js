import { createClient } from "@supabase/supabase-js";

// Vercel 環境變數會在 build 時自動注入到 import.meta.env
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_READY = Boolean(URL && KEY);
export const supabase = SUPABASE_READY ? createClient(URL, KEY) : null;

// 我們把整份資料當成「一個 row」存在 app_state 表裡，id 固定為 1
// 簡單、不容易出錯，適合單人使用的小工具
const ROW_ID = 1;
const TABLE = "app_state";

export async function loadFromSupabase() {
  if (!SUPABASE_READY) return null;
  const { data, error } = await supabase.from(TABLE).select("payload, updated_at").eq("id", ROW_ID).maybeSingle();
  if (error) { console.warn("Supabase load error:", error); return null; }
  if (!data) return null;
  return { payload: data.payload, updatedAt: data.updated_at };
}

export async function saveToSupabase(payload) {
  if (!SUPABASE_READY) return { ok: false, reason: "no-config" };
  const { error } = await supabase.from(TABLE).upsert({
    id: ROW_ID,
    payload,
    updated_at: new Date().toISOString(),
  });
  if (error) { console.warn("Supabase save error:", error); return { ok: false, reason: error.message }; }
  return { ok: true };
}
