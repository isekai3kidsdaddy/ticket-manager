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

// Atomic 條件式 update,避免兩台同時上傳時其中一台被悄悄覆蓋。
// - 強制模式 (options.force = true):匯入備份、衝突解決用,直接 upsert 不檢查
// - 正常模式:用 UPDATE ... WHERE id = ? AND updated_at = ? 做原子條件式寫入
//   兩台同時通過 precheck 也只有一台能真的寫入,另一台會拿到 0 rows affected → stale
// - 回傳 { ok: false, reason: "stale", remote: {...} } 讓上層做 3-way merge
export async function saveToSupabase(payload, lastKnownUpdatedAt, options) {
  if (!SUPABASE_READY) return { ok: false, reason: "no-config" };
  const force = options && options.force;
  const newTs = new Date().toISOString();

  // ── 強制模式:跳過所有檢查,直接 upsert ──
  if (force) {
    const { error } = await supabase.from(TABLE).upsert({
      id: ROW_ID, payload, updated_at: newTs,
    });
    if (error) { console.warn("Supabase force save error:", error); return { ok: false, reason: error.message }; }
    return { ok: true, updatedAt: newTs };
  }

  // ── 正常模式 ──
  // 1) 讀目前雲端的 updated_at
  const { data: remote, error: readErr } = await supabase.from(TABLE).select("updated_at").eq("id", ROW_ID).maybeSingle();
  if (readErr) { console.warn("Supabase precheck error:", readErr); return { ok: false, reason: readErr.message }; }

  // 2) 雲端 row 不存在 → 第一次寫入 (insert)
  if (!remote) {
    if (lastKnownUpdatedAt) {
      // 我們記得 lastKnownUpdatedAt 不是 null,但雲端 row 不見了 → 異常,當 stale
      return { ok: false, reason: "stale", remote: null };
    }
    const { error: insertErr } = await supabase.from(TABLE).insert({
      id: ROW_ID, payload, updated_at: newTs,
    });
    if (insertErr) {
      // Insert 失敗 (可能是 race:另一台同時 insert,撞 primary key) → 重讀當 stale
      console.warn("Supabase insert error:", insertErr);
      const fresh = await loadFromSupabase();
      return { ok: false, reason: "stale", remote: fresh };
    }
    return { ok: true, updatedAt: newTs };
  }

  // 3) Row 存在,但我們從沒成功 load 過 (lastKnownUpdatedAt=null) → 不能直接覆蓋
  if (!lastKnownUpdatedAt) {
    const fresh = await loadFromSupabase();
    return { ok: false, reason: "stale", remote: fresh };
  }

  // 4) Row 存在且我們知道上次的 TS,但 precheck 已發現雲端 TS 不符 → stale
  if (remote.updated_at !== lastKnownUpdatedAt) {
    const fresh = await loadFromSupabase();
    return { ok: false, reason: "stale", remote: fresh };
  }

  // 5) Atomic 條件式 update:只在 updated_at 還是 lastKnownUpdatedAt 時才寫入
  //    .select() 讓回傳值帶上實際被改的列,可以判斷是否真的有命中
  const { data: updated, error: updateErr } = await supabase
    .from(TABLE)
    .update({ payload, updated_at: newTs })
    .eq("id", ROW_ID)
    .eq("updated_at", lastKnownUpdatedAt)
    .select();

  if (updateErr) { console.warn("Supabase update error:", updateErr); return { ok: false, reason: updateErr.message }; }

  if (!updated || updated.length === 0) {
    // 0 rows affected → 另一台在我們 precheck 跟 update 之間搶先寫入 → stale
    const fresh = await loadFromSupabase();
    return { ok: false, reason: "stale", remote: fresh };
  }

  return { ok: true, updatedAt: newTs };
}
