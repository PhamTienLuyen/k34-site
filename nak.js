/* NAK34 – lớp "web động": dữ liệu từ Netlify, đăng nhập Google, ghi chú. */
(function () {
  var CLIENT_ID = '948831836917-dre6omu0ajvofphs4sbj1duflrb1sbhd.apps.googleusercontent.com';
  var NAK = (window.NAK = { admin: false, email: null, data: {}, onChange: null });

  function api(path, opt) {
    opt = opt || {};
    var o = { method: opt.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opt.body !== undefined) { o.body = JSON.stringify(opt.body); o.headers['content-type'] = 'application/json'; }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }
  NAK.api = api;

  NAK.load = function () {
    return Promise.all([api('/api/data'), api('/api/me')]).then(function (a) {
      NAK.data = a[0] || {};
      NAK.admin = !!(a[1] && a[1].admin);
      NAK.email = a[1] && a[1].email;
      if (NAK.onChange) NAK.onChange();
    }).catch(function () { /* offline: dùng dữ liệu mặc định */ });
  };

  /* Lưu: mutator nhận bản sao dữ liệu, trả về true nếu muốn lưu */
  NAK.save = function (mutator) {
    var copy = JSON.parse(JSON.stringify(NAK.data || {}));
    copy.notes = copy.notes || {};
    mutator(copy);
    return api('/api/data', { method: 'PUT', body: copy }).then(function (r) {
      if (r.ok) { NAK.data = r.data; if (NAK.onChange) NAK.onChange(); return true; }
      alert(r._status === 401 ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' : (r.error || 'Không lưu được'));
      return false;
    });
  };

  /* ---------- Giao diện chung ---------- */
  function overlay(inner, onClose) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(17,17,17,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Archivo,system-ui,sans-serif';
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.style.cssText = 'position:relative;width:100%;max-width:460px;background:#fff;border:3px solid #111;border-radius:20px;box-shadow:8px 8px 0 #111;padding:24px;border-top:12px solid #FFC400;max-height:90vh;overflow:auto';
    var x = document.createElement('button');
    x.type = 'button'; x.setAttribute('aria-label', 'Đóng'); x.innerHTML = '&#10005;';
    x.style.cssText = 'position:absolute;top:10px;right:10px;width:40px;height:40px;border:2px solid #111;border-radius:12px;background:#fff;font-size:16px;font-weight:800;cursor:pointer';
    function close() { document.body.removeChild(ov); document.removeEventListener('keydown', esc); if (onClose) onClose(); }
    function esc(e) { if (e.key === 'Escape') close(); }
    x.onclick = close;
    ov.onclick = function (e) { if (e.target === ov) close(); };
    document.addEventListener('keydown', esc);
    box.appendChild(x); box.appendChild(inner); ov.appendChild(box);
    document.body.appendChild(ov);
    return { close: close, box: box };
  }
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }
  var BTN = 'min-height:44px;padding:0 18px;border:2px solid #111;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:3px 3px 0 #111;';

  /* ---------- Đăng nhập Google ---------- */
  NAK.openLogin = function () {
    if (NAK.admin) { location.href = '/admin.html'; return; }
    var wrap = el('div', 'padding-top:34px;text-align:center');
    wrap.appendChild(el('h3', "margin:0 0 6px;font-family:Anton,Archivo,sans-serif;font-size:26px;font-weight:800;color:#1E7B34", 'CẬP NHẬT'));
    wrap.appendChild(el('p', 'margin:0 0 18px;font-size:14px;font-weight:600;line-height:1.5;color:#3A3A3A', 'Chỉ email quản trị viên mới được cập nhật trang này.'));
    var btnBox = el('div', 'display:flex;justify-content:center;min-height:44px');
    var msg = el('p', 'margin:14px 0 0;font-size:14px;font-weight:700;color:#A3151C;min-height:20px');
    wrap.appendChild(btnBox); wrap.appendChild(msg);
    overlay(wrap);

    function init() {
      if (!(window.google && google.accounts && google.accounts.id)) { msg.textContent = 'Đang tải Google…'; setTimeout(init, 400); return; }
      msg.textContent = '';
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: function (resp) {
          msg.style.color = '#3A3A3A'; msg.textContent = 'Đang kiểm tra…';
          api('/api/login', { method: 'POST', body: { credential: resp.credential } }).then(function (r) {
            if (r.admin) { location.href = '/admin.html'; return; }
            msg.style.color = '#A3151C';
            msg.textContent = r._status === 403 ? 'Email này không có quyền cập nhật.' : 'Đăng nhập không thành công. Thử lại.';
          });
        },
        ux_mode: 'popup', auto_select: false
      });
      google.accounts.id.renderButton(btnBox, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'vi' });
    }
    init();
  };

  /* ---------- Ghi chú buổi học (chỉ quản trị sửa được) ---------- */
  NAK.editNote = function (key, title) {
    if (!NAK.admin) return;
    var cur = (NAK.data.notes || {})[key] || '';
    var wrap = el('div', 'padding-top:34px');
    wrap.appendChild(el('h3', "margin:0 0 4px;font-family:Anton,Archivo,sans-serif;font-size:24px;font-weight:800", 'GHI CHÚ'));
    wrap.appendChild(el('p', 'margin:0 0 12px;font-size:14px;font-weight:700;color:#3A3A3A', title));
    var ta = el('textarea', 'width:100%;box-sizing:border-box;min-height:120px;padding:10px 12px;border:2px solid #111;border-radius:12px;font:600 14px Archivo,system-ui,sans-serif;resize:vertical');
    ta.className = 'nak-note'; ta.value = cur; ta.maxLength = 1500; ta.placeholder = 'Ví dụ: Nộp bài tập IPA trước 23:59… (Ctrl+K để chèn link)';
    wrap.appendChild(ta);
    var row = el('div', 'display:flex;gap:10px;margin-top:14px;flex-wrap:wrap');
    var save = el('button', BTN + 'background:#FFC400', 'Lưu'); save.type = 'button';
    var del = el('button', BTN + 'background:#fff;color:#A3151C', 'Xóa ghi chú'); del.type = 'button';
    row.appendChild(save); if (cur) row.appendChild(del);
    wrap.appendChild(row);
    var o = overlay(wrap);
    setTimeout(function () { ta.focus(); }, 30);
    function commit(text) {
      save.disabled = del.disabled = true;
      NAK.save(function (d) { if (text) d.notes[key] = text; else delete d.notes[key]; }).then(function (ok) {
        if (ok) o.close(); else save.disabled = del.disabled = false;
      });
    }
    save.onclick = function () { commit(ta.value.trim()); };
    del.onclick = function () { commit(''); };
  };


  /* ---------- Link trong ghi chú: [chữ](https://...) hoặc dán thẳng URL; Ctrl/Cmd+K để chèn ---------- */
  NAK.linkify = function (node, text) {
    node.textContent = '';
    var re = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)|(https?:\/\/[^\s<>"']{1,500})/g, last = 0, m;
    function a(href, label) {
      var x = document.createElement('a'); x.href = href; x.target = '_blank'; x.rel = 'noopener noreferrer'; x.textContent = label;
      x.style.cssText = 'color:#0B57D0;font-weight:800;text-decoration:underline;word-break:break-all'; return x;
    }
    text = String(text || '');
    while ((m = re.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) node.appendChild(a(m[2], m[1]));
      else { var u = m[3], tail = ''; while (/[.,;:!?)]$/.test(u)) { tail = u.slice(-1) + tail; u = u.slice(0, -1); } node.appendChild(a(u, u)); if (tail) node.appendChild(document.createTextNode(tail)); }
      last = re.lastIndex - (m[3] ? 0 : 0);
      if (m[3] && /[.,;:!?)]$/.test(m[3])) last = m.index + m[3].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
    return node;
  };
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'k' && e.key !== 'K')) return;
    var t = e.target;
    if (!t || !t.matches || !t.matches('textarea.nak-note,.tk-note,.sr-n,.wf-n,.gr-note,#nn-b,.ni-b,.nak-note')) return;
    e.preventDefault();
    var st = t.selectionStart || 0, en = t.selectionEnd || 0, sel = t.value.slice(st, en);
    var url = window.prompt('Dán đường link (https://...)', 'https://'); if (!url) return;
    url = url.trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
    var label = sel || window.prompt('Chữ hiển thị cho link', '') || url;
    var ins = '[' + label.replace(/[\[\]]/g, '') + '](' + url.replace(/\)/g, '%29') + ')';
    t.value = t.value.slice(0, st) + ins + t.value.slice(en);
    t.selectionStart = t.selectionEnd = st + ins.length; t.focus();
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });

  NAK.showNote = function (title, text) {
    var wrap = el('div', 'padding-top:34px');
    wrap.appendChild(el('h3', "margin:0 0 6px;font-family:Anton,Archivo,sans-serif;font-size:24px;font-weight:800", 'GHI CHÚ'));
    wrap.appendChild(el('p', 'margin:0 0 12px;font-size:14px;font-weight:800;color:#3A3A3A', title));
    wrap.appendChild(NAK.linkify(el('div', 'white-space:pre-line;font-size:14px;font-weight:600;line-height:1.55;background:#FFF9DB;border:2px solid #111;border-radius:12px;padding:12px 14px'), text));
    overlay(wrap);
  };

  NAK.showNews = function (title, when, text) {
    var wrap = el('div', 'padding-top:34px');
    wrap.appendChild(el('p', 'margin:0 0 4px;font-size:14px;font-weight:800;color:#A3151C;letter-spacing:.06em', 'BULLETIN BOARD · ' + when));
    wrap.appendChild(el('h3', "margin:0 0 12px;font-family:Anton,Archivo,sans-serif;font-size:24px;font-weight:400;line-height:1.2", title));
    wrap.appendChild(NAK.linkify(el('div', 'white-space:pre-line;font-size:14px;font-weight:600;line-height:1.55;background:#FFF9DB;border:2px solid #111;border-radius:12px;padding:12px 14px'), text || '(Không có nội dung chi tiết.)'));
    overlay(wrap);
  };

  NAK.note = function (key) { return ((NAK.data && NAK.data.notes) || {})[key] || ''; };

  document.addEventListener('DOMContentLoaded', function () {
    if (/[?&]login=1/.test(location.search)) {
      NAK.load().then(function () { NAK.openLogin(); });
    }
  });
})();
