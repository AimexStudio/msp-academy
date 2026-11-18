// MSP Academy platform admin screens, at /platform: clients, groups, the course library, sharing,
// branding, web addresses, support visits and the platform log.
// Deliberately MSP Academy's own look, unlike any client's portal, so it's always clear which side you're on.
(function () {
"use strict";
const P = window.Pel;
const { S, esc, GET, POST, PUT, api, toast, fail, confirmBox, fmtDate, fmtDT, plural, clone } = P;
const $app = document.getElementById("app");
S.pf = { me: null, view: "boot", params: {}, data: null, loading: false, login: { email: "", password: "", code: "", err: "" }, edit: null, modal: {}, created: null, share: null };
const pf = S.pf;
const LIB = "msp-academy-library";
const statusChip = s => s === "suspended" ? `<span class="chip bad">Suspended</span>` : `<span class="chip ok">Active</span>`;
const sixDigits = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };

/* ---------- routing and loading ---------- */
async function boot() {
  document.documentElement.setAttribute("data-area", "platform");
  P.applyBrand(null); document.title = "MSP Academy · Platform";
  try { pf.me = await GET("/api/platform/me", { noAuthRedirect: true }); } catch { pf.me = null; }
  if (pf.me && pf.me.support) { pf.view = "visiting"; render(); return; }
  route();
}
async function route() {
  if (!pf.me) { pf.view = "login"; render(); return; }
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent).filter(Boolean);
  if (parts[0] === "clients" && parts[1] === "new") { pf.view = "new"; pf.params = {}; }
  else if (parts[0] === "clients" && parts[1]) { pf.view = "client"; pf.params = { orgId: parts[1] }; }
  else if (parts[0] === "log") { pf.view = "log"; pf.params = {}; }
  else if (parts[0] === "groups") { pf.view = "groups"; pf.params = {}; }
  else if (parts[0] === "library") { pf.view = "library"; pf.params = {}; }
  else if (parts[0] === "share" && parts[1] && parts[2]) { pf.view = "share"; pf.params = { orgId: parts[1], courseId: parts[2] }; }
  else { pf.view = "clients"; pf.params = {}; }
  window.scrollTo(0, 0);
  await load();
}
async function load() {
  pf.loading = true; pf.data = null; render();
  try {
    if (pf.view === "clients") pf.data = await GET("/api/platform/clients");
    else if (pf.view === "client") {
      pf.data = await GET(`/api/platform/clients/${encodeURIComponent(pf.params.orgId)}`);
      const c = pf.data.client;
      pf.edit = { name: c.name, loginCode: c.loginCode || "", docPrefix: c.docPrefix, staffNoPrefix: c.staffNoPrefix, groupId: c.groupId || "", b: clone(c.branding), domain: "",
        rescue: { staffNo: "", name: "", pin: sixDigits(), reason: "" } };
    }
    else if (pf.view === "new") {
      pf.data = await GET("/api/platform/groups");
      pf.edit = pf.edit && pf.edit.isNew ? pf.edit : { isNew: true, name: "", loginCode: "", docPrefix: "", staffNoPrefix: "", groupId: "", manager: { name: "", staffNo: "", pin: sixDigits() } };
    }
    else if (pf.view === "groups") { pf.data = await GET("/api/platform/groups"); pf.edit = { newName: "" }; }
    else if (pf.view === "library") pf.data = await GET("/api/platform/library");
    else if (pf.view === "log") pf.data = await GET("/api/platform/audit");
    else if (pf.view === "share") {
      const [detail, list] = await Promise.all([GET(`/api/platform/clients/${encodeURIComponent(pf.params.orgId)}`), GET("/api/platform/clients")]);
      const course = detail.courses.find(c => c.id === pf.params.courseId);
      if (!course) throw Object.assign(new Error("This course no longer exists."), { status: 400 });
      pf.data = { detail, list, course };
      pf.share = { targets: [], publish: false, change: "major", result: null };
    }
  } catch (e) {
    if (e.status === 401 || (e.status === 404 && pf.view !== "client")) { pf.me = null; pf.view = "login"; }
    else pf.data = { error: e.message };
  }
  pf.loading = false; render();
}
function render() { $app.innerHTML = view(); const f = document.getElementById("pf-email"); if (pf.view === "login" && f && !pf.login.email) f.focus(); }

/* ---------- shell ---------- */
function view() {
  if (pf.view === "boot") return `<div class="boot gutter"><div><p>Opening the platform…</p></div></div>`;
  if (pf.view === "login") return vLogin();
  if (pf.view === "visiting") return shell(`<section class="card pad stack" style="gap:12px;max-width:640px"><h1>${pf.me.support.mode === "author" ? "You're in the library" : "You're on a support visit"}</h1>
    <p>${pf.me.support.mode === "author" ? "You're building courses in the MSP Academy library." : `You are visiting <strong>${esc(pf.me.support.orgId)}</strong> until ${fmtDT(pf.me.support.until)}.`} Leave it before working on the platform.</p>
    <div class="row"><a class="btn" href="/#/m/${pf.me.support.mode === "author" ? "library" : "overview"}">Go back to it</a><button type="button" class="btn primary" data-act="pf-support-end">Leave it</button></div></section>`);
  const inner = pf.loading ? `<div class="loading">Loading…</div>`
    : pf.data && pf.data.error ? `<div class="card empty"><h3>This page didn't load</h3><p>${esc(pf.data.error)}</p><a class="btn" href="#/clients">Back to clients</a></div>`
    : ({ clients: vClients, client: vClient, new: vNew, log: vLog, groups: vGroups, share: vShare, library: vLibrary }[pf.view] || (() => ""))();
  return shell(inner);
}
function shell(inner) {
  const on = v => (pf.view === v || (v === "clients" && ["client", "new"].includes(pf.view)) || (v === "library" && pf.view === "share" && pf.params.orgId === LIB)) ? "on" : "";
  return `<header class="topbar gutter pf-bar"><div class="topbar-in"><a class="brand" href="#/clients" aria-label="MSP Academy platform home"><img class="pf-logo" src="/brand/msp-academy.svg" alt="MSP Academy"><span class="sub">Platform</span></a>
      <nav class="pf-nav"><a class="${on("clients")}" href="#/clients">Clients</a><a class="${on("groups")}" href="#/groups">Groups</a><a class="${on("library")}" href="#/library">Library</a><a class="${on("log")}" href="#/log">Log</a></nav><div class="spacer"></div>
      <div class="who"><div class="nm">${esc(pf.me.admin.name)}</div><button type="button" class="bar-btn" data-act="logout">Sign out</button></div></div></header>
    <main class="wrap gutter pf-main">${inner}</main>`;
}
function vLogin() {
  const f = pf.login, local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return `<main class="pf-login gutter"><form class="card pad stack" data-form="pf-login" autocomplete="off" novalidate style="gap:14px">
    <img class="academy-logo" src="/brand/msp-academy.svg" alt="MSP Academy">
    <div class="stack" style="gap:4px"><h1>Platform sign-in</h1><p class="muted">For the MSP Academy team. Client staff sign in on the main page.</p></div>
    <div class="field"><label for="pf-email">Email</label><input id="pf-email" type="email" autocomplete="username" data-bind="pf.login.email" value="${esc(f.email)}"></div>
    <div class="field"><label for="pf-pw">Password</label><input id="pf-pw" type="password" autocomplete="current-password" data-bind="pf.login.password" value=""></div>
    <div class="field"><label for="pf-code">Code from your authenticator app</label><input id="pf-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-bind="pf.login.code" value="${esc(f.code)}"><span class="hint">6 digits. A code works once.${local ? " Not needed for the local demo admin." : ""}</span></div>
    <p class="err" role="alert">${esc(f.err)}</p>
    <button type="submit" class="btn primary block">Sign in</button></form></main>`;
}

/* ---------- clients ---------- */
function clientCard(c) {
  const col = c.colors || {};
  return `<a class="pf-client" href="#/clients/${encodeURIComponent(c.orgId)}">
    <div class="pc-band" style="background:${esc(col.primary || "#26292D")}">${c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="">` : `<span style="color:${esc(col.background || "#fff")}">${esc(c.wordmark || c.name)}</span>`}<span class="pc-dots"><i style="background:${esc(col.accent || "#888")}"></i><i style="background:${esc(col.highlight || "#aaa")}"></i></span></div>
    <div class="pc-body"><div class="row between" style="gap:8px;flex-wrap:nowrap"><strong class="pc-name">${esc(c.name)}</strong>${statusChip(c.status)}</div>
      <div class="pc-meta"><span class="mono">${esc(c.loginCode || "—")}</span><span>No. ${c.clientNo ?? "—"}</span></div>
      <div class="pc-stats"><span><b class="tnum">${c.staff}</b> staff</span><span><b class="tnum">${c.published}</b> documents</span><span><b class="tnum">${c.courses}</b> courses</span></div>
      <div class="pc-foot muted">${c.domains.length ? esc(c.domains[0]) : "Shared sign-in page"} · last sign-in ${fmtDate(c.lastSignInAt)}</div></div></a>`;
}
function vClients() {
  const { clients: list, groups } = pf.data;
  const sections = [...groups.map(g => ({ name: g.name, items: list.filter(c => c.groupId === g.id) })), { name: "No group", items: list.filter(c => !c.groupId) }].filter(x => x.items.length);
  const staff = list.reduce((n, c) => n + c.staff, 0);
  return `<div class="page-head"><div class="t"><h1>Clients</h1><p class="muted">${plural(list.length, "client")} · ${plural(groups.length, "group")} · ${plural(staff, "active staff member")} · ${list.filter(c => c.status === "suspended").length} suspended</p></div><div class="row"><a class="btn primary" href="#/clients/new">Add a client</a></div></div>
    <div class="stack" style="gap:26px">${sections.map(sec => `<section class="stack" style="gap:10px"><h2 class="pf-group-h">${esc(sec.name)} <span class="muted tnum">${sec.items.length}</span></h2><div class="pf-clients">${sec.items.map(clientCard).join("")}</div></section>`).join("") || `<div class="card empty"><p>No clients yet.</p></div>`}</div>`;
}
const groupSelect = (bind, sel) => `<select id="${bind.replace(/\./g, "-")}" data-bind="${bind}"><option value="">No group</option>${(pf.groups || []).map(g => `<option value="${esc(g.id)}" ${sel === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>`;
function vNew() {
  if (pf.created) {
    const c = pf.created;
    return `<section class="card pad stack" style="gap:14px;max-width:680px"><h1>${esc(c.name)} is ready</h1>
      <p>Client number ${c.clientNo}. Give these to the client's manager. The PIN isn't shown again.</p>
      <div class="pf-handover"><div><span class="muted">Client code</span><strong class="mono">${esc(c.loginCode)}</strong></div><div><span class="muted">Staff number</span><strong class="mono">${esc(c.staffNo)}</strong></div><div><span class="muted">PIN</span><strong class="mono">${esc(c.pin)}</strong></div></div>
      <p class="muted">They sign in on the main page with the client code, then set up departments, positions, staff, documents and courses.</p>
      <div class="row"><a class="btn primary" href="#/clients/${encodeURIComponent(c.orgId)}" data-act="pf-created-done">Set up branding</a><a class="btn" href="#/clients" data-act="pf-created-done">Back to clients</a></div></section>`;
  }
  const e = pf.edit, m = e.manager;
  pf.groups = pf.data.groups;
  return `<div class="page-head"><div class="t"><p class="muted"><a href="#/clients">Clients</a> / new</p><h1>Add a client</h1><p class="muted">Creates the client and its first manager. Everything else, the client sets up themselves.</p></div></div>
    <form data-form="pf-new" class="stack" style="gap:18px;max-width:760px">
    <section class="card pad stack" style="gap:14px"><h2>The client</h2>
      <div class="field"><label for="n-name">Name</label><input id="n-name" type="text" data-bind="pf.edit.name" value="${esc(e.name)}" placeholder="e.g. Harbour Hotel Saldanha"></div>
      <div class="grid2"><div class="field"><label for="n-code">Client code</label><input id="n-code" type="text" autocapitalize="characters" data-bind="pf.edit.loginCode" value="${esc(e.loginCode)}" placeholder="HARBOUR"><span class="hint">What staff type on the shared sign-in page. 3 to 20 letters and numbers.</span></div>
        <div class="field"><label for="n-prefix">Document code prefix</label><input id="n-prefix" type="text" autocapitalize="characters" data-bind="pf.edit.docPrefix" value="${esc(e.docPrefix)}" placeholder="HBR"><span class="hint">Documents become HBR-SOP-001, HBR-POL-001…</span></div></div>
      <div class="grid2"><div class="field"><label for="pf-edit-groupId">Group</label>${groupSelect("pf.edit.groupId", e.groupId)}</div>
        <div class="field"><label for="n-sprefix">Staff number prefix (optional)</label><input id="n-sprefix" type="text" autocapitalize="characters" data-bind="pf.edit.staffNoPrefix" value="${esc(e.staffNoPrefix)}" placeholder="HB"></div></div></section>
    <section class="card pad stack" style="gap:14px"><h2>First manager</h2>
      <div class="grid2"><div class="field"><label for="n-mname">Full name</label><input id="n-mname" type="text" data-bind="pf.edit.manager.name" value="${esc(m.name)}"></div>
        <div class="field"><label for="n-mno">Staff number</label><input id="n-mno" type="text" autocapitalize="characters" data-bind="pf.edit.manager.staffNo" value="${esc(m.staffNo)}"></div></div>
      <div class="field" style="max-width:340px"><label for="n-mpin">PIN</label><div class="row" style="flex-wrap:nowrap"><input id="n-mpin" type="text" inputmode="numeric" maxlength="6" class="mono" data-bind="pf.edit.manager.pin" value="${esc(m.pin)}"><button type="button" class="btn sm" data-act="pf-new-pin">New PIN</button></div><span class="hint">6 digits. Shown once more after saving.</span></div></section>
    <p class="err" id="pf-new-err" role="alert"></p>
    <div class="row"><button type="submit" class="btn primary">Add client</button><a class="btn" href="#/clients">Cancel</a></div></form>`;
}
function vGroups() {
  const gs = pf.data.groups;
  return `<div class="page-head"><div class="t"><h1>Groups</h1><p class="muted">Group clients by sector or relationship, e.g. HR, Hospitality. Each client is in one group. Share a course with a whole group at once.</p></div></div>
    <div class="stack" style="gap:16px;max-width:820px">
    <form data-form="pf-group-new" class="card pad row" style="flex-wrap:nowrap;gap:10px"><label class="sr-only" for="g-new">New group name</label><input id="g-new" type="text" data-bind="pf.edit.newName" value="${esc(pf.edit.newName)}" placeholder="New group, e.g. HR"><button type="submit" class="btn primary">Add group</button></form>
    ${gs.length ? gs.map(g => `<section class="card pad stack" style="gap:8px"><div class="row between"><h2>${esc(g.name)}</h2><div class="row"><button type="button" class="btn sm" data-act="pf-group-rename" data-id="${esc(g.id)}" data-name="${esc(g.name)}">Rename</button><button type="button" class="btn sm danger" data-act="pf-group-del" data-id="${esc(g.id)}" data-name="${esc(g.name)}" ${g.clients.length ? "disabled title=\"Move its clients out first\"" : ""}>Delete</button></div></div>
      ${g.clients.length ? `<p>${g.clients.map(c => `<a href="#/clients/${encodeURIComponent(c.orgId)}">${esc(c.name)}</a>`).join(" · ")}</p>` : `<p class="muted">No clients yet. Choose this group on a client's page.</p>`}</section>`).join("") : `<div class="card empty"><p>No groups yet.</p></div>`}</div>`;
}

/* ---------- one client ---------- */
function vClient() {
  const d = pf.data, c = d.client, e = pf.edit;
  pf.groups = d.groups;
  return `<div class="page-head"><div class="t"><p class="muted"><a href="#/clients">Clients</a> / client ${c.clientNo ?? "—"}</p><h1>${esc(c.name)}</h1>
      <p>${statusChip(c.status)}${c.statusReason ? ` <span class="muted">${esc(c.statusReason)}</span>` : ""}</p></div>
    <div class="row"><button type="button" class="btn" data-act="pf-support">Visit as support</button>
      ${c.status === "suspended" ? `<button type="button" class="btn primary" data-act="pf-status" data-s="active">Reactivate</button>` : `<button type="button" class="btn danger" data-act="pf-status" data-s="suspended">Suspend</button>`}</div></div>
  <div class="stack" style="gap:18px">
  <form data-form="pf-details" class="card pad stack" style="gap:14px"><h2>Details</h2>
    <div class="grid2"><div class="field"><label for="c-name">Name</label><input id="c-name" type="text" data-bind="pf.edit.name" value="${esc(e.name)}"></div>
      <div class="field"><label for="c-code">Client code</label><input id="c-code" type="text" autocapitalize="characters" data-bind="pf.edit.loginCode" value="${esc(e.loginCode)}"><span class="hint">Changing it sends devices that remember the old code back to the code screen.</span></div></div>
    <div class="grid2"><div class="field"><label for="pf-edit-groupId">Group</label>${groupSelect("pf.edit.groupId", e.groupId)}</div>
      <div class="field"><label for="c-sprefix">Staff number prefix</label><input id="c-sprefix" type="text" autocapitalize="characters" data-bind="pf.edit.staffNoPrefix" value="${esc(e.staffNoPrefix)}"></div></div>
    <div class="field" style="max-width:360px"><label for="c-prefix">Document code prefix</label><input id="c-prefix" type="text" autocapitalize="characters" data-bind="pf.edit.docPrefix" value="${esc(e.docPrefix)}"><span class="hint">For new documents only. Existing codes never change: they are in signed records.</span></div>
    <div class="row"><button type="submit" class="btn primary">Save details</button></div></form>
  ${vCourses(d)}
  ${vBranding(c)}
  <section class="card pad stack" style="gap:12px"><h2>Own web address</h2>
    <p class="muted">Staff who open one of these addresses go straight to ${esc(c.name)}'s sign-in, with no client code. Connect the address in the Firebase console first (Hosting → Add custom domain), then add it here.</p>
    ${c.domains.length ? `<div class="list">${c.domains.map(h => `<div class="li"><div class="main"><div class="title mono">${esc(h)}</div></div><button type="button" class="btn ghost sm" data-act="pf-domain-del" data-h="${esc(h)}">Remove</button></div>`).join("")}</div>` : `<p>No own address yet. Staff use the shared page with the code <strong class="mono">${esc(c.loginCode || "")}</strong>.</p>`}
    <form data-form="pf-domain" class="row" style="flex-wrap:nowrap"><label class="sr-only" for="c-dom">Web address</label><input id="c-dom" type="text" data-bind="pf.edit.domain" value="${esc(e.domain)}" placeholder="training.example.co.za"><button type="submit" class="btn">Add address</button></form></section>
  <section class="card pad stack" style="gap:12px"><h2>Managers</h2>
    ${d.managers.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Staff number</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>${d.managers.map(m => `<tr><td>${esc(m.name)}</td><td class="mono">${esc(m.staffNo)}</td><td>${m.active ? "Active" : "Left"}</td><td class="muted">${fmtDate(m.lastLoginAt)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No managers.</p>`}
    <details><summary>Help a manager who can't get in</summary>
      <form data-form="pf-rescue" class="stack" style="gap:12px;margin-top:12px"><p class="muted" style="font-size:.9rem">An existing manager's PIN is reset (and they're reactivated if they had left). A staff number that doesn't exist yet adds a new manager. The client sees this, with your reason, in their audit log.</p>
        <div class="grid2"><div class="field"><label for="r-no">Staff number</label><input id="r-no" type="text" autocapitalize="characters" data-bind="pf.edit.rescue.staffNo" value="${esc(e.rescue.staffNo)}"></div>
          <div class="field"><label for="r-name">Full name (new managers only)</label><input id="r-name" type="text" data-bind="pf.edit.rescue.name" value="${esc(e.rescue.name)}"></div></div>
        <div class="grid2"><div class="field"><label for="r-pin">New PIN</label><input id="r-pin" type="text" inputmode="numeric" maxlength="6" class="mono" data-bind="pf.edit.rescue.pin" value="${esc(e.rescue.pin)}"></div>
          <div class="field"><label for="r-why">Reason</label><input id="r-why" type="text" data-bind="pf.edit.rescue.reason" value="${esc(e.rescue.reason)}" placeholder="e.g. Manager phoned: blocked after wrong PINs"></div></div>
        <div class="row"><button type="submit" class="btn">Reset PIN or add manager</button></div></form></details></section>
  <section class="card pad stack" style="gap:12px"><h2>Support visits</h2>
    ${d.supportVisits.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Started</th><th>By</th><th>Reason</th><th>Ended</th><th class="tnum">Pages</th></tr></thead><tbody>${d.supportVisits.map(v => `<tr><td>${fmtDT(v.startedAt)}</td><td>${esc(v.adminName)}</td><td>${esc(v.reason)}</td><td class="muted">${v.endedAt ? fmtDT(v.endedAt) : new Date(v.until) < new Date() ? "Ran out " + fmtDT(v.until) : "Open"}</td><td class="tnum">${v.requests ?? "—"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No support visits yet.</p>`}</section>
  <section class="card pad stack" style="gap:12px"><h2>Platform log for this client</h2>
    ${d.audit.length ? `<div class="list">${d.audit.map(a => `<div class="li"><div class="main"><div class="title">${esc(describe(a))}</div><div class="sub">${fmtDT(a.at)} · ${esc(a.adminName || "Script")}</div></div></div>`).join("")}</div>` : `<p class="muted">Nothing yet.</p>`}</section>
  </div>`;
}
const ACTION_TEXT = { "client.create": "Client created", "client.update": "Details or branding changed", "client.suspend": "Suspended", "client.reactivate": "Reactivated",
  "client.domain_add": "Web address added", "client.domain_remove": "Web address removed", "client.logo_upload": "Logo uploaded", "client.logo_remove": "Logo removed",
  "client.migrate": "Moved onto the platform", "support.start": "Support visit started", "support.end": "Support visit ended",
  "staff.pin_reset_by_platform": "Manager PIN reset", "staff.manager_add_by_platform": "Manager added", "platform_admin.create": "Platform admin added",
  "course.share": "Course shared in", "course.share_out": "Course shared out", "group.create": "Group added", "group.rename": "Group renamed", "group.delete": "Group deleted",
  "library.open": "Opened the library", "library.close": "Left the library" };
function describe(a) {
  const d = a.details || {}, t = ACTION_TEXT[a.action] || a.action;
  const extra = a.action === "course.share" ? `: ${d.course}, from ${d.from} to ${d.to}` : a.action === "course.share_out" ? `: ${d.course} to ${(d.to || []).join(", ")}`
    : a.action === "group.rename" ? `: ${d.from} → ${d.to}` : d.name && a.action.startsWith("group.") ? `: ${d.name}` : d.reason ? `: ${d.reason}` : d.host ? `: ${d.host}` : d.staffNo ? `: ${d.staffNo}` : d.email ? `: ${d.email}` : "";
  return t + extra;
}

/* ---------- courses, the library and sharing ---------- */
function courseRow(orgId, x) {
  return `<div class="pf-course"><div class="row between" style="align-items:flex-start;gap:12px"><div style="min-width:0"><strong>${esc(x.title)}</strong> ${x.label ? `<span class="chip ok">v${esc(x.label)}</span>` : `<span class="chip warn">${esc(x.status === "archived" ? "Archived" : "Draft")}</span>`}
      ${x.description ? `<div class="muted" style="font-size:.88rem">${esc(x.description)}</div>` : ""}
      <div class="muted" style="font-size:.82rem;margin-top:4px">${plural(x.lessonCount, "lesson")}${x.documents.length ? ` · SOPs: ${x.documents.map(dd => esc(dd.code)).join(", ")}` : ""}</div></div>
      ${x.shareable ? `<a class="btn sm primary" href="#/share/${encodeURIComponent(orgId)}/${encodeURIComponent(x.id)}">Share…</a>` : `<span class="muted" style="font-size:.84rem;max-width:220px;text-align:right">${esc(x.notShareableReason || "")}</span>`}</div>
    ${x.sharedTo.length ? `<div class="pf-shared-to">${x.sharedTo.map(t => `<span class="chip ${t.behind ? "warn" : "plain"}" title="${esc("Shared " + fmtDT(t.at) + (t.by ? " by " + t.by : ""))}">${esc(t.targetName)}${t.behind ? " · newer version not yet shared" : ""}</span>`).join("")}</div>` : ""}</div>`;
}
function vLibrary() {
  const d = pf.data;
  return `<div class="page-head"><div class="t"><h1>MSP Academy library</h1><p class="muted">Courses built by the MSP Academy team, to share with any client. Clients see them as provided by MSP Academy.</p></div>
    <button type="button" class="btn primary" data-act="pf-lib-open">Open the course builder</button></div>
    <section class="card pad stack" style="gap:12px">${d.courses.length ? d.courses.map(x => courseRow(d.orgId, x)).join("")
      : `<p class="muted">No courses yet. Open the course builder, then choose <strong>SOP library → New course</strong>. When a course is published, share it from here.</p>`}</section>`;
}
function vCourses(d) {
  const c = d.client, own = d.courses.filter(x => !x.receivedCopy);
  return `<section class="card pad stack" style="gap:12px"><h2>Courses</h2>
    <p class="muted" style="font-size:.9rem">Courses ${esc(c.name)}'s managers built. Share one to give other clients their own copy. Sharing only happens when you share: later versions don't follow by themselves.</p>
    ${own.length ? own.map(x => courseRow(c.orgId, x)).join("") : `<p class="muted">No courses yet. The client's managers create them under SOP library → Courses.</p>`}
    ${d.received.length ? `<details><summary>Courses shared to ${esc(c.name)} (${d.received.length})</summary><div class="list" style="margin-top:8px">${d.received.map(r => `<div class="li"><div class="main"><div class="title">${esc(r.courseTitle)} <span class="muted">from ${esc(r.fromName)}</span></div><div class="sub">${fmtDT(r.at)}${r.by ? " · " + esc(r.by) : ""} · ${r.published ? "published straight away" : "as drafts"}</div></div></div>`).join("")}</div></details>` : ""}
  </section>`;
}
function vShare() {
  const { detail, list, course } = pf.data, sh = pf.share, src = detail.client;
  const back = src.orgId === LIB ? "#/library" : `#/clients/${encodeURIComponent(src.orgId)}`;
  if (sh.result) {
    return `<section class="card pad stack" style="gap:14px;max-width:820px"><h1>Shared ${esc(course.title)}</h1>
      ${sh.result.results.map(r => `<div><strong>${esc(r.targetName)}</strong><div class="muted" style="font-size:.9rem">Course: ${r.course === "new" ? "new copy" : r.course === "updated" ? "updated" : "already up to date"}${r.coursePublished ? `, published v${esc(r.coursePublished)}` : ""}${r.documents.length ? " · " : ""}${r.documents.map(x => `${esc(x.targetCode)}: ${x.result === "new" ? "new copy" : x.result === "updated" ? "updated" : "already up to date"}${x.published ? `, published v${esc(x.published)}` : ""}`).join(" · ")}</div></div>`).join("")}
      <p class="muted">${sh.publish ? "Published straight away." : "Each client's manager now finds it as a draft, chooses who must complete it, and publishes."} Each client sees it as provided by MSP Academy.</p>
      <div class="row"><a class="btn primary" href="${back}">Back to ${esc(src.name)}</a></div></section>`;
  }
  const others = list.clients.filter(c => c.orgId !== src.orgId);
  const prev = new Map(course.sharedTo.map(t => [t.targetOrgId, t]));
  const sections = [...list.groups.map(g => ({ id: g.id, name: g.name, items: others.filter(c => c.groupId === g.id) })), { id: "", name: "No group", items: others.filter(c => !c.groupId) }].filter(x => x.items.length);
  const anyUpdate = sh.targets.some(t => prev.has(t));
  return `<div class="page-head"><div class="t"><p class="muted"><a href="${back}">${esc(src.name)}</a> / share</p><h1>Share ${esc(course.title)}</h1>
      <p class="muted">${plural(course.lessonCount, "lesson")}${course.label ? ` · version ${esc(course.label)}` : ""}</p></div></div>
    <form data-form="pf-share" class="stack" style="gap:16px;max-width:900px">
    <section class="card pad stack" style="gap:14px"><h2>Share with</h2>
      ${sections.map(sec => { const all = sec.items.every(c => sh.targets.includes(c.orgId));
        return `<div class="pf-target-group"><div class="row between"><strong>${esc(sec.name)}</strong><button type="button" class="btn ghost sm" data-act="pf-share-group" data-g="${esc(sec.id)}">${all ? "Clear" : "Select whole group"}</button></div>
          ${sec.items.map(c => { const p = prev.get(c.orgId); return `<label class="check"><input type="checkbox" data-change="pf-share-target" data-id="${esc(c.orgId)}" ${sh.targets.includes(c.orgId) ? "checked" : ""}><span>${esc(c.name)}${c.status === "suspended" ? ' <span class="chip bad">Suspended</span>' : ""}${p ? ` <span class="muted" style="font-size:.84rem">· has it from ${fmtDate(p.at)}${p.behind ? ", a newer version is waiting" : ", up to date"}</span>` : ""}</span></label>`; }).join("")}</div>`; }).join("") || `<p class="muted">There are no clients to share with yet.</p>`}
    </section>
    <section class="card pad stack" style="gap:10px"><h2>How it arrives</h2>
      <label class="check"><input type="radio" name="pf-mode" data-change="pf-share-mode" data-v="draft" ${!sh.publish ? "checked" : ""}><span><strong>As a draft for their manager</strong> (recommended)<br><span class="muted" style="font-size:.86rem">Their manager chooses who must complete it, then publishes. New items start as "all staff".</span></span></label>
      <label class="check"><input type="radio" name="pf-mode" data-change="pf-share-mode" data-v="publish" ${sh.publish ? "checked" : ""}><span><strong>Publish straight away</strong><br><span class="muted" style="font-size:.86rem">New items go to all their staff at once. Items they already have keep their choice of who completes them.</span></span></label>
      ${sh.publish && anyUpdate ? `<div class="pf-change"><span class="lbl">For clients that already have it, a change is…</span>
        <label class="check"><input type="radio" name="pf-chg" data-change="pf-share-change" data-v="major" ${sh.change === "major" ? "checked" : ""}><span>A new version: their staff complete it again</span></label>
        <label class="check"><input type="radio" name="pf-chg" data-change="pf-share-change" data-v="minor" ${sh.change === "minor" ? "checked" : ""}><span>A minor change: progress and signatures stay valid</span></label></div>` : ""}
    </section>
    <p class="muted" style="font-size:.88rem">Each client gets its own copy of the course, its videos and PDFs, shown as provided by MSP Academy. They never see where it came from. Their staff's records stay their own.</p>
    <p class="err" id="pf-share-err" role="alert"></p>
    <div class="row"><button type="submit" class="btn primary" ${sh.targets.length && !S.busy ? "" : "disabled"}>${S.busy ? "Sharing…" : `Share with ${plural(sh.targets.length, "client")}`}</button><a class="btn" href="${back}">Cancel</a></div>
    </form>`;
}

/* ---------- branding, with a live preview ---------- */
const FONT_OPTIONS = sel => Object.entries(pf.me.fonts).map(([k, f]) => `<option value="${k}" ${sel === k ? "selected" : ""}>${esc(f.label)}</option>`).join("");
function vBranding(c) {
  const b = pf.edit.b;
  const color = (k, label, hint) => `<div class="field"><label for="b-${k}">${label}</label><div class="row" style="flex-wrap:nowrap;gap:10px"><input id="b-${k}" type="color" data-bind="pf.edit.b.colors.${k}" data-preview="1" value="${esc(b.colors[k].toLowerCase())}"><span class="mono" id="b-${k}-hex">${esc(b.colors[k])}</span></div><span class="hint">${hint}</span></div>`;
  const text = (k, label, ph, max) => `<div class="field"><label for="b-${k}">${label}</label><input id="b-${k}" type="text" maxlength="${max}" data-bind="pf.edit.b.${k}" data-preview="1" value="${esc(b[k])}" placeholder="${esc(ph)}"></div>`;
  const tm = (k, label, ph) => `<div class="field"><label for="b-t-${k}">${label}</label><input id="b-t-${k}" type="text" maxlength="24" data-bind="pf.edit.b.terms.${k}" value="${esc(b.terms[k])}" placeholder="${esc(ph)}"></div>`;
  return `<form data-form="pf-branding" class="card pad stack" style="gap:16px"><h2>Branding</h2>
    <div class="pf-brand">
      <div class="stack" style="gap:14px">
        <div class="grid2">${text("wordmark", "Name in the top bar", "HARBOUR", 24)}${text("subtitle", "Shown after it", "Saldanha", 60)}</div>
        <div class="field"><span class="lbl">Logo</span>${c.logo ? `<div class="row"><span>${esc(c.logo.name)}</span><button type="button" class="btn ghost sm" data-act="pf-logo-del">Remove</button></div>` : ""}
          <input type="file" accept="image/png,image/jpeg,image/webp" data-change="pf-logo"><span class="hint">PNG, JPEG or WebP, under 512 KB, light enough to read on the top-bar colour. Replaces the name in the top bar and on the sign-in page.</span></div>
        <div class="grid2">${color("primary", "Main colour", "Top bar, sign-in panel, main buttons")}${color("accent", "Accent", "Links and progress bars")}${color("highlight", "Highlight", "Small touches on the bar and sign-in page")}${color("background", "Page background", "Behind everything")}</div>
        <div class="grid2"><div class="field"><label for="b-hf">Heading font</label><select id="b-hf" data-bind="pf.edit.b.headingFont" data-rerender="1">${FONT_OPTIONS(b.headingFont)}</select></div>
          <div class="field"><label for="b-bf">Text font</label><select id="b-bf" data-bind="pf.edit.b.bodyFont" data-rerender="1">${FONT_OPTIONS(b.bodyFont)}</select></div></div>
        <label class="check"><input type="checkbox" data-bind="pf.edit.b.headingCaps" data-rerender="1" ${b.headingCaps ? "checked" : ""}><span>Headings and buttons in capitals</span></label>
        <div class="grid2">${text("tagline", "Sign-in page: line under the name", "Saldanha Bay", 80)}${text("cornerText", "Sign-in page: corner text", "", 40)}</div>
        <div class="grid2">${text("pitch", "Sign-in page: message", "Your standards", 80)}${text("pitchAccent", "…ending in the highlight colour", "on every shift", 40)}</div>
        <label class="check"><input type="checkbox" data-change="pf-arches" ${b.loginArt === "arches" ? "checked" : ""}><span>Arches along the bottom of the sign-in panel</span></label>
        <div class="field"><label for="b-ann">Announcement on staff home screens (optional)</label><input id="b-ann" type="text" maxlength="240" data-bind="pf.edit.b.announcement" value="${esc(b.announcement)}" placeholder="e.g. Fire drill on Friday at 10:00"></div>
        <fieldset class="pf-terms"><legend>Wording this client uses</legend><div class="grid2">${tm("course", "One course", "Course")}${tm("courses", "Several", "Courses")}${tm("module", "One module", "Module")}${tm("modules", "Several", "Modules")}</div></fieldset>
      </div>
      <div class="stack" style="gap:8px"><span class="lbl">Preview</span><div id="pf-preview">${preview(c)}</div><div id="pf-contrast">${contrastNotes()}</div></div>
    </div>
    <div class="row"><button type="submit" class="btn primary">Save branding</button><button type="button" class="btn" data-act="pf-brand-reset">Discard changes</button></div></form>`;
}
function previewVars() {
  const b = pf.edit.b, v = P.brandPalette(b.colors);
  v["--f-display"] = pf.me.fonts[b.headingFont].stack; v["--f-body"] = pf.me.fonts[b.bodyFont].stack;
  return Object.entries(v).map(([k, x]) => `${k}:${x}`).join(";");
}
function preview(c) {
  const b = pf.edit.b, logo = c.logo && c.preview.logoUrl;
  const mark = logo ? `<img class="mark logo" src="${esc(c.preview.logoUrl)}" alt="">` : `<span class="mark">${esc(b.wordmark || c.name.split(/\s+/)[0].toUpperCase())}</span>`;
  return `<div class="pf-preview ${b.headingCaps ? "" : "nocaps"}" style="${esc(previewVars())}">
    <div class="pv-side"><div>${mark}${b.tagline ? `<div class="place">${esc(b.tagline)}</div>` : ""}</div><p class="pitch">${esc(b.pitch)} <span>${esc(b.pitchAccent)}</span></p></div>
    <div class="pv-bar">${mark}<span class="sub">${esc(b.subtitle ? b.subtitle + " · " : "")}Staff Training</span></div>
    <div class="pv-page">${b.announcement ? `<div class="pv-ann">${esc(b.announcement)}</div>` : ""}<h2>${esc(b.terms.courses)}</h2><p>Read each document, answer the questions and sign. <a href="#" tabindex="-1">Open the library</a></p>
      <div class="pv-progress"><span></span></div><div class="row"><span class="btn primary sm">Continue</span><span class="btn sm">Reports</span></div></div></div>`;
}
function contrastNotes() {
  const c = pf.edit.b.colors, pal = P.brandPalette(c), notes = [];
  if (P.contrast(pal["--on-primary"], c.primary) < 4.5) notes.push("Text on the main colour is hard to read. Choose a darker or lighter main colour.");
  if (P.contrast(c.accent, pal["--surface"] || "#F4F2EA") < 4.5) notes.push("Links in the accent colour are hard to read on the page. Choose a darker accent.");
  if (P.contrast(c.highlight, c.primary) < 3) notes.push("The highlight barely shows on the main colour, so a lighter shade of the bar text is used there instead.");
  return notes.length ? `<div class="notice warn">${notes.map(esc).join("<br>")}</div>` : `<p class="muted" style="font-size:.86rem">Colours are readable.</p>`;
}
// Update the preview while typing or dragging a colour, without redrawing the form (which would close the picker).
document.addEventListener("input", e => {
  if (!S.platformMode || !e.target.dataset || !e.target.dataset.preview || !pf.edit || !pf.edit.b) return;
  if (e.target.type === "color") { const v = e.target.value.toUpperCase(); P.setPath(S, e.target.dataset.bind, v); const h = document.getElementById(e.target.id + "-hex"); if (h) h.textContent = v; }
  const pv = document.getElementById("pf-preview"), cn = document.getElementById("pf-contrast");
  if (pv) pv.innerHTML = preview(pf.data.client); if (cn) cn.innerHTML = contrastNotes();
});

function vLog() {
  const list = pf.data.entries;
  return `<div class="page-head"><div class="t"><h1>Platform log</h1><p class="muted">Everything done on the platform, newest first.</p></div></div>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Client</th><th>What</th></tr></thead><tbody>
    ${list.map(a => `<tr><td style="white-space:nowrap">${fmtDT(a.at)}</td><td>${esc(a.adminName || "Script")}</td><td>${a.orgId ? `<a href="#/clients/${encodeURIComponent(a.orgId)}">${esc(a.orgId)}</a>` : "—"}</td><td>${esc(describe(a))}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><p>Nothing yet.</p></div>`}`;
}

/* ---------- clicks and forms ---------- */
const orgUrl = (s = "") => `/api/platform/clients/${encodeURIComponent(pf.params.orgId)}${s}`;
function uploadTo(url, file) {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append("file", file, file.name);
    const x = new XMLHttpRequest(); x.open("POST", url); x.setRequestHeader("x-pelagos", "1");
    x.onload = () => { let d = null; try { d = JSON.parse(x.responseText); } catch {} x.status === 200 ? resolve(d) : reject(new Error((d && d.error) || "Upload failed.")); };
    x.onerror = () => reject(new Error("Upload failed. Check the connection and try again.")); x.send(fd);
  });
}
const clientLogout = () => P.logout();
P.addActions({
  logout: async () => {
    if (!S.platformMode) return clientLogout();
    try { await POST("/api/auth/logout"); } catch {}
    pf.me = null; pf.view = "login"; render();
  },
  "pf-new-pin": () => { pf.edit.manager.pin = sixDigits(); render(); },
  "pf-lib-open": async () => { try { await POST("/api/platform/library/open"); location.href = "/#/m/library"; } catch (e) { fail(e); } },
  "pf-share-group": (t, ds) => {
    const ids = pf.data.list.clients.filter(c => c.orgId !== pf.data.detail.client.orgId && (c.groupId || "") === ds.g).map(c => c.orgId);
    const all = ids.every(id => pf.share.targets.includes(id));
    pf.share.targets = all ? pf.share.targets.filter(id => !ids.includes(id)) : [...new Set([...pf.share.targets, ...ids])]; render();
  },
  "pf-group-rename": (t, ds) => {
    pf.modal = { name: ds.name };
    confirmBox(`Rename ${ds.name}`, "", "Rename", async () => { try { await PUT(`/api/platform/groups/${encodeURIComponent(ds.id)}`, { name: pf.modal.name }); toast("Group renamed."); load(); } catch (e) { fail(e); } }, false,
      `<div class="field" style="margin:14px 0"><label for="m-gname">Name</label><input id="m-gname" type="text" data-bind="pf.modal.name" value="${esc(ds.name)}"></div>`);
  },
  "pf-group-del": (t, ds) => confirmBox(`Delete ${ds.name}?`, "The group is removed. No client is affected.", "Delete", async () => { await api("DELETE", `/api/platform/groups/${encodeURIComponent(ds.id)}`); toast("Group deleted."); load(); }, true),
  "pf-created-done": () => { pf.created = null; pf.edit = null; },
  "pf-brand-reset": () => { pf.edit.b = clone(pf.data.client.branding); render(); },
  "pf-support": () => {
    pf.modal = { reason: "", minutes: "30" };
    confirmBox(`Visit ${pf.data.client.name} as support`, "You'll see their portal as a read-only manager. They see the visit, your reason and every page you open in their audit log.", "Start visit", async () => {
      try { await POST("/api/platform/support", { orgId: pf.params.orgId, reason: pf.modal.reason, minutes: Number(pf.modal.minutes) }); location.href = "/#/m/overview"; } catch (e) { fail(e); }
    }, false, `<div class="field" style="margin:14px 0"><label for="m-why">Why do you need to look?</label><textarea id="m-why" rows="3" data-bind="pf.modal.reason" placeholder="e.g. Manager asked why the Kitchen report shows 60%"></textarea></div>
      <div class="field" style="margin-bottom:14px;max-width:220px"><label for="m-min">For how long</label><select id="m-min" data-bind="pf.modal.minutes"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></div>`);
  },
  "pf-support-end": async () => { await POST("/api/platform/support/end"); pf.me.support = null; route(); },
  "pf-status": (t, ds) => {
    const c = pf.data.client;
    if (ds.s === "active") return confirmBox(`Reactivate ${c.name}?`, "Their staff can sign in again straight away.", "Reactivate", async () => { await POST(orgUrl("/status"), { status: "active" }); toast("Reactivated."); load(); });
    pf.modal = { reason: "" };
    confirmBox(`Suspend ${c.name}?`, "Nobody at this client can sign in, and anyone signed in is stopped within seconds. Nothing is deleted; you can reactivate at any time.", "Suspend", async () => {
      try { await POST(orgUrl("/status"), { status: "suspended", reason: pf.modal.reason }); toast("Suspended."); load(); } catch (e) { fail(e); }
    }, true, `<div class="field" style="margin:14px 0"><label for="m-sus">Reason (recorded)</label><input id="m-sus" type="text" data-bind="pf.modal.reason" placeholder="e.g. Invoice overdue"></div>`);
  },
  "pf-domain-del": (t, ds) => confirmBox(`Remove ${ds.h}?`, "Staff opening this address will be asked for the client code instead.", "Remove", async () => {
    await api("DELETE", orgUrl(`/domains/${encodeURIComponent(ds.h)}`)); toast("Address removed."); load();
  }, true),
  "pf-logo-del": () => confirmBox("Remove the logo?", "The name is shown instead.", "Remove", async () => { await api("DELETE", orgUrl("/logo")); toast("Logo removed."); load(); }, true),
});
document.addEventListener("change", async e => {
  if (!S.platformMode) return;
  const act = e.target.dataset && e.target.dataset.change;
  if (act === "pf-arches") { pf.edit.b.loginArt = e.target.checked ? "arches" : "none"; return; }
  if (act === "pf-share-target") { const id = e.target.dataset.id; pf.share.targets = e.target.checked ? [...new Set([...pf.share.targets, id])] : pf.share.targets.filter(x => x !== id); render(); return; }
  if (act === "pf-share-mode") { pf.share.publish = e.target.dataset.v === "publish"; render(); return; }
  if (act === "pf-share-change") { pf.share.change = e.target.dataset.v; return; }
  if (act === "pf-logo") {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { await uploadTo(orgUrl("/logo"), f); toast("Logo uploaded."); load(); } catch (err) { fail(err); }
  }
});
const showErr = (id, e) => { const el = document.getElementById(id); if (el) el.textContent = e.message; else fail(e); };
P.addForms({
  "pf-login": async () => {
    const f = pf.login;
    try { await api("POST", "/api/platform/login", { email: f.email, password: f.password, code: f.code }, { noAuthRedirect: true }); pf.login = { email: "", password: "", code: "", err: "" }; await boot(); }
    catch (e) { f.err = e.message; f.code = ""; render(); }
  },
  "pf-new": async () => {
    const e = pf.edit;
    try {
      const r = await POST("/api/platform/clients", { name: e.name, loginCode: e.loginCode, docPrefix: e.docPrefix, staffNoPrefix: e.staffNoPrefix, groupId: e.groupId || null, manager: e.manager });
      pf.created = { ...r, name: e.name.trim(), staffNo: e.manager.staffNo.trim().toUpperCase(), pin: e.manager.pin }; pf.edit = null; render();
    } catch (err) { showErr("pf-new-err", err); }
  },
  "pf-details": async () => { const e = pf.edit; await PUT(orgUrl(), { name: e.name, loginCode: e.loginCode, docPrefix: e.docPrefix, staffNoPrefix: e.staffNoPrefix, groupId: e.groupId || null }); toast("Details saved."); load(); },
  "pf-branding": async () => { await PUT(orgUrl(), { branding: pf.edit.b }); toast("Branding saved. Staff see it the next time a page loads."); load(); },
  "pf-domain": async () => { const r = await POST(orgUrl("/domains"), { host: pf.edit.domain }); toast(`${r.host} added.`); load(); },
  "pf-group-new": async () => { const r = await POST("/api/platform/groups", { name: pf.edit.newName }); toast(`${r.name} added.`); load(); },
  "pf-rescue": async () => {
    const r = pf.edit.rescue;
    const out = await POST(orgUrl("/manager"), { staffNo: r.staffNo, name: r.name || undefined, pin: r.pin, reason: r.reason });
    toast(`${out.created ? "Manager added" : "PIN reset"}: ${r.staffNo.toUpperCase()} now signs in with PIN ${r.pin}. Tell them now; it isn't shown again.`); load();
  },
  "pf-share": async () => {
    const sh = pf.share; S.busy = true; render();
    try { sh.result = await POST("/api/platform/share", { sourceOrgId: pf.params.orgId, courseId: pf.params.courseId, targetOrgIds: sh.targets, publish: sh.publish, change: sh.change }); }
    catch (err) { S.busy = false; render(); showErr("pf-share-err", err); return; }
    S.busy = false; render(); window.scrollTo(0, 0);
  },
});

window.PelPlat = { boot, route, render: view };
})();
