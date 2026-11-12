import SEED, { SEED_ID } from "./seed-data.mjs";
import {
  json, store, sanitize, sameOrigin, verifyGoogleIdToken, makeSession,
  sessionEmail, cookieHeader, ADMIN_EMAIL,
  memberEmail, memberCookieHeader, verifyGoogleAccessToken, canUpload, getUploaders, cleanEmails,
} from "./lib.mjs";

const IMG_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTO = 4_500_000, MAX_PHOTOS = 600;
function sniff(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "";
}
async function readIndex() { try { const raw = await store("photos").get("index"); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch { return []; } }

export const config = { path: "/api/*" };

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const method = req.method;

  try {
    /* Ai cũng đọc được dữ liệu công khai */
    if (route === "data" && method === "GET") {
      let raw = await store("site").get("data");
      if ((await store("site").get("seeded")) !== SEED_ID) { /* nạp dữ liệu từ bản local đúng một lần */
        raw = JSON.stringify(sanitize(SEED));
        await store("site").set("data", raw); await store("site").set("seeded", SEED_ID);
      }
      return json(raw ? JSON.parse(raw) : sanitize({}));
    }

    if (route === "me" && method === "GET") {
      const email = await sessionEmail(req);
      return json({ admin: !!email, email: email || null });
    }

    /* ---- Kỷ yếu: chỉ người đã đăng nhập Google mới xem được ---- */
    if (route === "gallery/me" && method === "GET") {
      const email = await memberEmail(req);
      return json({ email: email || null, canUpload: await canUpload(email) });
    }
    if (route === "photos" && method === "GET") {
      const email = await memberEmail(req);
      if (!email) return json({ error: "Chưa đăng nhập" }, 401);
      const idx = await readIndex();
      const admin = email === ADMIN_EMAIL;
      return json({ photos: idx.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).map((p) => ({ id: p.id, at: p.at, ratio: p.ratio || 1, mine: p.by === email, canDelete: admin || p.by === email })) });
    }
    if (route.startsWith("photo/") && method === "GET") {
      const email = await memberEmail(req);
      if (!email) return json({ error: "Chưa đăng nhập" }, 401);
      const id = route.slice(6);
      if (!/^[a-z0-9]{6,40}$/.test(id)) return json({ error: "Không tìm thấy" }, 404);
      const meta = (await readIndex()).find((p) => p.id === id);
      const data = meta ? await store("photos").get("img/" + id, { type: "arrayBuffer" }) : null;
      if (!data) return json({ error: "Không tìm thấy" }, 404);
      return new Response(data, { status: 200, headers: { "content-type": meta.ct, "cache-control": "private, max-age=86400", "content-disposition": `inline; filename="nak34-${id}.${IMG_TYPES[meta.ct] || "jpg"}"` } });
    }
    if (route === "uploaders" && method === "GET") {
      if (!(await sessionEmail(req))) return json({ error: "Chưa đăng nhập quản trị" }, 401);
      return json({ emails: await getUploaders() });
    }

    if (method !== "POST" && method !== "PUT") return json({ error: "Không hỗ trợ" }, 405);
    if (!sameOrigin(req)) return json({ error: "Nguồn không hợp lệ" }, 403);

    if (route === "login" && method === "POST") {
      const { credential } = await req.json().catch(() => ({}));
      const email = await verifyGoogleIdToken(credential);
      if (!email) return json({ error: "Đăng nhập Google không hợp lệ" }, 401);
      if (email !== ADMIN_EMAIL) return json({ error: "Email này không có quyền cập nhật" }, 403);
      const token = await makeSession(email);
      return json({ admin: true, email }, 200, { "set-cookie": cookieHeader(req, token, 60 * 60 * 24 * 7) });
    }

    if (route === "glogin" && method === "POST") {
      const { accessToken } = await req.json().catch(() => ({}));
      const email = await verifyGoogleAccessToken(accessToken);
      if (!email) return json({ error: "Đăng nhập Google không hợp lệ" }, 401);
      const token = await makeSession(email);
      return json({ email, canUpload: await canUpload(email) }, 200, { "set-cookie": memberCookieHeader(req, token, 60 * 60 * 24 * 14) });
    }
    if (route === "glogout" && method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": memberCookieHeader(req, "", 0) });
    }
    if (route === "photos" && method === "POST") {
      const email = await memberEmail(req);
      if (!email) return json({ error: "Chưa đăng nhập" }, 401);
      if (!(await canUpload(email))) return json({ error: "Email này chưa được cấp quyền tải ảnh lên" }, 403);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength) return json({ error: "Tệp rỗng" }, 400);
      if (buf.byteLength > MAX_PHOTO) return json({ error: "Ảnh quá lớn" }, 413);
      const ct = sniff(buf);
      if (!ct) return json({ error: "Chỉ nhận ảnh JPG, PNG hoặc WEBP" }, 415);
      const idx = await readIndex();
      if (idx.length >= MAX_PHOTOS) return json({ error: "Đã đủ số ảnh tối đa" }, 409);
      const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 20);
      await store("photos").set("img/" + id, buf);
      const rr = Number(new URL(req.url).searchParams.get("r")); const ratio = rr > 0.3 && rr < 3 ? Math.round(rr * 1000) / 1000 : 1;
      idx.push({ id, by: email, at: new Date().toISOString(), ct, ratio });
      await store("photos").set("index", JSON.stringify(idx));
      return json({ ok: true, id });
    }
    if (route === "photos/delete" && method === "POST") {
      const email = await memberEmail(req);
      if (!email) return json({ error: "Chưa đăng nhập" }, 401);
      const { id } = await req.json().catch(() => ({}));
      const idx = await readIndex(), p = idx.find((x) => x.id === id);
      if (!p) return json({ error: "Không tìm thấy" }, 404);
      if (email !== ADMIN_EMAIL && p.by !== email) return json({ error: "Không có quyền xóa" }, 403);
      await store("photos").delete("img/" + id);
      await store("photos").set("index", JSON.stringify(idx.filter((x) => x.id !== id)));
      return json({ ok: true });
    }
    if (route === "uploaders" && method === "PUT") {
      if (!(await sessionEmail(req))) return json({ error: "Chưa đăng nhập quản trị" }, 401);
      const { emails } = await req.json().catch(() => ({}));
      const clean = cleanEmails(emails);
      await store("auth").set("uploaders", JSON.stringify(clean));
      return json({ ok: true, emails: clean });
    }

    if (route === "logout" && method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": cookieHeader(req, "", 0) });
    }

    if (route === "data" && method === "PUT") {
      if (!(await sessionEmail(req))) return json({ error: "Chưa đăng nhập quản trị" }, 401);
      const text = await req.text();
      if (text.length > 600_000) return json({ error: "Dữ liệu quá lớn" }, 413);
      let body; try { body = JSON.parse(text); } catch { return json({ error: "JSON lỗi" }, 400); }
      const clean = sanitize(body);
      await store("site").set("data", JSON.stringify(clean));
      return json({ ok: true, data: clean });
    }

    return json({ error: "Không tìm thấy" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Lỗi máy chủ" }, 500);
  }
};
