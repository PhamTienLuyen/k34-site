import { getStore } from "@netlify/blobs";

/* Client ID là thông tin công khai (không phải secret). */
export const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  "948831836917-dre6omu0ajvofphs4sbj1duflrb1sbhd.apps.googleusercontent.com";
/* DUY NHẤT email này được phép cập nhật. */
export const ADMIN_EMAIL = "phamtienluyen.edu@gmail.com";
export const COOKIE = "nak34_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

let storeFactory = (name) => getStore({ name, consistency: "strong" });
export function setStoreFactory(f) { storeFactory = f; }
export const store = (name) => storeFactory(name);

/* ---------- JSON / cookie helpers ---------- */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
export function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
export function cookieHeader(req, value, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/* ---------- Session (HMAC) ---------- */
let cachedSecret = null;
async function getSecret() {
  if (cachedSecret) return cachedSecret;
  const s = store("auth");
  let v = await s.get("secret");
  if (!v) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    v = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    await s.set("secret", v);
    v = (await s.get("secret")) || v;
  }
  cachedSecret = v;
  return v;
}
const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function hmac(payload) {
  const key = await crypto.subtle.importKey("raw", enc.encode(await getSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}
export async function makeSession(email) {
  const body = b64u(enc.encode(JSON.stringify({ e: email, x: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  return `${body}.${await hmac(body)}`;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/* Trả về email nếu phiên hợp lệ VÀ đúng email quản trị, ngược lại null. */
export async function sessionEmail(req) {
  const tok = getCookie(req, COOKIE);
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmac(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.e || p.x < Math.floor(Date.now() / 1000)) return null;
    if (String(p.e).toLowerCase() !== ADMIN_EMAIL) return null;
    return ADMIN_EMAIL;
  } catch { return null; }
}

/* ---------- Google ID token ---------- */
export async function verifyGoogleIdToken(credential, fetchImpl = fetch) {
  if (!credential || typeof credential !== "string" || credential.length > 4096) return null;
  const r = await fetchImpl("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
  if (!r.ok) return null;
  const t = await r.json();
  if (t.aud !== CLIENT_ID) return null;
  if (t.iss !== "accounts.google.com" && t.iss !== "https://accounts.google.com") return null;
  if (!(Number(t.exp) * 1000 > Date.now())) return null;
  if (String(t.email_verified) !== "true") return null;
  return String(t.email || "").toLowerCase();
}

/* ---------- Chống CSRF: chỉ nhận POST/PUT cùng nguồn ---------- */
export function sameOrigin(req) {
  const o = req.headers.get("origin");
  if (!o) return true;
  try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
}

/* ---------- Làm sạch dữ liệu ghi vào ---------- */
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const int = (v) => (Number.isInteger(v) && v > -400 && v < 2000 ? v : null);
const okUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href.slice(0, 600) : ""; } catch { return ""; } };
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

export function sanitize(d) {
  const o = { v: 1, updated: new Date().toISOString(), notes: {}, tasks: [], taskState: {}, docs: {}, docLinks: {}, changes: {}, added: {} };
  if (!isObj(d)) return o;
  if (isObj(d.notes)) for (const [k, v] of Object.entries(d.notes).slice(0, 600)) {
    const t = str(v, 1500); if (t && k.length < 80) o.notes[k] = t;
  }
  if (Array.isArray(d.tasks)) for (const t of d.tasks.slice(0, 300)) {
    if (!isObj(t)) continue;
    const e = int(t.e), s = t.s == null ? null : int(t.s), title = str(t.title, 200), c = str(t.c, 20);
    if (!title || !c || e == null) continue;
    o.tasks.push({ id: str(t.id, 40) || String(Date.now()), c, title, s, e, done: !!t.done });
  }
  if (isObj(d.taskState)) for (const [k, v] of Object.entries(d.taskState).slice(0, 300)) {
    if ((v === "done" || v === "hidden") && k.length < 260) o.taskState[k] = v;
  }
  if (isObj(d.docs)) for (const [g, arr] of Object.entries(d.docs).slice(0, 20)) {
    if (!Array.isArray(arr)) continue;
    o.docs[str(g, 20)] = arr.slice(0, 200).map((x) => isObj(x) ? { type: ["PDF", "DOCX", "PPTX", "LINK"].includes(x.type) ? x.type : "LINK", name: str(x.name, 250), link: okUrl(x.link) } : null).filter((x) => x && x.name);
  }
  if (isObj(d.docLinks)) for (const [k, v] of Object.entries(d.docLinks).slice(0, 300)) {
    const u = okUrl(v); if (u && k.length < 300) o.docLinks[k] = u;
  }
  if (isObj(d.changes)) for (const [k, v] of Object.entries(d.changes).slice(0, 200)) {
    if (!isObj(v) || !/^\d+-\d+$/.test(k)) continue;
    const p = Array.isArray(v.periods) && v.periods.length === 2 ? [int(v.periods[0]), int(v.periods[1])] : null;
    o.changes[k] = { room: str(v.room, 40), periods: p && p[0] && p[1] ? p : null, note: str(v.note, 300), tag: str(v.tag, 20) || "ĐỔI LỊCH" };
  }
  if (isObj(d.added)) for (const [w, arr] of Object.entries(d.added).slice(0, 40)) {
    if (!/^\d+$/.test(w) || !Array.isArray(arr)) continue;
    o.added[w] = arr.slice(0, 20).map((a) => Array.isArray(a) && a.length >= 5 ? [int(a[0]), str(a[1], 12), int(a[2]), int(a[3]), str(a[4], 40), str(a[5], 300), str(a[6], 20) || "HỌC BÙ"] : null)
      .filter((a) => a && a[0] != null && a[0] >= 0 && a[0] <= 6 && a[1] && a[2] && a[3]);
  }
  return o;
}
