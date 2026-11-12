import {
  json, store, sanitize, sameOrigin, verifyGoogleIdToken, makeSession,
  sessionEmail, cookieHeader, ADMIN_EMAIL,
} from "./lib.mjs";

export const config = { path: "/api/*" };

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const method = req.method;

  try {
    /* Ai cũng đọc được dữ liệu công khai */
    if (route === "data" && method === "GET") {
      const raw = await store("site").get("data");
      return json(raw ? JSON.parse(raw) : sanitize({}));
    }

    if (route === "me" && method === "GET") {
      const email = await sessionEmail(req);
      return json({ admin: !!email, email: email || null });
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
