// Vercel Serverless Function:貼演唱會網址 → 抓頁面 → Claude 抽出演出資訊
// 需要在 Vercel 設定環境變數 ANTHROPIC_API_KEY (選填 ANTHROPIC_MODEL)
import net from "node:net";
import dns from "node:dns/promises";

const MAX_TEXT = 60000;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  const p = ip.split(".").map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("只支援 http/https 網址");
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error("不允許的網址");
  return u;
}

function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const metas = [...html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:title|og:description|description)["'][^>]*content=["']([^"']*)["']/gi)].map(m => m[1]);
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
  return `標題:${title}\n描述:${metas.join(" / ")}\n結構化資料:${ld.slice(0, 4000)}\n內文:${body}`.slice(0, MAX_TEXT);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // 只允許自己網站的頁面呼叫,避免被別人盜刷 API
  const origin = req.headers.origin || "";
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "forbidden" }); } catch { return res.status(403).json({ error: "forbidden" }); } }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" });

  try {
    const { url, text } = req.body || {};
    let pageText = "";
    let sourceUrl = null;
    if (text && String(text).trim()) {
      pageText = String(text).slice(0, MAX_TEXT);
    } else if (url) {
      const u = await assertPublicUrl(String(url).trim());
      sourceUrl = u.origin + u.pathname + (u.searchParams.get("PRODUCT_ID") ? `?PRODUCT_ID=${u.searchParams.get("PRODUCT_ID")}` : "");
      const r = await fetch(u.toString(), { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; TicketManagerBot/1.0)", "Accept-Language": "zh-TW,zh;q=0.9" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return res.status(422).json({ error: `網站回應 ${r.status},請改用「貼上頁面文字」` });
      pageText = htmlToText(await r.text());
      if (pageText.replace(/\s/g, "").length < 200) return res.status(422).json({ error: "抓到的內容太少(網站可能是動態載入),請改用「貼上頁面文字」" });
    } else {
      return res.status(400).json({ error: "請提供 url 或 text" });
    }

    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const prompt = `你是台灣演唱會資訊整理員。今天是 ${today} (台灣時間)。下列內容可能是「單一演出頁面」或「多場演出的列表頁」。請擷取所有「未來的演出」(演出日期,不是售票日期),只輸出一個 JSON,不要其他文字:
{"events":[{"name":"藝人+演出名稱(簡潔,例如 BTS WORLD TOUR ARIRANG 高雄)","venue":"場地名稱","dates":["YYYY-MM-DD",...],"aliases":["常見別名/縮寫/中英文名"],"confidence":0到1,"notes":"不確定之處,沒有就空字串"}]}
規則:名稱要包含城市(台北/高雄等);多日演出 dates 列出每一天;頁面沒寫年份時依今天判斷最近的未來日期;已經過去的演出略過;不要推測頁面沒寫的資訊,不確定就降低 confidence 並在 notes 說明;不是演出資訊就回 {"events":[]}。輸出請精簡,不要換行縮排。

網頁內容:
${pageText}`;
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(40000),
    });
    const aj = await ar.json();
    if (!ar.ok) return res.status(502).json({ error: "AI 服務錯誤:" + (aj?.error?.message || ar.status) });
    const out = (aj.content || []).map(c => c.text || "").join("");
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: `AI 回傳格式無法解析 (stop_reason=${aj.stop_reason || "?"}) 原始回覆:` + (out.slice(0, 300) || "(空白)") });
    let parsed;
    try { parsed = JSON.parse(m[0]); } catch (e) { return res.status(502).json({ error: "AI 回傳的 JSON 有誤(可能內容太長被截斷,請分段貼):" + m[0].slice(0, 200) }); }
    let events = Array.isArray(parsed.events) ? parsed.events : (parsed.dates ? [parsed] : []);
    events = events.map(ev => ({ ...ev, dates: (ev.dates || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) })).filter(ev => ev.name && ev.dates.length);
    return res.status(200).json({ events, url: sourceUrl });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
