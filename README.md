# 票券管家（雲端同步版）

## 環境變數
部署到 Vercel 時，要在專案的 Environment Variables 設定：
- `VITE_SUPABASE_URL` — 從 Supabase 專案 Settings → API 複製
- `VITE_SUPABASE_ANON_KEY` — 同上，anon public key

## Supabase 資料表
建一個叫 `app_state` 的 table：
- `id`: int8, primary key
- `payload`: jsonb
- `updated_at`: timestamptz

並建立 RLS policy 允許 anon select / insert / update。

## 開發
```
npm install
npm run dev
```
