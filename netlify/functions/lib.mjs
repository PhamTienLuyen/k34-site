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

/* ---------- Phiên thành viên (bất kỳ email Google nào đã đăng nhập, dùng cho Kỷ yếu) ---------- */
export const MEMBER_COOKIE = "nak34_member";
export function memberCookieHeader(req, value, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${MEMBER_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
async function readSession(tok) {
  const [body, sig] = String(tok || "").split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmac(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.e || p.x < Math.floor(Date.now() / 1000)) return null;
    return String(p.e).toLowerCase();
  } catch { return null; }
}
/* Email của người đã đăng nhập Kỷ yếu (hoặc quản trị viên đã đăng nhập), ngược lại null. */
export async function memberEmail(req) {
  const m = await readSession(getCookie(req, MEMBER_COOKIE));
  if (m) return m;
  return await sessionEmail(req);
}
export const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[^\s@<>"',;]{2,24}$/;
export async function getUploaders() {
  try { const raw = await store("auth").get("uploaders"); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; }
}
export function cleanEmails(list) {
  const out = [];
  if (Array.isArray(list)) for (const v of list.slice(0, 300)) {
    const e = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (e && e.length <= 254 && EMAIL_RE.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}
export async function canUpload(email) {
  if (!email) return false;
  if (email === ADMIN_EMAIL) return true;
  return (await getUploaders()).includes(email);
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

/* Token truy cập (nút đăng nhập tuỳ biến): hỏi Google xem token thuộc ứng dụng nào và email nào. */
export async function verifyGoogleAccessToken(accessToken, fetchImpl = fetch) {
  if (!accessToken || typeof accessToken !== "string" || accessToken.length > 4096) return null;
  const r = await fetchImpl("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(accessToken));
  if (!r.ok) return null;
  const t = await r.json();
  if (t.aud !== CLIENT_ID && t.azp !== CLIENT_ID) return null;
  if (String(t.email_verified) !== "true") return null;
  if (t.exp && !(Number(t.exp) * 1000 > Date.now())) return null;
  return String(t.email || "").toLowerCase() || null;
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

function cleanWeeks(w) {
  if (!isObj(w)) return null;
  const out = {};
  for (const [k, v] of Object.entries(w).slice(0, 60)) {
    if (!/^\d{1,2}$/.test(k) || !isObj(v) || !Array.isArray(v.x)) continue;
    const s = /^\d{4}-\d{2}-\d{2}$/.test(v.s) ? v.s : "";
    const x = v.x.slice(0, 40).map((a) => {
      if (!Array.isArray(a)) return null;
      const day = int(a[0]), f = int(a[2]), t = int(a[3]), code = str(a[1], 16);
      if (day == null || day < 0 || day > 6 || !f || !t || !/^[A-Za-z0-9]+$/.test(code)) return null;
      return [day, code, f, t, str(a[4], 40), str(a[5], 12), str(a[6], 60), str(a[7], 100)];
    }).filter(Boolean);
    out[k] = { s, x };
  }
  return Object.keys(out).length ? out : null;
}
const cleanAt = (v) => { const d = new Date(v); return isNaN(d) ? "" : d.toISOString(); };

export function sanitize(d) {
  const o = { v: 1, updated: new Date().toISOString(), notes: {}, courses: [], hiddenCourses: {}, tasks: [], taskState: {}, taskDates: {}, taskNotes: {}, news: [], courseDocs: {}, courseSched: {}, extraWeeks: 0, sessEdits: {}, schedSync: null, schedHistory: [], docs: {}, docLinks: {}, changes: {}, added: {} };
  if (!isObj(d)) return o;
  if (isObj(d.notes)) for (const [k, v] of Object.entries(d.notes).slice(0, 600)) {
    const t = str(v, 1500); if (t && k.length < 80) o.notes[k] = t;
  }
  if (Array.isArray(d.courses)) for (const c of d.courses.slice(0, 20)) {
    if (!isObj(c)) continue;
    const id = str(c.id, 20), name = str(c.name, 80), hex = /^#[0-9a-fA-F]{6}$/;
    if (!/^[a-zA-Z0-9]{1,20}$/.test(id) || !name) continue;
    o.courses.push({ id, name, color: hex.test(c.color) ? c.color : "#F2C84B", dark: hex.test(c.dark) ? c.dark : "#8A6100", end: c.end == null ? null : int(c.end), gv: str(c.gv, 60) });
  }
  if (isObj(d.hiddenCourses)) for (const k of Object.keys(d.hiddenCourses).slice(0, 40)) {
    if (d.hiddenCourses[k] === true && /^[a-zA-Z0-9]{1,20}$/.test(k)) o.hiddenCourses[k] = true;
  }
  if (isObj(d.taskDates)) for (const [k, v] of Object.entries(d.taskDates).slice(0, 300)) {
    if (!isObj(v) || k.length > 260) continue;
    const e = int(v.e), st = v.s == null ? null : int(v.s);
    if (e != null) o.taskDates[k] = { s: st, e };
  }
  if (isObj(d.sessEdits)) for (const [k, v] of Object.entries(d.sessEdits).slice(0, 300)) {
    if (!/^\d{1,2}\|[0-6]\|[A-Za-z0-9]{1,16}\|\d{1,2}$/.test(k) || !isObj(v)) continue;
    const p = Array.isArray(v.p) && v.p.length === 2 ? [int(v.p[0]), int(v.p[1])] : null;
    const e = { p: p && p[0] > 0 && p[1] >= p[0] ? p : null, room: str(v.room, 40), gv: str(v.gv, 60), hoc: str(v.hoc, 12) };
    const tag = str(v.tag, 20); if (tag) e.tag = tag;
    if (v.hide === true) e.hide = true;
    o.sessEdits[k] = e;
  }
  if (Number.isInteger(d.extraWeeks) && d.extraWeeks > 0) o.extraWeeks = Math.min(d.extraWeeks, 60);
  if (isObj(d.courseSched)) for (const [k, arr] of Object.entries(d.courseSched).slice(0, 40)) {
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(k) || !Array.isArray(arr)) continue;
    const l = [];
    for (const q of arr.slice(0, 150)) {
      if (!isObj(q)) continue;
      const dd = int(q.d), a = int(q.a), b = int(q.b);
      if (dd == null || dd < -200 || dd > 500 || a == null || b == null || a < 1 || b < a || b > 20) continue;
      const st = str(q.s, 5);
      const qid = str(q.id, 24); l.push({ id: /^[A-Za-z0-9_-]{1,24}$/.test(qid) ? qid : "", d: dd, a, b, s: /^\d{1,2}:\d{2}$/.test(st) ? st : "", r: str(q.r, 40), g: str(q.g, 60), t: str(q.t, 20), h: str(q.h, 12), n: str(q.n, 600) });
    }
    if (l.length) o.courseSched[k] = l;
  }
  if (Array.isArray(d.news)) for (const n of d.news.slice(0, 200)) {
    if (!isObj(n)) continue;
    const t = str(n.t, 150), at = cleanAt(n.at); if (!t || !at) continue;
    o.news.push({ id: str(String(n.id == null ? "" : n.id), 40) || at, t, b: str(n.b, 6000), at });
  }
  if (isObj(d.schedSync)) { const w = cleanWeeks(d.schedSync.weeks); if (w) o.schedSync = { at: cleanAt(d.schedSync.at), weeks: w }; }
  if (Array.isArray(d.schedHistory)) for (const h of d.schedHistory.slice(0, 6)) {
    if (!isObj(h)) continue;
    o.schedHistory.push({ at: cleanAt(h.at), label: str(h.label, 60), weeks: cleanWeeks(h.weeks) });
  }
  if (isObj(d.courseDocs)) for (const [k, arr] of Object.entries(d.courseDocs).slice(0, 40)) {
    if (!/^[a-zA-Z0-9]{1,20}$/.test(k) || !Array.isArray(arr)) continue;
    const l = arr.slice(0, 40).map((x) => isObj(x) ? { name: str(x.name, 200), link: okUrl(x.link) } : null).filter((x) => x && x.name);
    if (l.length) o.courseDocs[k] = l;
  }
  if (isObj(d.taskNotes)) for (const [k, v] of Object.entries(d.taskNotes).slice(0, 300)) {
    const t = str(v, 1500); if (t && k.length < 260) o.taskNotes[k] = t;
  }
  if (Array.isArray(d.tasks)) for (const t of d.tasks.slice(0, 300)) {
    if (!isObj(t)) continue;
    const e = int(t.e), s = t.s == null ? null : int(t.s), title = str(t.title, 200), c = str(t.c, 20);
    if (!title || !c || e == null) continue;
    const groups = Array.isArray(t.groups) ? t.groups.slice(0, 20).map((x) => { if (!isObj(x)) return null; const n = str(x.n, 40), dd = int(x.d); return n && dd != null ? { n, d: dd, k: x.k === "p" ? "p" : "g", note: str(x.note, 1000) } : null; }).filter(Boolean) : [];
    o.tasks.push({ id: str(t.id, 40) || String(Date.now()), c, title, s, e, groups, note: str(t.note, 1500), done: !!t.done });
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
    o.added[w] = arr.slice(0, 20).map((a) => Array.isArray(a) && a.length >= 5 ? [int(a[0]), str(a[1], 12), int(a[2]), int(a[3]), str(a[4], 40), str(a[5], 300), str(a[6], 20) || "HỌC BÙ", str(a[7], 60), str(a[8], 12), /^\d{1,2}:\d{2}$/.test(str(a[9], 5)) ? str(a[9], 5) : ""] : null)
      .filter((a) => a && a[0] != null && a[0] >= 0 && a[0] <= 6 && a[1] && a[2] && a[3]);
  }
  return o;
}
