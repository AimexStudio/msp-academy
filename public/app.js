// MSP Academy: browser client (every client's staff and managers).
// Screens and wording follow the prototype. The server decides everything that matters (who gets what,
// marking, gates, signing); this script only shows what the server sends and asks it to record actions.
(function () {
"use strict";

const { md, esc } = window.PelMd;
const $app = document.getElementById("app");
const KINDS = { sop: "SOP", manual: "Manual", policy: "Policy", memo: "Staff memo" };
const SECTIONS = [["sop", "Standard operating procedures"], ["manual", "Manuals"], ["policy", "Policies"], ["memo", "Staff memos"]];
const ROLE_LABEL = { staff: "Staff", hod: "Head of department", manager: "Manager", auditor: "Owner / auditor" };
const SUPPORT_LABEL = "Platform support (read-only)";

/* ---------- state ---------- */
const S = {
  me: null, org: null, idleSeconds: 600, features: {},
  brand: null, brandByHost: false, support: null, // the client this page is for, and a platform support or library visit
  platformMode: location.pathname.replace(/\/+$/, "") === "/platform",
  view: "boot", params: {}, data: {}, loading: false,
  flash: null, busy: false, copyText: null,
  login: { no: "", pin: "", err: "", code: "", remember: true },
  docv: null, decl: null, edit: null, staffEdit: null, cfgEdit: null, pinReset: null,
  filt: { q: "", dept: "", lib: "all", rdept: "" },
};

/* ---------- helpers ---------- */
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT = d => d ? new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDur = s => { s = Math.round(Number(s) || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const plural = (n, w, ws) => n + " " + (n === 1 ? w : (ws || w + "s"));
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "";
const normName = s => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const role = () => S.me && S.me.role;
const isMgrish = () => ["manager", "hod", "auditor", "support"].includes(role());
const isSupport = () => role() === "support";
const isAuthor = () => !!(S.support && S.support.author);
const canEdit = () => role() === "manager";
const canDocs = () => ["manager", "auditor", "support"].includes(role());
const posName = id => (S.org && S.org.positions.find(p => p.id === id) || {}).name || "No position";
const deptOfPos = id => (S.org && S.org.positions.find(p => p.id === id) || {}).dept || "";
const deptName = id => (S.org && S.org.departments.find(d => d.id === id) || {}).name || "Unassigned";
function setPath(obj, path, val) { const k = path.split("."); let o = obj; for (let i = 0; i < k.length - 1; i++) { o = o[k[i]]; if (o == null) return; } o[k[k.length - 1]] = val; }
function getPath(obj, path) { return path.split(".").reduce((o, k) => o == null ? o : o[k], obj); }

let toastTimer = null;
function toast(msg, kind) { const t = document.getElementById("toast"); t.textContent = msg; t.className = kind || ""; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === "bad" ? 7000 : 4000); }
let modalAction = null;
function confirmBox(title, body, okLabel, fn, danger, extraHtml) {
  modalAction = fn;
  document.getElementById("modal").innerHTML = `<div class="modal-back" data-act="modal-close"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-t" data-stop="1">
    <h2 id="m-t">${esc(title)}</h2><p class="muted">${esc(body)}</p>${extraHtml || ""}
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="modal-close">Cancel</button><button type="button" class="btn ${danger ? "danger" : "primary"}" data-act="modal-ok">${esc(okLabel)}</button></div></div></div>`;
  const ok = document.querySelector('[data-act="modal-ok"]'); if (ok) ok.focus();
}
function closeModal() { document.getElementById("modal").innerHTML = ""; modalAction = null; }

/* ---------- branding ----------
   The stylesheet's defaults are Pelagos's palette. A client's branding sets its four colours, its fonts and
   its words; the in-between shades are worked out from those. Only what differs from the defaults is set.
   Before a client is chosen (the shared sign-in page) the page has MSP Academy's own neutral look. */
const CODE_KEY = "pt.clientCode";
const storedCode = () => { try { return localStorage.getItem(CODE_KEY) || ""; } catch { return ""; } };
const storeCode = c => { try { if (c) localStorage.setItem(CODE_KEY, c); else localStorage.removeItem(CODE_KEY); } catch {} };
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = a => "#" + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const PELAGOS_BG = "#E4E0CD";
const BRAND_VARS = ["--bar", "--primary", "--on-bar", "--on-primary", "--bar-dim", "--lagoon", "--gold", "--bg", "--surface", "--sunk", "--line", "--sand",
  "--ink", "--ink-2", "--muted", "--paper-ink", "--lagoon-soft", "--khaki", "--khaki-soft", "--f-display", "--f-body", "--arches"];

/** The derived palette for a client's four colours (also used by the platform's branding preview). */
function brandPalette(c) {
  const v = {};
  const onPrimary = contrast(c.background, c.primary) >= 4.5 ? c.background : (lum(c.primary) < 0.35 ? "#FFFFFF" : "#141A1C");
  v["--bar"] = v["--primary"] = c.primary; v["--on-bar"] = v["--on-primary"] = onPrimary;
  v["--bar-dim"] = contrast(c.highlight, c.primary) >= 3 ? c.highlight : mix(onPrimary, c.primary, 0.3);
  v["--lagoon"] = c.accent; v["--gold"] = c.highlight;
  if (c.background.toUpperCase() !== PELAGOS_BG) {
    const ink = lum(c.primary) < 0.05 ? c.primary : "#1D2428";
    Object.assign(v, { "--bg": c.background, "--surface": mix(c.background, "#FFFFFF", 0.6), "--sunk": mix(c.background, "#FFFFFF", 0.2),
      "--line": mix(c.background, ink, 0.13), "--sand": mix(c.background, ink, 0.06), "--ink": ink, "--paper-ink": ink, "--ink-2": mix(ink, c.background, 0.18),
      "--muted": mix(ink, c.background, 0.4), "--lagoon-soft": mix(c.background, c.accent, 0.14), "--khaki": mix(c.highlight, ink, 0.45), "--khaki-soft": mix(c.background, c.highlight, 0.16) });
  }
  return v;
}
function archesUrl(c) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 150'><path fill='${c.accent}' d='M0 150V100A100 100 0 0 1 200 100V150H150A50 50 0 0 0 50 150Z'/><path fill='${c.highlight}' d='M200 150V100A100 100 0 0 1 400 100V150H350A50 50 0 0 0 250 150Z'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function applyBrand(b) {
  const root = document.documentElement;
  BRAND_VARS.forEach(k => root.style.removeProperty(k));
  root.removeAttribute("data-caps");
  if (!S.platformMode) { if (b) root.removeAttribute("data-area"); else root.setAttribute("data-area", "neutral"); }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!b) { document.title = "MSP Academy"; if (meta) meta.content = "#26292D"; setFaviconUrl("/favicon.svg"); return; }
  for (const [k, v] of Object.entries(brandPalette(b.colors))) root.style.setProperty(k, v);
  root.style.setProperty("--f-display", b.fonts.heading); root.style.setProperty("--f-body", b.fonts.body);
  root.style.setProperty("--arches", archesUrl(b.colors));
  if (!b.headingCaps) root.setAttribute("data-caps", "off");
  document.title = `${b.wordmark ? b.wordmark.charAt(0) + b.wordmark.slice(1).toLowerCase() : b.name} Training`;
  if (meta) meta.content = b.colors.primary;
  setFavicon((b.wordmark || b.name || "T").charAt(0), b.colors.primary, brandPalette(b.colors)["--on-primary"]);
}
function setFaviconUrl(url) {
  let l = document.querySelector('link[rel="icon"]'); if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); }
  l.type = "image/svg+xml"; l.href = url;
}
function setFavicon(letter, bg, fg = "#FFFFFF") {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='${bg}'/><text x='32' y='44' font-family='Georgia,serif' font-size='34' font-weight='600' fill='${fg}' text-anchor='middle'>${esc(letter.toUpperCase())}</text></svg>`;
  setFaviconUrl("data:image/svg+xml," + encodeURIComponent(svg));
}
/** Work out which client the sign-in page is for: the web address first, then the code this device remembers. */
async function loadBranding() {
  try {
    const r = await GET("/api/branding");
    if (r.client) { S.brand = r.client; S.brandByHost = true; S.platformLink = r.platformUrl || null; applyBrand(S.brand); return; }
  } catch {}
  S.brandByHost = false;
  // A client's sign-in link, e.g. /harbour (or the older /?code=HARBOUR): opens that client's sign-in and remembers it
  // on this device, so a bookmark or home-screen icon goes straight there. The platform's preview (?preview=1) isn't remembered.
  const qs = new URLSearchParams(location.search), seg = location.pathname.replace(/^\/+|\/+$/g, "");
  const fromPath = /^[A-Za-z0-9-]{3,20}$/.test(seg) && seg.toLowerCase() !== "platform" ? seg : null;
  const linked = fromPath || qs.get("code");
  if (linked) {
    if (!fromPath || qs.has("code") || fromPath !== fromPath.toLowerCase()) history.replaceState(null, "", (fromPath ? `/${fromPath.toLowerCase()}` : location.pathname) + location.hash);
    try {
      S.brand = (await GET(`/api/branding?code=${encodeURIComponent(linked)}`)).client;
      if (!qs.has("preview")) storeCode(S.brand.loginCode);
      applyBrand(S.brand); return;
    } catch (e) {
      if (fromPath) { history.replaceState(null, "", "/" + location.hash); S.login.err = "That sign-in link isn't recognised. Enter your client code, or ask your manager for the right link."; }
    }
  }
  const code = storedCode();
  if (code) {
    try { S.brand = (await GET(`/api/branding?code=${encodeURIComponent(code)}`)).client; }
    catch (e) { if (e.status === 404) storeCode(""); S.brand = null; }
  }
  applyBrand(S.brand);
}
async function chooseClient() {
  const f = S.login, code = f.code.trim();
  if (!code) { f.err = "Enter your client code. Your manager can tell you what it is."; render(); return; }
  S.busy = true; f.err = ""; render();
  try {
    S.brand = (await GET(`/api/branding?code=${encodeURIComponent(code)}`)).client;
    if (f.remember) storeCode(S.brand.loginCode); else storeCode("");
    applyBrand(S.brand);
  } catch (e) { f.err = e.message; }
  S.busy = false; render();
}
function changeClient() { if (location.pathname !== "/") history.replaceState(null, "", "/" + location.hash); S.brand = null; S.login = { no: "", pin: "", err: "", code: "", remember: true }; storeCode(""); applyBrand(null); render(); }
const shortName = () => (S.brand && S.brand.wordmark) ? S.brand.wordmark.charAt(0) + S.brand.wordmark.slice(1).toLowerCase() : (S.org ? S.org.orgName : "");
const term = k => (S.brand && S.brand.terms && S.brand.terms[k]) || { course: "Course", courses: "Courses", module: "Module", modules: "Modules", document: "Document", documents: "Documents" }[k];

/* ---------- API ---------- */
class ApiError extends Error { constructor(msg, status, body) { super(msg); this.status = status; this.body = body || {}; } }
async function api(method, url, body, opts = {}) {
  const headers = { "x-pelagos": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.passive) headers["x-pelagos-passive"] = "1";
  let res;
  try { res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" }); }
  catch { throw new ApiError("Couldn't reach the portal. Check the Wi-Fi or mobile data, then try again.", 0); }
  let data = null; try { data = await res.json(); } catch {}
  if (res.status === 401 && S.me && !opts.noAuthRedirect) {
    signedOut(data && data.expired ? "You were signed out after a period without activity." : "Sign in again to continue.");
    throw new ApiError("Signed out", 401, data);
  }
  // On the platform: signed out (timed out, or the account was changed) shows the sign-in again, from any button.
  if (S.platformMode && !opts.noAuthRedirect && window.PelPlat && (res.status === 401 || (res.status === 404 && data && data.diag))) {
    window.PelPlat.signedOut(res.status === 401 ? "You were signed out after a while without activity. Sign in again to carry on." : "You’re no longer signed in. Sign in again to carry on.");
    throw new ApiError("Signed out", res.status, data);
  }
  if (!res.ok) throw new ApiError((data && data.error) || "That didn't work. Try again.", res.status, data);
  return data;
}
const GET = (u, o) => api("GET", u, undefined, o), POST = (u, b = {}, o) => api("POST", u, b, o), PUT = (u, b) => api("PUT", u, b), PATCH = (u, b) => api("PATCH", u, b);
function fail(e) { if (e && e.status === 401 && S.me === null) return; toast(e && e.message ? e.message : "That didn't work. Try again.", "bad"); }

/** Upload a file with progress. Returns the stored file's metadata. */
function upload(file, onProgress) {
  const max = (S.features && S.features.maxUploadMb) || 30;
  if (file.size > max * 1024 * 1024) return Promise.reject(new Error(S.features && S.features.reviewSite
    ? `That file is ${Math.ceil(file.size / 1048576)} MB; the review site takes files up to ${max} MB. For videos, use a YouTube link instead.`
    : `That file is ${Math.ceil(file.size / 1048576)} MB; the limit is ${max} MB. Compress it and try again.`));
  return uploadRaw(file, onProgress);
}
function uploadRaw(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append("file", file, file.name);
    const x = new XMLHttpRequest();
    x.open("POST", "/api/admin/files"); x.setRequestHeader("x-pelagos", "1");
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => { let d = null; try { d = JSON.parse(x.responseText); } catch {} if (x.status === 200) resolve(d); else reject(new ApiError((d && d.error) || "Upload failed.", x.status)); };
    x.onerror = () => reject(new ApiError("Upload failed. Check the connection and try again.", 0));
    x.send(fd);
  });
}

/* ---------- routing ---------- */
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
function parseHash() {
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").map(decodeURIComponent).filter(Boolean);
  return parts;
}
async function route() {
  S.copyText = null;
  if (!S.me) { S.view = "login"; render(); return; }
  const p = parseHash();
  const [a, b, c, d] = p;
  let view = "s-home", params = {};
  if (!a) view = isMgrish() ? "m-overview" : "s-home";
  else if (a === "home") view = "s-home";
  else if (a === "doc" && b) { view = "s-doc"; params = { code: b, step: c || null }; }
  else if (a === "declaration") view = "s-declaration";
  else if (a === "record") view = "s-record";
  else if (a === "leave") view = "s-leave";
  else if (a === "course" && b) { view = c === "certificate" ? "s-cert" : c ? "s-lesson" : "s-course"; params = { id: b, lesson: c && c !== "certificate" ? c : null }; }
  else if (a === "preview" && b && isMgrish()) { view = c === "doc" && d ? "p-doc" : "p-home"; params = { pos: b, code: d || null }; }
  else if (a === "m" && isMgrish()) {
    params = { id: c || null };
    view = { overview: "m-overview", staff: c === "new" ? "m-staffnew" : c ? "m-person" : "m-staff", library: "m-library", doc: "m-edit",
      reports: "m-reports", settings: "m-settings", audit: "m-audit", version: "m-version", course: "m-course", reviews: "m-reviews", courses: "m-courses", leave: c ? "m-leave-person" : "m-leave" }[b] || "m-overview";
    if (b === "version") params = { code: c, vid: d };
    if (b === "reviews") params = { filter: c || "pending" };
  }
  if (!["m-leave-person", "s-leave"].includes(view) || (S.params && S.params.id !== params.id)) S.leaveAt = null;
  S.view = view; S.params = params;
  window.scrollTo(0, 0);
  await load();
}

/* ---------- loading ---------- */
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq; const v = S.view, P = S.params;
  const key = v + JSON.stringify(P);
  S.loading = true; S.sameView = S.lastKey === key; S.lastKey = key; render();
  try {
    let data = null;
    if (v === "s-home") { S.lcReturn = null; S.leaveAt = null; const [course, cs, lv] = await Promise.all([GET("/api/my/course"), GET("/api/my/courses").catch(() => ({ courses: [] })), S.features.leave ? GET("/api/my/leave").catch(() => null) : null]); data = { ...course, courses: cs.courses, leave: lv }; }
    else if (v === "s-course" || v === "s-lesson") { S.lcReturn = null; data = await GET(`/api/my/courses/${encodeURIComponent(P.id)}`); if (v === "s-lesson" && (!S.lc || S.lc.lesson !== P.lesson)) S.lc = { lesson: P.lesson, answers: [], result: null }; }
    else if (v === "s-cert") data = await GET(`/api/my/courses/${encodeURIComponent(P.id)}/certificate`);
    else if (v === "s-doc") { data = await GET(`/api/my/documents/${encodeURIComponent(P.code)}`); S.docv = newDocView(data, P.step); }
    else if (v === "s-declaration") { data = await GET("/api/my/declaration"); if (!S.decl) S.decl = { strokes: [], agree: false, name: "" }; }
    else if (v === "s-record") data = await GET("/api/my/record");
    else if (v === "p-home") data = await GET(`/api/admin/preview/${encodeURIComponent(P.pos)}`);
    else if (v === "p-doc") { data = await GET(`/api/admin/documents/${encodeURIComponent(P.code)}/preview`); S.docv = newDocView({ doc: data.doc, state: previewState(data.doc), statement: `I, Preview Staff Member, confirm that I have read and understood ${data.doc.code} ${data.doc.title} (version ${data.doc.label}), and I agree to follow it in my work at ${S.org.orgName}.`, profileName: "Preview Staff Member", preview: true }, null); }
    else if (v === "m-overview") { const [o, ev] = await Promise.all([GET("/api/admin/overview"), GET("/api/admin/evidence?status=pending").catch(() => ({ pending: 0 }))]); data = { ...o, evidencePending: ev.pending }; }
    else if (v === "m-leave") data = await GET("/api/admin/leave");
    else if (v === "m-leave-person") { data = await GET(`/api/admin/leave/${encodeURIComponent(P.id)}${S.leaveAt ? `?date=${S.leaveAt}` : ""}`); window.PelLeave.prepare(data); }
    else if (v === "s-leave") data = await GET(`/api/my/leave${S.leaveAt ? `?date=${S.leaveAt}` : ""}`);
    else if (v === "m-reviews") data = await GET(`/api/admin/evidence?status=${encodeURIComponent(P.filter || "pending")}`);
    else if (v === "m-staff") data = await GET("/api/admin/staff");
    else if (v === "m-staffnew") { data = await GET("/api/admin/staff"); S.staffEdit = { id: null, name: "", staffNo: data.nextStaffNo, positionId: S.org.positions.some(p => p.id === "waitron") ? "waitron" : (S.org.positions[0] || {}).id, startDate: "", role: "staff", pin: randPin() }; }
    else if (v === "m-person") { data = await GET(`/api/admin/staff/${encodeURIComponent(P.id)}`); const p = data.person; S.staffEdit = { id: p.id, name: p.name, staffNo: p.staffNo, positionId: p.positionId, startDate: p.startDate || "", role: p.role }; S.pinReset = null; }
    else if (v === "m-library") data = await GET("/api/admin/documents");
    else if (v === "m-courses") data = await GET("/api/admin/courses");
    else if (v === "m-course") {
      const [docs, c] = await Promise.all([GET("/api/admin/documents"), P.id === "new" ? null : GET(`/api/admin/courses/${encodeURIComponent(P.id)}`)]);
      data = { lib: docs };
      if (!c) S.courseEdit = { id: null, title: "", description: "" };
      else if (!S.courseEdit || S.courseEdit.id !== c.id || !S.courseEdit.dirty) {
        const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        c.draft.modules.forEach(m => m.lessons.forEach(l => { if (l.type === "video") { l.chapters = (l.chapters || []).map(ch => ({ ...ch, time: mmss(ch.at) })); l.durationText = l.durationSec ? mmss(l.durationSec) : ""; } }));
        S.courseEdit = { ...c, change: "minor", open: S.courseEdit && S.courseEdit.id === c.id ? S.courseEdit.open : null, addType: {}, dirty: false, uploading: null };
      }
    }
    else if (v === "m-edit") {
      const [lib, det] = await Promise.all([GET("/api/admin/documents"), P.id === "new" ? null : GET(`/api/admin/documents/${encodeURIComponent(P.id)}`)]);
      data = { lib }; if (det) setEdit(det);
      if (P.id === "new") { S.edit = null; }
    }
    else if (v === "m-version") data = await GET(`/api/admin/documents/${encodeURIComponent(P.code)}/versions/${encodeURIComponent(P.vid)}`);
    else if (v === "m-reports") data = await GET("/api/admin/reports" + (S.filt.rdept ? `?dept=${encodeURIComponent(S.filt.rdept)}` : ""));
    else if (v === "m-settings") { data = canDocs() ? await GET("/api/admin/config") : null; S.cfgEdit = data ? clone(data) : null; }
    else if (v === "m-audit") data = await GET("/api/admin/audit?limit=300");
    if (seq !== loadSeq) return;
    S.data[v] = data;
  } catch (e) {
    if (seq !== loadSeq) return;
    S.data[v] = { error: e.message, status: e.status };
  }
  S.loading = false; render();
}

/* ---------- render ---------- */
let renderPending = false;
function isTyping() { const a = document.activeElement; return !!(a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(checkbox|radio|file)$/.test(a.type)); }
function render() {
  renderPending = false;
  let html;
  if (S.platformMode && window.PelPlat) { $app.innerHTML = window.PelPlat.render(); afterRender(); return; }
  if (S.view === "boot") html = `<div class="boot gutter"><div><p>Opening…</p></div></div>`;
  else if (S.view === "login" || !S.me) html = vLogin();
  else {
    const d = S.data[S.view];
    let inner;
    if (S.loading && !(S.sameView && d && !d.error)) inner = `<div class="loading">Loading…</div>`;
    else if (d && d.error) inner = `<div class="card empty"><h3>${d.status === 404 ? "Not found" : "This page didn't load"}</h3><p>${esc(d.error)}</p><div class="row"><button type="button" class="btn" data-act="reload">Try again</button><a class="btn" href="#/">Back to start</a></div></div>`;
    else inner = null;
    if (S.view.startsWith("m-")) html = vTop() + vMgr(inner);
    else html = vTop() + (inner ? `<main class="wrap gutter">${inner}</main>` : vStaff());
  }
  $app.innerHTML = html;
  afterRender();
}
function afterRender() { setupSig(); setupVideos(); refreshGates(); if (S.view === "login") { const el = document.getElementById(!S.brand ? "f-code" : S.login.no ? "f-pin" : "f-no"); if (el) el.focus({ preventScroll: true }); }
  if (window.PelYT) window.PelYT.mountPreviews();
  if (window.PelLearn && window.PelLearn.afterRender) window.PelLearn.afterRender(); }
// The support visit's countdown; when it runs out, the server has already closed access.
setInterval(() => {
  if (!S.support || S.support.author || S.support.mode === "manage") return;
  const left = Math.max(0, Math.round((new Date(S.support.until) - Date.now()) / 60000));
  const el = document.getElementById("support-left"); if (el) el.textContent = left;
  if (left <= 0) location.href = "/platform";
}, 15000);

function vTop() {
  const st = S.me; const inMgr = S.view.startsWith("m-"); const inPrev = S.view.startsWith("p-");
  const right = `<div class="who"><div style="min-width:0;text-align:right"><div class="nm">${esc(st.name)}</div><div class="ps">${esc(st.positionName)}</div></div>
      ${isMgrish() && !S.support ? (inMgr ? `<a class="bar-btn" href="#/home">My training</a>` : `<a class="bar-btn" href="#/m/overview">Dashboard</a>`) : ""}
      ${S.support ? "" : `<button type="button" class="bar-btn" data-act="logout">Sign out</button>`}</div>`;
  const band = inPrev ? `<div class="preview-band gutter"><div class="in"><strong>Preview</strong><span>You are seeing the course a ${esc(posName(S.params.pos))} gets, including drafts. Nothing you do here is saved.</span><a class="btn sm" href="#/m/settings">Exit preview</a></div></div>` : "";
  const head = `<header class="topbar gutter"><div class="topbar-in"><div class="brand">${brandMark("mark")}<span class="sub">${esc(S.brand && S.brand.subtitle ? S.brand.subtitle + " · Staff Training" : "Staff Training")}</span></div><div class="spacer"></div>${right}</div></header>`;
  return (S.support ? `<div class="sticky-head">${supportBand()}${head}</div>` : head) + band;
}
/** The client's logo if it has one, otherwise its wordmark in the heading font. */
function brandMark(cls) {
  const b = S.brand;
  if (b && b.logoUrl) return `<img class="${cls} logo" src="${esc(b.logoUrl)}" alt="${esc(b.name)}">`;
  return `<span class="${cls}">${esc(b ? b.wordmark : "")}</span>`;
}
/** Shown on every screen while a platform admin is visiting a client or building in the library. Impossible to miss on purpose. */
function supportBand() {
  if (!S.support) return "";
  if (S.support.author) return `<div class="support-band author gutter" role="status"><div class="in"><img class="sb-logo" src="/brand/msp-academy-white.svg" alt="MSP Academy"><strong>Library</strong>
    <span>You're building MSP Academy courses. Share them with clients from the platform.</span>
    <button type="button" class="btn sm" data-act="support-end">Back to the platform</button></div></div>`;
  if (S.support.mode === "manage") return `<div class="support-band author gutter" role="status"><div class="in"><img class="sb-logo" src="/brand/msp-academy-white.svg" alt="MSP Academy"><strong>${esc(S.support.orgName)}</strong>
    <span>You're in this client's portal as MSP Academy admin. Changes are recorded in their audit log.</span>
    <button type="button" class="btn sm" data-act="support-end">Back to the platform</button></div></div>`;
  const left = Math.max(0, Math.round((new Date(S.support.until) - Date.now()) / 60000));
  return `<div class="support-band gutter" role="status"><div class="in"><strong>Support visit to ${esc(S.support.orgName)}</strong>
    <span>Read-only. Everything you open is recorded in their audit log. Ends in <span id="support-left" class="tnum">${left}</span> min.</span>
    <button type="button" class="btn sm" data-act="support-end">End visit</button></div></div>`;
}

/* ---------- sign in ---------- */
function vLogin() {
  const f = S.login, b = S.brand;
  const side = b ? `<section class="login-side ${b.loginArt === "arches" ? "arches" : ""}"><div>${brandMark("mark")}${b.tagline ? `<div class="place">${esc(b.tagline)}</div>` : ""}</div>
      <p class="pitch">${esc(b.pitch)} ${b.pitchAccent ? `<span>${esc(b.pitchAccent)}</span>` : ""}</p>${b.cornerText ? `<div class="coords">${esc(b.cornerText)}</div>` : ""}</section>`
    : `<section class="login-side neutral"><div><img class="academy-logo" src="/brand/msp-academy.svg" alt="MSP Academy"></div>
      <div class="neutral-copy"><p class="pitch">Policies, procedures and sign\u2011offs for your workplace</p><p class="sub">Read it, check your understanding, sign it. Every step is recorded.</p></div></section>`;
  const flash = S.flash ? `<div class="notice info">${esc(S.flash)}</div>` : "";
  const body = !b ? `
      <div class="stack" style="gap:6px"><span class="eyebrow">MSP Academy</span><h1>Sign in</h1><p class="muted">Start with your workplace's client code. Your manager can tell you what it is.</p></div>${flash}
      <form data-form="client-code" autocomplete="off" novalidate>
        <div class="field"><label for="f-code">Client code</label><input id="f-code" type="text" autocapitalize="characters" spellcheck="false" data-bind="login.code" value="${esc(f.code)}" placeholder="e.g. HARBOUR"></div>
        <label class="check"><input type="checkbox" data-bind="login.remember" ${f.remember ? "checked" : ""}><span>Remember it on this device (good for a shared training tablet)</span></label>
        <p class="err" id="lg-err" role="alert">${esc(f.err)}</p>
        <button class="btn primary lg block" type="submit" ${S.busy ? "disabled" : ""}>Continue</button>
      </form>`
    : `
      <div class="stack" style="gap:6px"><span class="eyebrow">${esc(b.name)}</span><h1>Sign in</h1><p class="muted">Use your staff number and PIN.</p></div>${flash}
      ${b.active === false ? `<div class="notice bad">This training portal is paused. Speak to your manager.</div>` : ""}
      <form data-form="login" autocomplete="off" novalidate>
        <div class="field"><label for="f-no">Staff number</label><input id="f-no" type="text" autocapitalize="characters" spellcheck="false" data-bind="login.no" value="${esc(f.no)}" placeholder="e.g. ${esc(b.staffNoPrefix || "")}014"></div>
        <div class="field"><label for="f-pin">PIN</label><input id="f-pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" data-bind="login.pin" value="${esc(f.pin)}"></div>
        <p class="err" id="lg-err" role="alert">${esc(f.err)}</p>
        <button class="btn primary lg block" type="submit" ${S.busy ? "disabled" : ""}>Sign in</button>
      </form>
      <p class="muted" style="font-size:.86rem">Forgot your PIN? Ask your manager to reset it.${S.brandByHost ? "" : ` Not at ${esc(b.name)}? <button type="button" class="linkish" data-act="change-client">Change client</button>`}</p>
      <p class="powered">Powered by <img src="/brand/msp-academy.svg" alt="MSP Academy"></p>`;
  // The way in for the MSP Academy team. On a client's own web address it points to the shared address, where platform sign-in works.
  const admin = `<a class="admin-link" href="/platform" aria-label="MSP Academy admin sign-in"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5Z"/></svg><span>Admin</span></a>`;
  return `<main class="login">${admin}${side}<section class="login-main gutter"><div class="login-card">${body}</div></section></main>`;
}
async function doLogin() {
  const f = S.login;
  if (!f.no.trim() || !/^\d{4,6}$/.test(f.pin)) { f.err = "Enter your staff number and your 4 to 6 digit PIN."; render(); return; }
  S.busy = true; f.err = ""; render();
  try {
    await api("POST", "/api/auth/login", { clientCode: S.brandByHost ? undefined : S.brand.loginCode, staffNo: f.no, pin: f.pin }, { noAuthRedirect: true });
    S.login = { ...S.login, no: "", pin: "", err: "" }; S.flash = null;
    await loadMe();
    S.busy = false;
    if (location.hash && location.hash !== "#/") route(); else go(isMgrish() ? "#/m/overview" : "#/home");
  } catch (e) { S.busy = false; f.pin = ""; f.err = e.message; render(); }
}
async function loadMe() {
  const r = await GET("/api/me", { noAuthRedirect: true });
  if (!r.staff) { S.me = null; if (r.suspended) S.flash = "This training portal is paused. Speak to your manager."; return; }
  S.me = r.staff; S.org = r.org; S.idleSeconds = r.idleSeconds; S.features = r.features || {};
  S.support = r.support || null;
  S.brand = { ...(S.brand || {}), ...r.brand, loginCode: (S.brand && S.brand.loginCode) || r.brand.loginCode };
  applyBrand(S.brand);
  idle.reset();
}
function signedOut(msg) {
  document.getElementById("toast").hidden = true;
  if (S.support) { location.href = "/platform"; return; }
  S.me = null; S.data = {}; S.docv = S.decl = S.edit = S.staffEdit = S.cfgEdit = null; S.flash = msg || null;
  idle.stop(); S.view = "login"; history.replaceState(null, "", "#/"); render();
}
async function logout() { try { await POST("/api/auth/logout"); } catch {} signedOut(null); }

/* ---------- idle sign-out (the server enforces it too) ---------- */
const idle = (() => {
  let last = Date.now(), lastPing = Date.now(), timer = null;
  const activity = () => { last = Date.now(); hideWarn(); };
  ["pointerdown", "keydown", "scroll", "touchstart", "wheel"].forEach(ev => document.addEventListener(ev, activity, { passive: true, capture: true }));
  function videoPlaying() { return Array.from(document.querySelectorAll("video")).some(v => !v.paused && !v.ended); }
  function hideWarn() { const w = document.getElementById("idle"); if (!w.hidden) w.hidden = true; }
  function tick() {
    if (!S.me || !S.idleSeconds) return; // no countdown for managers (0 = they stay signed in)
    if (videoPlaying()) last = Date.now();
    const quiet = (Date.now() - last) / 1000, limit = S.idleSeconds;
    if (quiet >= limit) { POST("/api/auth/logout").catch(() => {}); signedOut("You were signed out after a period without activity."); return; }
    const w = document.getElementById("idle");
    if (limit - quiet <= 60) { w.hidden = false; w.innerHTML = `<div class="in"><span>You will be signed out in ${Math.ceil(limit - quiet)} seconds because this device is shared.</span><button type="button" class="btn sm primary" data-act="stay">Stay signed in</button></div>`; }
    // Tell the server about activity, at most once a minute.
    if (last > lastPing && Date.now() - lastPing > 60000) { lastPing = Date.now(); POST("/api/auth/keepalive").catch(() => {}); }
  }
  return {
    reset() { last = Date.now(); lastPing = Date.now(); clearInterval(timer); timer = setInterval(tick, 1000); },
    stop() { clearInterval(timer); hideWarn(); },
    poke() { activity(); lastPing = 0; tick(); },
  };
})();

/* ---------- staff views ---------- */
function vStaff() {
  const v = S.view;
  if (v === "s-home") return vHome(S.data["s-home"]);
  if (v === "s-doc" || v === "p-doc") return vDoc();
  if (v === "s-declaration") return vDeclaration(S.data["s-declaration"]);
  if (v === "s-record") { const r = S.data["s-record"]; return `<main class="wrap gutter stack"><div class="row between no-print"><a class="back" href="#/home">← My training</a>${r.declaration ? `<button type="button" class="btn sm" data-act="print">Print</button>` : ""}</div>${certificate(r)}</main>`; }
  if (v === "p-home") return vPreviewHome(S.data["p-home"]);
  if (v === "s-leave" && window.PelLeave) return window.PelLeave.sMine(S.data[v]);
  if (window.PelLearn) { if (v === "s-course") return window.PelLearn.vCourse(S.data[v]); if (v === "s-lesson") return window.PelLearn.vLesson(S.data[v]); if (v === "s-cert") return window.PelLearn.vCert(S.data[v]); }
  return "";
}
function ring(pct) {
  const r = 40, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return `<div class="ring-wrap" role="img" aria-label="${pct}% signed"><svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle class="ring-bg" cx="48" cy="48" r="${r}" fill="none" stroke-width="8"/><circle class="ring-fg" cx="48" cy="48" r="${r}" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 48 48)"/></svg><div class="val tnum">${pct}%</div></div>`;
}
function statusChip(s, isNew) {
  if (s === "done") return '<span class="chip ok">Signed</span>';
  if (s === "updated") return '<span class="chip warn">Updated, sign again</span>';
  if (s === "inprogress") return '<span class="chip info">In progress</span>';
  if (isNew) return '<span class="chip warn">New</span>';
  return '<span class="chip">Not started</span>';
}
function courseList(items, link, opts = {}) {
  let n = 0;
  const next = items.find(i => i.status !== "done");
  const known = SECTIONS.map(x => x[0]);
  const item = m => {
    const s = m.status, i = ++n;
    const label = s === "done" ? "Review" : s === "inprogress" ? "Continue" : s === "updated" ? "Read & sign" : "Start";
    const meta = [KINDS[m.kind] || "Document", `${m.estMinutes || 5} min`];
    if (m.videoSeconds) meta.push(`▶ video ${fmtDur(m.videoSeconds)}`);
    if (m.videoCount) meta.push(`▶ ${plural(m.videoCount, "video")}`);
    if (m.questionCount) meta.push(plural(m.questionCount, "question"));
    if (s === "done" && m.signoff) meta.push(`signed ${fmtDate(m.signoff.at)}`);
    return `<li class="ci ${s} ${m.isNew ? "new" : ""}"><span class="ci-num tnum" aria-hidden="true">${s === "done" ? "✓" : i}</span>
      <div style="min-width:0"><div class="ci-code">${esc(m.code)}${m.label ? ` · v${esc(m.label)}` : ""}${m.draft ? " · Draft" : ""}</div><div class="ci-title">${esc(m.title)}</div>
      <div class="ci-meta">${meta.map(esc).join(" · ")}</div></div>
      <div class="ci-side">${opts.preview ? (m.draft ? '<span class="chip warn">Draft</span>' : '<span class="chip">Not started</span>') : statusChip(s, m.isNew)}<a class="btn sm ${!opts.preview && next && next.code === m.code ? "primary" : ""}" href="${link(m)}">${opts.preview ? "Open" : label}</a></div></li>`;
  };
  return SECTIONS.concat([["other", "Other documents"]]).map(([k, label]) => {
    const ms = items.filter(m => k === "other" ? !known.includes(m.kind) : m.kind === k); if (!ms.length) return "";
    const d = ms.filter(m => m.status === "done").length;
    return `<div class="course-group"><div class="cg-head"><span class="eyebrow">${label}</span>${opts.preview ? "" : `<span class="muted tnum" style="font-size:.84rem">${d} of ${ms.length}</span>`}</div><ol class="course card">${ms.map(item).join("")}</ol></div>`;
  }).join("");
}
function vHome(c) {
  const link = m => `#/doc/${encodeURIComponent(m.code)}`;
  let lead;
  if (!c.total) lead = "Nothing has been assigned to your position yet. Check back after your manager publishes your training.";
  else if (!c.outstanding) lead = c.declarationCurrent ? "You're up to date. Your manager will add any new procedures here." : c.declaration ? "Everything is signed. Sign an updated declaration to cover your latest sign-offs." : "All documents are signed. Sign your declaration to finish the course.";
  else lead = `${plural(c.outstanding, "item")} to complete. Work through them in order: read, answer the questions, then sign.`;
  const alerts = c.items.filter(m => m.status === "updated" || (m.status !== "done" && m.isNew));
  const decl = !c.total ? "" : c.canDeclare
    ? `<div class="decl-card ready"><div class="d-main"><h3>${c.declaration ? "Sign an updated declaration" : "Ready to sign your declaration"}</h3><p>${c.declaration ? "You have signed new or updated documents since your last declaration." : `Confirm that you understand the course and agree to follow ${esc(shortName())} policies and procedures.`}</p></div><a class="btn primary" href="#/declaration">Sign declaration</a></div>`
    : c.declaration
      ? `<div class="decl-card signed"><div class="d-main"><h3>Declaration signed</h3><p class="muted">You signed the ${esc(c.courseTitle)} declaration on ${fmtDate(c.declaration.at)}.</p></div><a class="btn" href="#/record">View my training record</a></div>`
      : `<div class="decl-card"><div class="d-main"><h3>Final declaration</h3><p class="muted">Unlocks when every document above is signed.</p></div><span class="chip plain tnum">${c.done} of ${c.total} signed</span></div>`;
  return `<main class="wrap gutter stack" style="gap:26px">
    <section class="hello">${ring(c.pct)}<div class="txt"><span class="eyebrow">${esc(c.courseTitle)}</span><h1>${greeting()}, <span class="accent">${esc(firstName(S.me.name))}</span></h1><p class="muted">${esc(lead)}</p></div></section>
    ${S.brand && S.brand.announcement ? `<div class="announcement" role="note"><span class="a-dot" aria-hidden="true"></span><span>${esc(S.brand.announcement)}</span></div>` : ""}
    ${window.PelLeave ? window.PelLeave.homeCard(c.leave) : ""}
    ${window.PelLearn ? window.PelLearn.coursesSection(c.courses) : ""}
    ${alerts.length ? `<section class="stack" style="gap:10px"><div class="section-title"><h2>Action required</h2><span class="muted" style="font-size:.88rem">New or updated since you last signed</span></div><div class="alerts">${alerts.map(m => `<div class="alert"><div class="a-main"><div class="a-title">${m.status === "updated" ? "Updated" : "New"} ${esc(KINDS[m.kind] || "document")}: ${esc(m.title)}</div><div class="a-sub">${esc(m.code)} · version ${esc(m.label)} · issued ${esc(m.issueDate || fmtDate(m.publishedAt))}</div></div><a class="btn sm primary" href="${link(m)}">${m.status === "updated" ? "Read & sign" : "Start"}</a></div>`).join("")}</div></section>` : ""}
    <section><div class="section-title"><h2>${c.courses && c.courses.length ? esc(term("documents")) : "Your course"}</h2><span class="muted tnum" style="font-size:.88rem">${c.done} of ${c.total} signed · ${esc(c.positionName)}</span></div>
      ${c.total ? `<div class="stack" style="gap:18px">${courseList(c.items, link)}</div>` : `<div class="card empty"><h3>No training assigned yet</h3><p>Your manager publishes SOPs and policies for each position.</p></div>`}</section>
    ${decl}
  </main>`;
}
function vPreviewHome(c) {
  return `<main class="wrap gutter stack" style="gap:26px">
    <section class="hello">${ring(0)}<div class="txt"><span class="eyebrow">${esc(c.courseTitle)}</span><h1>${greeting()}, Preview</h1><p class="muted">${esc(plural(c.items.length, "item"))} for ${esc(c.positionName)}, including drafts.</p></div></section>
    <section><div class="section-title"><h2>Your course</h2><span class="muted" style="font-size:.88rem">${esc(c.positionName)}</span></div>
    ${c.items.length ? `<div class="stack" style="gap:18px">${courseList(c.items, m => `#/preview/${encodeURIComponent(S.params.pos)}/doc/${encodeURIComponent(m.code)}`, { preview: true })}</div>` : `<div class="card empty"><h3>Nothing assigned to this position</h3><p>Tick this position under "Who must complete it" in a document.</p></div>`}</section></main>`;
}

/* ---------- one document: read, quiz, sign ---------- */
function previewState(doc) { return { readAt: null, videos: {}, videosDone: true, hasQuestions: doc.questions.length > 0, attempts: 0, passed: false, signoff: null, signedCurrent: false, status: "todo", canQuiz: false, canSign: false }; }
function newDocView(data, step) {
  const prev = S.docv && S.docv.data.doc.code === data.doc.code && S.docv.data.doc.versionId === data.doc.versionId ? S.docv : null;
  return { data, step: step || null, quiz: prev ? prev.quiz : { answers: {}, result: null }, ack: prev ? prev.ack : { agree: false, name: "" }, vfail: prev ? prev.vfail : {}, vlocal: prev ? prev.vlocal : {}, preview: !!data.preview };
}
function currentStep(dv) {
  const st = dv.data.state, hasQ = dv.data.doc.questions.length > 0;
  if (dv.preview) return dv.step || "read";
  const want = dv.step;
  if (st.status === "done") return want === "read" ? "read" : "done";
  if (want === "read") return "read";
  if (want === "quiz" && st.readAt && hasQ) return "quiz";
  if (want === "sign" && st.canSign) return "sign";
  if (!st.readAt) return "read";
  if (hasQ && !st.passed) return "quiz";
  return "sign";
}
function vDoc() {
  const dv = S.docv; const d = dv.data.doc, st = dv.data.state;
  const hasQ = d.questions.length > 0, step = currentStep(dv);
  const read = !!st.readAt, passed = st.passed, doneNow = st.status === "done";
  const base = dv.preview ? `#/preview/${encodeURIComponent(S.params.pos)}/doc/${encodeURIComponent(d.code)}` : `#/doc/${encodeURIComponent(d.code)}`;
  const back = dv.preview ? `#/preview/${encodeURIComponent(S.params.pos)}` : S.lcReturn || "#/home";
  const stepBtn = (key, n, label, enabled, okd) => `<button type="button" class="step ${step === key ? "on" : ""} ${okd ? "ok" : ""}" data-act="doc-step" data-step="${key}" ${enabled || dv.preview ? "" : "disabled"} ${step === key ? 'aria-current="step"' : ""}><span class="n">${okd ? "✓" : n}</span>${label}</button>`;
  const steps = `<div class="steps">${stepBtn("read", 1, "Read", true, read || doneNow)}${hasQ ? stepBtn("quiz", 2, "Check your understanding", read || doneNow, passed && (read || doneNow)) : ""}${stepBtn("sign", hasQ ? 3 : 2, "Sign off", (read && passed) || doneNow, doneNow)}</div>`;
  const strip = `<div class="dc-strip"><div><div class="k">Document</div><div class="v mono">${esc(d.code)}</div></div><div><div class="k">Type</div><div class="v">${esc(KINDS[d.kind] || "Document")}</div></div><div><div class="k">Version</div><div class="v tnum">${esc(d.label)}</div></div><div><div class="k">Issue date</div><div class="v">${esc(d.issueDate || "—")}</div></div><div><div class="k">Applies to</div><div class="v">${esc(d.appliesText || (S.me.positionName))}</div></div></div>`;
  let body = "";
  if (step === "read") {
    const vids = d.videos;
    const vblock = vids.map((vd, i) => {
      const sv = st.videos[vd.fileId] || {}; const done = sv.completed || doneNow; const failed = sv.failed || dv.vfail[vd.fileId];
      const pct = done ? 100 : Math.min(100, Math.round(((dv.vlocal[vd.fileId] || {}).watched || sv.watched || 0) / (vd.duration || 1) * 100));
      return `<div class="vid"><div class="vh"><span class="vt">${esc(vd.title || "Training video")}${vids.length > 1 ? ` (${i + 1} of ${vids.length})` : ""}</span><span class="${done ? "chip ok" : "chip plain"}" data-vchip="${esc(vd.fileId)}">${done ? "Watched" : esc(fmtDur(vd.duration))}</span></div>
      <video data-vid="${esc(vd.fileId)}" controls playsinline preload="metadata" controlslist="nodownload" src="/api/files/${esc(vd.fileId)}"></video>
      <div class="vbar" aria-hidden="true"><span data-vbar="${esc(vd.fileId)}" style="width:${pct}%"></span></div>
      <span class="gate-note" data-vnote="${esc(vd.fileId)}">${done ? "Watched. Thank you." : failed ? "The video did not load on this device. Read the document below, and tell your manager." : d.requireVideo ? "Watch the whole video, then read the document below." : "Watch the video, then read the document below."}</span></div>`;
    }).join("");
    body = `<article class="stack" style="gap:18px">${vblock}${d.summary ? `<p class="summary">${esc(d.summary)}</p>` : ""}
      ${d.pdf ? `<div class="attach"><span class="chip plain khaki">PDF</span><div style="flex:1;min-width:0"><div style="font-weight:600;overflow-wrap:anywhere">${esc(d.pdf.name)}</div><div class="muted" style="font-size:.84rem">The original document, as printed. The same text is below. ${esc(fmtSize(d.pdf.size))}</div></div><a class="btn sm" href="/api/files/${esc(d.pdf.id)}" target="_blank" rel="noopener">Open the document</a></div>` : ""}
      <div class="doc">${md(d.body) || '<p class="muted">Read the attached document.</p>'}</div>
      <div class="row" style="margin-top:8px">${dv.preview ? `<span class="muted">Preview: staff press "${vids.length ? "I've watched and read this, continue" : "I've read this, continue"}" here.</span>` : doneNow || read ? `<a class="btn" href="${back}">Back to my training</a>${!doneNow && read ? `<button type="button" class="btn primary" data-act="doc-step" data-step="${hasQ && !passed ? "quiz" : "sign"}">Continue</button>` : ""}` : `<button type="button" class="btn primary lg" id="read-continue" data-act="mark-read">${vids.length ? "I've watched and read this, continue" : "I've read this, continue"}</button><span class="gate-note" id="read-gate"></span>`}</div></article>`;
  } else if (step === "quiz") {
    const res = dv.quiz.result; const locked = (res && res.passed) || passed || dv.preview;
    body = `<form data-form="quiz" class="stack" style="gap:0"><p class="muted" style="margin-bottom:18px">${passed && !res ? "You passed this check. Continue to sign off." : `Answer every question. You need ${esc(d.passMark)}% to pass. You can try again if you don't pass.`}</p>
      ${d.questions.map((q, i) => { const wrong = res && !res.passed && res.wrong.includes(i); return `<fieldset class="qset ${wrong ? "wrong" : ""}"><legend><span class="qn">Q${i + 1}</span><span>${esc(q.q)}${wrong ? ' <span class="chip bad" style="margin-left:6px">Check this one</span>' : ""}</span></legend>
        ${q.options.map((o, j) => `<label class="opt ${String(dv.quiz.answers[i]) === String(j) ? "sel" : ""}"><input type="radio" name="q${i}" value="${j}" data-change="quiz-answer" data-i="${i}" ${String(dv.quiz.answers[i]) === String(j) ? "checked" : ""} ${locked && !dv.preview ? "disabled" : ""}><span>${esc(o)}</span></label>`).join("")}</fieldset>`; }).join("")}
      ${res ? `<div class="result ${res.passed ? "pass" : "fail"}" style="margin-top:18px" role="status"><div class="score tnum">${res.correct}/${res.total}</div><div style="flex:1;min-width:200px"><strong>${res.passed ? "Passed" : "Not yet"}</strong><div>${res.passed ? `You scored ${res.score}%. Continue to sign off.` : `You scored ${res.score}%. Re-read the document, then try the marked questions again.`}</div></div>
        ${res.passed ? `<button type="button" class="btn primary" data-act="doc-step" data-step="sign">Continue to sign off</button>` : `<button type="button" class="btn" data-act="doc-step" data-step="read">Re-read</button><button type="button" class="btn primary" data-act="quiz-retry">Try again</button>`}</div>`
      : passed ? `<div class="row" style="margin-top:18px"><button type="button" class="btn primary" data-act="doc-step" data-step="sign">Continue to sign off</button></div>`
      : dv.preview ? `<p class="muted" style="margin-top:18px">Preview: answers are not marked or saved.</p>` : `<div class="row" style="margin-top:18px"><button type="submit" class="btn primary lg" id="quiz-submit" ${S.busy ? "disabled" : ""}>Submit answers</button></div>`}</form>`;
  } else if (step === "sign") {
    body = `<form data-form="sign" class="stack" style="gap:18px">
      <p class="statement">${esc(dv.data.statement)}</p>
      <label class="check"><input type="checkbox" id="ack-agree" data-bind="docv.ack.agree" ${dv.ack.agree ? "checked" : ""}><span>I understand this document and agree to follow it.</span></label>
      <div class="field" style="max-width:420px"><label for="ack-name">Type your full name to sign</label><input id="ack-name" type="text" autocomplete="off" data-bind="docv.ack.name" value="${esc(dv.ack.name)}"><span class="hint">Type it as it appears on your profile: ${esc(dv.data.profileName)}</span></div>
      <p class="err" id="ack-err" role="alert"></p>
      ${dv.preview ? `<p class="muted">Preview: signing is switched off.</p>` : `<div class="row"><button type="submit" class="btn primary lg" id="ack-submit">Sign and complete</button></div>`}</form>`;
  } else {
    const so = st.signoff; const nxt = dv.next;
    body = `<div class="done-panel"><span class="eyebrow">Complete</span><h2>Signed off</h2><p>You signed version ${esc(so.label)} on ${fmtDT(so.at)}${so.score != null ? `, with a score of ${esc(so.score)}%` : ""}.</p>
      <div class="row">${nxt ? `<a class="btn primary" href="#/doc/${encodeURIComponent(nxt.code)}">Next: ${esc(nxt.title)}</a>` : dv.canDeclare ? `<a class="btn primary" href="#/declaration">Sign your declaration</a>` : ""}<a class="btn" href="#/home">Back to my training</a><button type="button" class="btn ghost" data-act="doc-step" data-step="read">Read it again</button></div></div>`;
  }
  return `<main class="wrap gutter stack" style="gap:20px"><div><a class="back" href="${back}">← ${dv.preview ? "Preview course" : "My training"}</a></div>
    <header class="stack" style="gap:8px"><span class="eyebrow">${esc(KINDS[d.kind] || "Document")}${d.status === "draft" ? " · Draft" : ""}</span><h1>${esc(d.title || "Untitled")}</h1></header>
    ${strip}${steps}<section class="card pad" style="padding:clamp(18px,3vw,30px)">${body}</section></main>`;
}
async function refreshDoc(step) {
  const code = S.docv.data.doc.code;
  const data = await GET(`/api/my/documents/${encodeURIComponent(code)}`);
  S.docv = newDocView(data, step || null);
  if (data.state.status === "done") {
    try { const c = await GET("/api/my/course"); S.docv.next = c.items.find(i => i.status !== "done" && i.code !== code); S.docv.canDeclare = c.canDeclare; } catch {}
  }
  render();
}
function staleCheck(e) { if (e && e.status === 409) { toast(e.message, "bad"); refreshDoc(); return true; } return false; }

/* ---------- training videos ---------- */
function setupVideos() {
  if (!S.docv || S.docv.preview) { $app.querySelectorAll("video[data-vid]").forEach(el => { el.addEventListener("error", () => {}); }); return; }
  const dv = S.docv, d = dv.data.doc;
  $app.querySelectorAll("video[data-vid]").forEach(el => {
    const fid = el.dataset.vid, meta = d.videos.find(v => v.fileId === fid) || {};
    const loc = dv.vlocal[fid] = dv.vlocal[fid] || { segs: [], cur: null, last: 0, pos: 0, watched: (dv.data.state.videos[fid] || {}).watched || 0 };
    let sending = false;
    el.addEventListener("loadedmetadata", () => { if (loc.pos && loc.pos < el.duration - 1) el.currentTime = loc.pos; }, { once: true });
    const closeSeg = () => { if (loc.cur && loc.cur[1] > loc.cur[0]) loc.segs.push(loc.cur); loc.cur = null; };
    el.addEventListener("timeupdate", () => {
      const t = el.currentTime, dt = t - loc.last; loc.last = t; loc.pos = t;
      if (!el.seeking && dt > 0 && dt < 1.6) { if (!loc.cur) loc.cur = [Math.max(0, t - dt), t]; else loc.cur[1] = t; }
      else closeSeg();
      if (Date.now() - (loc.sentAt || 0) > 5000) report();
    });
    el.addEventListener("seeking", () => { closeSeg(); loc.last = el.currentTime; });
    el.addEventListener("pause", () => { closeSeg(); report(); });
    el.addEventListener("ended", () => { closeSeg(); report(); });
    el.addEventListener("error", () => {
      if (dv.vfail[fid]) return; dv.vfail[fid] = true;
      POST(`/api/my/documents/${encodeURIComponent(d.code)}/videos/${fid}/failed`, { versionId: d.versionId }).catch(() => {});
      const n = document.querySelector(`[data-vnote="${fid}"]`); if (n) n.textContent = "The video did not load on this device. Read the document below, and tell your manager.";
      refreshGates();
    });
    async function report() {
      if (sending) return;
      const segs = loc.segs.splice(0); if (loc.cur) segs.push([loc.cur[0], loc.cur[1]]);
      if (!segs.length) return;
      if (loc.cur) loc.cur = [loc.cur[1], loc.cur[1]];
      sending = true; loc.sentAt = Date.now();
      try {
        const r = await POST(`/api/my/documents/${encodeURIComponent(d.code)}/videos/${fid}/progress`, { versionId: d.versionId, segments: segs });
        loc.watched = r.watched;
        const b = document.querySelector(`[data-vbar="${fid}"]`); if (b) b.style.width = Math.min(100, Math.round(r.watched / (r.duration || meta.duration || 1) * 100)) + "%";
        if (r.completed) {
          dv.data.state.videos[fid] = Object.assign({}, dv.data.state.videos[fid], { completed: true, watched: r.watched });
          const n = document.querySelector(`[data-vnote="${fid}"]`); if (n) n.textContent = "Watched. Thank you.";
          const ch = document.querySelector(`[data-vchip="${fid}"]`); if (ch) { ch.className = "chip ok"; ch.textContent = "Watched"; }
          refreshGates();
        }
      } catch (e) { if (e.status === 409) staleCheck(e); else loc.segs.unshift(...segs); }
      finally { sending = false; }
    }
  });
}
function videosDone() {
  const dv = S.docv; if (!dv) return true; const d = dv.data.doc;
  if (!d.requireVideo || !d.videos.length) return true;
  return d.videos.every(v => (dv.data.state.videos[v.fileId] || {}).completed || (dv.data.state.videos[v.fileId] || {}).failed || dv.vfail[v.fileId]);
}

/* ---------- signature pad ---------- */
function setupSig() {
  const cv = document.getElementById("sig"); if (!cv || !S.decl) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--paper-ink").trim() || "#18302F";
  S.decl.aspect = w / h;
  const draw = () => { ctx.clearRect(0, 0, w, h); ctx.strokeStyle = ink; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const s of S.decl.strokes) { ctx.beginPath(); s.forEach((pt, i) => i ? ctx.lineTo(pt.x * w, pt.y * h) : ctx.moveTo(pt.x * w, pt.y * h)); if (s.length === 1) ctx.lineTo(s[0].x * w + .5, s[0].y * h + .5); ctx.stroke(); } };
  draw();
  let cur = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  cv.onpointerdown = e => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch {} cur = [pt(e)]; S.decl.strokes.push(cur); S.drawing = true; draw(); };
  cv.onpointermove = e => { if (!cur) return; cur.push(pt(e)); draw(); };
  const end = () => { if (!cur) return; cur = null; S.drawing = false; refreshGates(); };
  cv.onpointerup = end; cv.onpointercancel = end; cv.onpointerleave = end;
}
function sigPng() {
  const a = Math.min(4, Math.max(2, S.decl.aspect || 3)), H = 200, W = Math.round(H * a);
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  x.strokeStyle = "#18302F"; x.lineWidth = 3.2; x.lineCap = "round"; x.lineJoin = "round";
  for (const s of S.decl.strokes) { x.beginPath(); s.forEach((p, i) => i ? x.lineTo(p.x * W, p.y * H) : x.moveTo(p.x * W, p.y * H)); x.stroke(); }
  return c.toDataURL("image/png");
}
const sigPoints = () => (S.decl ? S.decl.strokes.reduce((n, s) => n + s.length, 0) : 0);

/* ---------- button gates (no re-render while typing) ---------- */
function refreshGates() {
  const rc = document.getElementById("read-continue");
  if (rc) { const ok = videosDone(); rc.disabled = !ok || S.busy; const g = document.getElementById("read-gate"); if (g) g.textContent = ok ? "" : "Watch the video to the end to continue."; }
  const qb = document.getElementById("quiz-submit");
  if (qb && S.docv) qb.disabled = S.busy || Object.keys(S.docv.quiz.answers).length < S.docv.data.doc.questions.length;
  const ab = document.getElementById("ack-submit");
  if (ab && S.docv) ab.disabled = !(S.docv.ack.agree && normName(S.docv.ack.name) === normName(S.docv.data.profileName)) || S.busy;
  const db = document.getElementById("decl-submit");
  if (db && S.decl) db.disabled = !(S.decl.agree && normName(S.decl.name) === normName(S.me.name) && sigPoints() > 12) || S.busy;
}

/* ---------- declaration and record ---------- */
function vDeclaration(d) {
  if (d.declarationCurrent) return `<main class="wrap gutter"><div class="card empty"><h3>Your declaration is up to date</h3><p>It covers every document you have signed.</p><div class="row"><a class="btn primary" href="#/record">View my training record</a><a class="btn" href="#/home">Back to my training</a></div></div></main>`;
  if (!d.canDeclare) return `<main class="wrap gutter"><div class="card empty"><h3>Finish your documents first</h3><p>The declaration unlocks when every document in your course is signed. ${esc(plural(d.outstanding, "item"))} to go.</p><a class="btn" href="#/home">Back to my training</a></div></main>`;
  return `<main class="wrap gutter stack" style="gap:20px"><div><a class="back" href="#/home">← My training</a></div>
    <header class="stack" style="gap:8px"><span class="eyebrow">Final step</span><h1>Staff declaration</h1><p class="muted">${esc(d.courseTitle)}</p></header>
    <form data-form="declaration" class="card pad stack" style="gap:18px;padding:clamp(18px,3vw,30px)">
      <p class="statement">${esc(d.text)}</p>
      <div><div class="lbl" style="margin-bottom:8px">Documents covered</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Doc No.</th><th>Document title</th><th>Ver.</th><th>Signed</th></tr></thead><tbody>
        ${d.items.map(m => `<tr><td class="mono">${esc(m.code)}</td><td>${esc(m.title)}</td><td class="tnum">${esc(m.label)}</td><td>${fmtDate(m.signedAt)}</td></tr>`).join("")}
      </tbody></table></div></div>
      <label class="check"><input type="checkbox" id="decl-agree" data-bind="decl.agree" ${S.decl.agree ? "checked" : ""}><span>I understand the course and agree to abide by the policies and procedures listed above.</span></label>
      <div class="field" style="max-width:420px"><label for="decl-name">Full name</label><input id="decl-name" type="text" autocomplete="off" data-bind="decl.name" value="${esc(S.decl.name)}"><span class="hint">As it appears on your profile: ${esc(d.profileName)}</span></div>
      <div class="field"><div class="row between"><span class="lbl" id="sig-l">Signature</span><button type="button" class="btn ghost sm" data-act="sig-clear">Clear</button></div>
        <div class="sig-box"><canvas id="sig" role="img" aria-labelledby="sig-l" aria-label="Signature pad. Sign with your finger or mouse."></canvas><span class="x">×</span><span class="line"></span><span class="ph">Sign with your finger · ${fmtDate(new Date())}</span></div></div>
      <p class="err" id="decl-err" role="alert"></p>
      <div class="row"><button type="submit" class="btn primary lg" id="decl-submit">Sign declaration</button></div>
    </form></main>`;
}
function certificate(r) {
  const c = r.declaration;
  return `<section class="cert"><div class="c-head"><span class="c-mark">${esc(S.brand ? S.brand.wordmark : r.orgName)}</span><span class="mono">${esc(r.recordCode)} · ${esc(r.staff.staffNo)}</span></div>
    <div class="stack" style="gap:6px"><span class="eyebrow" style="color:#64736E">SOP and Memo Acknowledgement Record</span><h2>${esc(r.staff.name)}</h2></div>
    <div class="facts"><div><div class="k">Position</div><div class="v">${esc(r.staff.positionName)}</div></div><div><div class="k">Department</div><div class="v">${esc(r.staff.deptName)}</div></div><div><div class="k">Declaration signed</div><div class="v">${c ? fmtDT(c.at) : "Not yet"}</div></div><div><div class="k">Current status</div><div class="v">${r.outstanding ? esc(plural(r.outstanding, "item")) + " outstanding" : "Up to date"}</div></div></div>
    ${c ? `<p style="font:500 1rem/1.55 var(--f-display)">${esc(c.text)}</p>` : ""}
    <div style="overflow-x:auto"><table><thead><tr><th>Doc No.</th><th>Document title</th><th>Ver. signed</th><th>Signed on</th><th>Score</th></tr></thead><tbody>
      ${r.items.map(m => `<tr><td class="mono">${esc(m.code)}</td><td>${esc(m.title)}</td><td class="tnum">${m.signedLabel ? esc(m.signedLabel) + (m.signedOlderMajor ? ` (current ${esc(m.currentLabel)})` : "") : "—"}</td><td>${fmtDate(m.signedAt)}</td><td class="tnum">${m.score != null ? esc(m.score) + "%" : "—"}</td></tr>`).join("")}
    </tbody></table></div>
    ${c ? `<div><img class="sig-img" src="${esc(c.signatureUrl)}" alt="Signature of ${esc(r.staff.name)}"><div class="sig-line">${esc(c.typedName)} · ${fmtDate(c.at)}</div></div><p class="hash">Record ${esc(c.recordHash.slice(0, 16))}</p>` : ""}
  </section>`;
}
const randPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 10000).padStart(4, "0"); };

window.Pel = { S, esc, md, api, applyBrand, brandPalette, contrast, loadBranding, chooseClient, changeClient, storeCode, SUPPORT_LABEL, isSupport, isAuthor, term, GET, POST, PUT, PATCH, go, route, load, render, toast, fail, confirmBox, closeModal, fmtDate, fmtDT, fmtDur, fmtSize, plural,
  posName, deptName, deptOfPos, KINDS, ROLE_LABEL, role, canEdit, canDocs, isMgrish, clone, setPath, getPath, upload, randPin, certificate, statusChip,
  doLogin, logout, loadMe, signedOut, refreshDoc, staleCheck, refreshGates, sigPng, idle, isTyping, newDocView,
  setModalAction: fn => { modalAction = fn; }, getModalAction: () => modalAction, setEdit: d => setEdit(d) };
function setEdit(det) { window.PelMgr && window.PelMgr.setEdit(det); }
function vMgr(inner) { return window.PelMgr ? window.PelMgr.vMgr(inner) : ""; }
})();
