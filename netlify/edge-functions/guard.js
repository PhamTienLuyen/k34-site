/* Chặn các trang /admin* nếu chưa đăng nhập đúng email quản trị. */
export default async (req, context) => {
  let ok = false;
  try {
    const r = await fetch(new URL("/api/me", req.url), {
      headers: { cookie: req.headers.get("cookie") || "" },
    });
    ok = r.ok && (await r.json()).admin === true;
  } catch (_) { ok = false; }
  if (ok) {
    const res = await context.next();
    res.headers.set("cache-control", "no-store");
    return res;
  }
  return Response.redirect(new URL("/?login=1", req.url), 302);
};

export const config = { path: "/admin*" };
