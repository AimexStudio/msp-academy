// Manager, head-of-department and auditor screens.
(function () {
"use strict";
const P = window.Pel;
const { S, esc, md, fmtDate, fmtDT, fmtDur, fmtSize, plural, posName, deptName, KINDS, ROLE_LABEL, canEdit, canDocs } = P;

function vMgr(inner) {
  const v = S.view;
  const lib = S.data["m-library"];
  const drafts = lib && !lib.error ? lib.documents.filter(d => d.status === "draft").length : 0;
  const on = keys => keys.includes(v) ? "on" : "";
  const nav = (href, label, keys, extra = "") => `<a class="nav ${on(keys)}" href="${href}" ${on(keys) ? 'aria-current="page"' : ""}><span>${label}</span>${extra}</a>`;
  const body = inner || ({ "m-overview": mOverview, "m-staff": mStaff, "m-staffnew": mStaffNew, "m-person": mPerson, "m-library": mLibrary,
    "m-edit": mEdit, "m-version": mVersion, "m-reports": mReports, "m-settings": mSettings, "m-audit": mAudit }[v] || (() => ""))(S.data[v]);
  return `<div class="gutter"><div class="mgr"><nav class="rail" aria-label="Manager"><span class="eyebrow">${esc(ROLE_LABEL[P.role()])}</span>
    ${nav("#/m/overview", "Overview", ["m-overview"])}
    ${nav("#/m/staff", "Staff", ["m-staff", "m-person", "m-staffnew"])}
    ${canDocs() ? nav("#/m/library", "SOP library", ["m-library", "m-edit", "m-version"], drafts ? `<span class="count tnum">${drafts} draft${drafts > 1 ? "s" : ""}</span>` : "") : ""}
    ${nav("#/m/reports", "Reports", ["m-reports"])}
    ${canDocs() ? nav("#/m/settings", "Settings", ["m-settings"]) : ""}
    ${canDocs() ? nav("#/m/audit", "Audit log", ["m-audit"]) : ""}
    <hr><a class="nav" href="#/home"><span>My training</span></a></nav>
    <main style="min-width:0">${body}</main></div></div>`;
}

const kpi = (k, v, s) => `<div class="kpi"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`;
const copyBox = () => `<div class="pad stack" style="gap:8px"><span class="muted" style="font-size:.86rem">${esc(S.copyText.note || "Select the text and copy it.")}</span><textarea class="copybox" id="copybox" readonly>${esc(S.copyText.text)}</textarea></div>`;

/* ---------- overview ---------- */
function mOverview(d) {
  const attention = d.attention.slice(0, 8);
  return `<div class="page-head"><div class="t"><span class="eyebrow">${esc(d.orgName)}${d.scopeDept ? " · " + esc(d.scopeDept) : ""}</span><h1>Training overview</h1></div>
    <div class="row"><a class="btn" href="#/m/reports">Reports</a>${canEdit() ? `<a class="btn primary" href="#/m/doc/new">New SOP or policy</a>` : ""}</div></div>
    <div class="stack" style="gap:18px">
    ${d.drafts && canEdit() ? `<div class="banner"><div class="main"><strong>${plural(d.drafts, "draft document")} waiting for review</strong><div class="muted" style="font-size:.9rem">Staff only see documents once you publish them. Check the wording, then publish each one.</div></div><a class="btn" href="#/m/library">Review drafts</a></div>` : ""}
    ${!d.staffCount && canEdit() ? `<div class="banner"><div class="main"><strong>No staff yet</strong><div class="muted" style="font-size:.9rem">Add your team with their position. Each person gets a staff number and PIN to sign in on the training tablet.</div></div><a class="btn primary" href="#/m/staff/new">Add staff member</a></div>` : ""}
    <div class="kpis">${kpi("Staff on the portal", d.staffCount, plural(d.departments.length, "department"))}${kpi("Fully up to date", d.staffCount ? Math.round(d.upToDate / d.staffCount * 100) + "%" : "—", `${d.upToDate} of ${d.staffCount} staff`)}${kpi("Sign-offs outstanding", d.outstanding, `across ${plural(d.peopleBehind, "person", "people")}`)}${kpi("Declarations signed", `${d.declarations}<span class="muted" style="font-size:1.1rem">/${d.staffCount}</span>`, plural(d.publishedCount, "published document"))}</div>
    <div class="two">
      <section class="card pad"><div class="section-title"><h2>By department</h2><span class="muted" style="font-size:.84rem">Required sign-offs completed</span></div>
        ${d.departments.length ? `<div class="bars">${d.departments.map(r => `<a class="bar-row" href="#/m/staff" data-act="dept-staff" data-d="${esc(r.id)}"><span class="bar-name">${esc(r.name)}</span><span class="bar-track"><span class="bar-fill ${r.pct != null && r.pct < 50 ? "low" : ""}" style="width:${r.pct || 0}%;display:block"></span></span><span class="bar-val">${r.pct == null ? "—" : r.pct + "%"} · ${r.staff}</span></a>`).join("")}</div>` : `<p class="muted">Department figures appear once staff are added.</p>`}</section>
      <section class="card"><div class="section-title pad" style="padding-bottom:0"><h2>Needs attention</h2>${d.attention.length ? `<button type="button" class="btn ghost sm" data-act="copy-reminder">Copy WhatsApp reminder</button>` : ""}</div>
        ${attention.length ? `<div class="list" style="margin-top:8px">${attention.map(x => `<a class="li click" href="#/m/staff/${x.id}" style="color:inherit;text-decoration:none"><div class="main"><div class="title">${esc(x.name)}</div><div class="sub">${esc(x.positionName)} · last sign-in ${fmtDate(x.lastLoginAt)}</div></div><div class="chips">${x.outstanding.slice(0, 3).map(o => `<span class="chip ${o.status === "updated" ? "warn" : "plain"} mono">${esc(o.code)}</span>`).join("")}${x.outstanding.length > 3 ? `<span class="chip plain">+${x.outstanding.length - 3}</span>` : ""}</div></a>`).join("")}</div>${d.attention.length > 8 ? `<p class="muted pad" style="padding-top:8px;font-size:.86rem">and ${plural(d.attention.length - 8, "more person", "more people")}. See Staff.</p>` : ""}`
        : `<div class="empty"><p>${d.staffCount ? "Everyone is up to date." : "Nothing to follow up yet."}</p></div>`}
        ${S.copyText && S.copyText.where === "overview" ? copyBox() : ""}</section>
    </div>
    <section class="card"><div class="section-title pad" style="padding-bottom:0"><h2>Latest releases</h2>${canDocs() ? `<a class="btn ghost sm" href="#/m/library">Open library</a>` : ""}</div>
      ${d.latest.length ? `<div class="list" style="margin-top:8px">${d.latest.map(m => `<div class="li"><div class="main"><div class="title">${esc(m.title)}</div><div class="sub"><span class="mono">${esc(m.code)}</span> · v${esc(m.label)} · published ${fmtDate(m.publishedAt)}</div></div><div class="stack" style="min-width:150px;gap:4px"><div class="progress"><span style="width:${m.total ? Math.round(m.done / m.total * 100) : 0}%"></span></div><span class="muted tnum" style="font-size:.82rem">${m.done} of ${m.total} signed</span></div></div>`).join("")}</div>`
      : `<div class="empty"><p>No documents published yet.</p></div>`}</section>
    </div>`;
}
function reminderText(list) {
  const lines = list.map(x => `• ${x.name} (${x.outstanding.length}): ${x.outstanding.map(o => o.code).join(", ")}`);
  return `*${S.org.orgName} training reminder*\nPlease complete your outstanding training on the training tablet:\n\n${lines.join("\n")}\n\nSign in with your staff number and PIN. Read each document, answer the questions and sign. Thank you!`;
}

/* ---------- staff ---------- */
function mStaff(d) {
  const f = S.filt, q = f.q.trim().toLowerCase();
  const rows = d.staff.filter(s => (!q || s.name.toLowerCase().includes(q) || s.staffNo.toLowerCase().includes(q)) && (!f.dept || s.deptId === f.dept))
    .sort((a, b) => (!a.active) - (!b.active) || a.name.localeCompare(b.name));
  const roleChip = s => s.role === "staff" ? "" : ` <span class="chip plain info" style="margin-left:4px">${esc(ROLE_LABEL[s.role])}</span>`;
  return `<div class="page-head"><div class="t"><span class="eyebrow">People</span><h1>Staff</h1></div>${canEdit() ? `<a class="btn primary" href="#/m/staff/new">Add staff member</a>` : ""}</div>
    <div class="toolbar"><label class="sr-only" for="st-q">Search staff</label><input type="search" id="st-q" placeholder="Search name or staff number" data-bind="filt.q" data-live="1" value="${esc(f.q)}">
      ${P.role() === "hod" ? "" : `<label class="sr-only" for="st-dept">Department</label><select id="st-dept" data-bind="filt.dept" data-rerender="1"><option value="">All departments</option>${S.org.departments.map(x => `<option value="${esc(x.id)}" ${f.dept === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`}</div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Position</th><th>Department</th><th>Progress</th><th>Declaration</th><th>Last sign-in</th></tr></thead><tbody>
      ${rows.map(s => `<tr class="click" data-href="#/m/staff/${s.id}"><td><a class="nm" href="#/m/staff/${s.id}" style="color:inherit;text-decoration:none">${esc(s.name)}</a>${roleChip(s)}${s.active ? "" : ' <span class="chip plain" style="margin-left:4px">Left</span>'}<div class="mono muted">${esc(s.staffNo)}</div></td><td>${esc(s.positionName)}</td><td>${esc(s.deptName)}</td>
        <td><div class="row" style="gap:10px;flex-wrap:nowrap"><div class="progress" style="width:90px"><span style="width:${s.pct}%"></span></div><span class="tnum muted" style="font-size:.84rem;white-space:nowrap">${s.done}/${s.total}</span></div>${s.outstanding && s.active ? `<div style="margin-top:4px"><span class="chip ${s.updated ? "warn" : "bad"}">${s.outstanding} outstanding</span></div>` : ""}</td>
        <td>${s.declarationAt ? `<span class="chip ok">${fmtDate(s.declarationAt)}</span>` : '<span class="muted">Not signed</span>'}</td><td class="muted" style="white-space:nowrap">${fmtDate(s.lastLoginAt)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><h3>${d.staff.length ? "No staff match" : "Add your first staff member"}</h3><p>${d.staff.length ? "Change the search or department filter." : "Give each person a staff number and PIN. Their course is built from their position."}</p>${!d.staff.length && canEdit() ? `<a class="btn primary" href="#/m/staff/new">Add staff member</a>` : ""}</div>`}`;
}
function positionOptions(sel) {
  return S.org.departments.map(d => `<optgroup label="${esc(d.name)}">${S.org.positions.filter(p => p.dept === d.id).map(p => `<option value="${esc(p.id)}" ${sel === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
}
function staffFields(e, isNew, ro) {
  const dis = ro ? "disabled" : "";
  return `<div class="grid2"><div class="field"><label for="se-name">Full name</label><input id="se-name" type="text" data-bind="staffEdit.name" value="${esc(e.name)}" ${dis}><span class="hint">Used to check their typed signature.</span></div>
      <div class="field"><label for="se-no">Staff number</label><input id="se-no" type="text" autocapitalize="characters" data-bind="staffEdit.staffNo" value="${esc(e.staffNo)}" ${dis}></div></div>
    <div class="grid2"><div class="field"><label for="se-pos">Position</label><select id="se-pos" data-bind="staffEdit.positionId" ${dis}>${positionOptions(e.positionId)}</select><span class="hint">Their course is built from this position.</span></div>
      <div class="field"><label for="se-start">Start date</label><input id="se-start" type="date" data-bind="staffEdit.startDate" value="${esc(e.startDate || "")}" ${dis}></div></div>
    <div class="grid2"><div class="field"><label for="se-role">Access</label><select id="se-role" data-bind="staffEdit.role" ${dis}>${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${e.role === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <span class="hint">Head of department: sees their own department's progress, read-only. Owner / auditor: reads everything, changes nothing.</span></div>
      ${isNew ? `<div class="field"><label for="se-pin">PIN</label><input id="se-pin" class="pin-input" type="text" inputmode="numeric" maxlength="6" data-bind="staffEdit.pin" value="${esc(e.pin || "")}"><span class="hint">Write this down and give it to them. It isn't shown again.</span></div>` : "<div></div>"}</div>`;
}
function mStaffNew() {
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/staff">← Staff</a><h1>Add staff member</h1></div></div>
    <form data-form="staff-new" class="card pad stack" style="gap:16px;max-width:760px">${staffFields(S.staffEdit, true, false)}<p class="err" id="se-err" role="alert"></p>
    <div class="row"><button type="submit" class="btn primary" ${S.busy ? "disabled" : ""}>Add to the portal</button><a class="btn" href="#/m/staff">Cancel</a></div></form>`;
}
function mPerson(d) {
  const p = d.person, r = d.record, e = S.staffEdit;
  const outstanding = r.items.filter(i => i.status !== "done");
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/staff">← Staff</a><h1>${esc(p.name)}</h1><span class="muted"><span class="mono">${esc(p.staffNo)}</span> · ${esc(posName(p.positionId))} · ${esc(r.staff.deptName)}${p.role !== "staff" ? " · " + esc(ROLE_LABEL[p.role]) : ""}${p.active ? "" : " · Left " + fmtDate(p.leftAt)}</span></div>
    <div class="row">${outstanding.length && p.active ? `<button type="button" class="btn" data-act="copy-person">Copy reminder</button>` : ""}${r.declaration ? `<button type="button" class="btn" data-act="print">Print record</button>` : ""}</div></div>
    <div class="stack" style="gap:18px">
    ${S.copyText && S.copyText.where === "person" ? `<div class="card">${copyBox()}</div>` : ""}
    <div class="kpis">${kpi("Course progress", (r.total ? Math.round(r.done / r.total * 100) : 100) + "%", `${r.done} of ${r.total} signed`)}${kpi("Outstanding", r.outstanding, `${r.items.filter(i => i.status === "updated").length} updated documents`)}${`<div class="kpi"><span class="k">Declaration</span><span class="v" style="font-size:1.3rem;padding-top:6px">${r.declaration ? fmtDate(r.declaration.at) : "Not signed"}</span><span class="s">Last sign-in ${fmtDate(p.lastLoginAt)}${d.logins30d.failed ? ` · ${plural(d.logins30d.failed, "wrong PIN")} in 30 days` : ""}</span></div>`}</div>
    <section><div class="section-title"><h2>Training record</h2></div>
      ${r.total ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Document</th><th>Status</th><th>Quiz</th><th>Signed</th></tr></thead><tbody>${r.items.map(m => `<tr><td><div class="nm">${esc(m.title)}</div><div class="mono muted">${esc(m.code)} · v${esc(m.currentLabel)}</div></td>
        <td>${P.statusChip(m.status)}${m.videoWatched ? `<div class="muted" style="font-size:.8rem;margin-top:4px">▶ Video watched</div>` : ""}${m.videoFailed ? `<div class="vid-fail">▶ Video did not play on their device</div>` : ""}</td>
        <td class="tnum muted">${m.score != null && m.status === "done" ? esc(m.score) + "%" : m.lastScore != null ? esc(m.lastScore) + "%" + (m.status === "done" ? "" : " (not passed)") : "—"}${m.attempts ? ` · ${plural(m.attempts, "attempt")}` : ""}</td>
        <td class="muted" style="white-space:nowrap">${m.signedAt ? fmtDT(m.signedAt) + (m.signedOlderMajor ? ` (v${esc(m.signedLabel)})` : "") : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty"><p>Nothing is assigned to ${esc(posName(p.positionId))} yet.</p></div>`}</section>
    ${r.declaration ? `<section><div class="section-title"><h2>Signed declaration</h2>${r.declarations.length > 1 ? `<span class="muted" style="font-size:.86rem">${plural(r.declarations.length, "declaration")} on record</span>` : ""}</div>${P.certificate(r)}</section>` : ""}
    <section class="no-print"><div class="section-title"><h2>Profile</h2></div><form data-form="staff-edit" class="card pad stack" style="gap:16px">${staffFields(e, false, !canEdit())}<p class="err" id="se-err" role="alert"></p>
      ${canEdit() ? `<div class="row between"><button type="submit" class="btn primary" ${S.busy ? "disabled" : ""}>Save changes</button>
      ${p.active ? `<button type="button" class="btn danger" data-act="staff-active" data-on="0">Mark as left</button>` : `<button type="button" class="btn" data-act="staff-active" data-on="1">Reactivate</button>`}</div>` : ""}</form></section>
    ${canEdit() ? `<section class="no-print"><div class="section-title"><h2>PIN</h2></div><div class="card pad stack" style="gap:12px">
      <p class="muted" style="font-size:.9rem">PIN last set ${fmtDT(p.pinSetAt)}. Resetting it signs them out everywhere and clears any sign-in block.</p>
      ${S.pinReset ? `<form data-form="pin" class="row" style="align-items:flex-end"><div class="field" style="max-width:200px"><label for="pin-new">New PIN</label><input id="pin-new" class="pin-input" type="text" inputmode="numeric" maxlength="6" data-bind="pinReset.pin" value="${esc(S.pinReset.pin)}"></div><button type="submit" class="btn primary">Set PIN</button><button type="button" class="btn" data-act="pin-cancel">Cancel</button></form><span class="hint muted" style="font-size:.84rem">Write it down and give it to them. It isn't shown again.</span>`
      : `<div class="row"><button type="button" class="btn" data-act="pin-new">Reset PIN</button></div>`}</div></section>` : ""}
    <section><div class="section-title"><h2>Sign-off history</h2><span class="muted" style="font-size:.86rem">Every sign-off, including earlier versions</span></div>
      ${d.evidence ? `<div class="${d.evidence.ok ? "notice info" : "notice"}" style="margin-bottom:10px">${d.evidence.ok ? `Record check passed: ${plural(d.evidence.records, "quiz attempt and sign-off record", "quiz attempt and sign-off records")} on file, none changed or removed.` : `Record check failed: ${esc(d.evidence.problem)} Tell the General Manager.`}</div>` : ""}
      ${d.signoffHistory.length ? `<div class="tbl-wrap"><table class="tbl hist"><thead><tr><th>Document</th><th>Version</th><th>Signed</th><th>Score</th><th>Typed name</th><th>Version fingerprint</th></tr></thead><tbody>${d.signoffHistory.map(h => `<tr><td class="mono">${esc(h.code)}</td><td class="tnum">${esc(h.label)}</td><td style="white-space:nowrap">${fmtDT(h.at)}</td><td class="tnum">${h.score != null ? esc(h.score) + "%" : "—"}${h.attempts ? ` · ${plural(h.attempts, "attempt")}` : ""}</td><td>${esc(h.typedName)}</td><td class="hash">${esc(h.versionHash.slice(0, 12))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty"><p>No sign-offs yet.</p></div>`}</section>
    ${d.positionHistory.length ? `<section><div class="section-title"><h2>Position history</h2></div><div class="card"><div class="list">${d.positionHistory.map(h => `<div class="li"><div class="main"><div class="title">${h.from ? `${esc(h.from)} → ${esc(h.to)}` : `Started as ${esc(h.to)}`}</div><div class="sub">${fmtDT(h.at)}${h.by ? " · by " + esc(h.by) : ""}</div></div></div>`).join("")}</div></div></section>` : ""}
    </div>`;
}

/* ---------- library ---------- */
function audienceText(a) {
  if (!a) return "Nobody yet"; if (a.all) return "All staff";
  const ps = a.positions || []; if (!ps.length) return "Nobody yet";
  const parts = [];
  for (const d of S.org.departments) { const inD = S.org.positions.filter(p => p.dept === d.id); const sel = inD.filter(p => ps.includes(p.id)); if (!sel.length) continue; parts.push(sel.length === inD.length ? d.name : sel.map(p => p.name).join(", ")); }
  return parts.join(" · ");
}
function mLibrary(d) {
  const f = S.filt.lib;
  const list = d.documents.filter(m => f === "all" ? m.status !== "archived" : m.status === f);
  const cnt = k => d.documents.filter(m => k === "all" ? m.status !== "archived" : m.status === k).length;
  const tab = (k, label) => `<button type="button" class="btn sm ${f === k ? "primary" : ""}" data-act="lib-filter" data-k="${k}" aria-pressed="${f === k}">${label} <span class="tnum" style="opacity:.75">${cnt(k)}</span></button>`;
  const ready = d.documents.filter(m => m.ready).length, held = d.documents.filter(m => m.status === "draft" && m.hold).length;
  return `<div class="page-head"><div class="t"><span class="eyebrow">Document control</span><h1>SOP library</h1><p class="muted">SOPs, manuals, policies and staff memos. Each one is assigned to positions and signed by staff.</p></div>${canEdit() ? `<div class="row"><a class="btn" href="#/m/doc/new">New document</a></div>` : ""}</div>
    ${ready && canEdit() ? `<div class="banner" style="margin-bottom:14px"><div class="main"><strong>${plural(ready, "draft")} ready to publish</strong><div class="muted" style="font-size:.9rem">Check the questions and correct answers, then publish. Staff see a document only once it is published.${held ? ` ${plural(held, "document")} on hold will stay as draft${held === 1 ? "" : "s"}.` : ""}</div></div><button type="button" class="btn primary" data-act="publish-all" ${S.busy ? "disabled" : ""}>Publish ${ready === 1 ? "it" : "all " + ready}</button></div>` : ""}
    <div class="toolbar">${tab("all", "All")}${tab("published", "Published")}${tab("draft", "Drafts")}${tab("archived", "Archived")}</div>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Document</th><th>Type</th><th>Assigned to</th><th>Status</th><th>Signed</th></tr></thead><tbody>
      ${list.map(m => `<tr class="click" data-href="#/m/doc/${encodeURIComponent(m.code)}"><td><a class="nm" href="#/m/doc/${encodeURIComponent(m.code)}" style="color:inherit;text-decoration:none">${esc(m.title)}</a><div class="mono muted">${esc(m.code)} · v${esc(m.label)} · ${plural(m.questionCount, "question")}${m.videoCount ? ` · ▶ ${plural(m.videoCount, "video")}` : ""}</div></td><td>${esc(KINDS[m.kind])}</td><td style="max-width:260px">${esc(audienceText(m.audience))}</td>
        <td><div class="chips">${m.status === "published" ? '<span class="chip ok">Published</span>' : m.status === "draft" ? '<span class="chip warn">Draft</span>' : '<span class="chip">Archived</span>'}${m.status === "draft" && m.hold ? `<span class="chip plain khaki" title="${esc(m.hold)}">On hold</span>` : ""}${m.draftDirty ? '<span class="chip plain tag-dirty">Unpublished changes</span>' : ""}</div></td>
        <td>${m.stats ? `<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="progress" style="width:70px"><span style="width:${m.stats.total ? Math.round(m.stats.done / m.stats.total * 100) : 0}%"></span></div><span class="tnum muted" style="font-size:.84rem">${m.stats.done}/${m.stats.total}</span></div>` : '<span class="muted">—</span>'}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><h3>No documents here</h3><p>Create an SOP, training manual or policy, assign it to positions and publish it.</p>${canEdit() ? `<a class="btn primary" href="#/m/doc/new">New document</a>` : ""}</div>`}`;
}

/* ---------- editor ---------- */
function setEdit(det) { S.edit = Object.assign(P.clone(det), { change: "minor", localDirty: false, uploading: null }); }
function mEdit(d) {
  if (S.params.id === "new") return mNewDoc();
  const e = S.edit; if (!e) return "";
  const dr = e.draft, a = dr.audience, ro = !canEdit();
  const pub = e.status === "published", arch = e.status === "archived", never = !e.current;
  const counts = d.lib.activeByPosition || {};
  const people = a.all ? Object.values(counts).reduce((n, x) => n + x, 0) : (a.positions || []).reduce((n, p) => n + (counts[p] || 0), 0);
  const cur = e.current;
  const nextMinor = cur ? `${cur.major}.${cur.minor + 1}` : "", nextMajor = cur ? `${cur.major + 1}.0` : "";
  const startLabel = dr.startVersion ? `${dr.startVersion.major}.${dr.startVersion.minor || 0}` : "1.0";
  const aud = `<label class="check"><input type="checkbox" id="aud-all" data-bind="edit.draft.audience.all" data-rerender="1" ${a.all ? "checked" : ""}><span><strong>All staff</strong></span></label>
    ${a.all ? "" : S.org.departments.map(dp => { const ps = S.org.positions.filter(p => p.dept === dp.id); if (!ps.length) return ""; const allIn = ps.every(p => a.positions.includes(p.id));
      return `<div class="aud-dept"><div class="dh"><span>${esc(dp.name)}</span>${ro ? "" : `<button type="button" class="btn ghost sm" data-act="aud-dept" data-d="${esc(dp.id)}">${allIn ? "Clear" : "Select all"}</button>`}</div>${ps.map(p => `<label class="check"><input type="checkbox" id="aud-${esc(p.id)}" data-change="aud-pos" data-p="${esc(p.id)}" ${a.positions.includes(p.id) ? "checked" : ""}><span>${esc(p.name)}</span></label>`).join("")}</div>`; }).join("")}`;
  const qs = dr.questions.map((q, i) => `<div class="qe"><div class="row between"><span class="lbl">Question ${i + 1}</span>${ro ? "" : `<button type="button" class="btn ghost sm" data-act="q-del" data-i="${i}">Remove</button>`}</div>
    <label class="sr-only" for="q-${i}">Question ${i + 1}</label><input type="text" id="q-${i}" data-bind="edit.draft.questions.${i}.q" value="${esc(q.q)}" placeholder="Question">
    ${q.options.map((o, j) => `<div class="opt-row"><input type="radio" name="qc-${i}" id="qc-${i}-${j}" title="Correct answer" aria-label="Mark option ${j + 1} correct" data-change="q-correct" data-i="${i}" data-j="${j}" ${q.correct === j ? "checked" : ""}><input type="text" id="qo-${i}-${j}" aria-label="Option ${j + 1}" data-bind="edit.draft.questions.${i}.options.${j}" value="${esc(o)}" placeholder="Option ${j + 1}">${ro ? "" : `<button type="button" class="btn ghost sm" data-act="opt-del" data-i="${i}" data-j="${j}" ${q.options.length <= 2 ? "disabled" : ""} aria-label="Remove option">✕</button>`}</div>`).join("")}
    <div class="row between"><span class="hint muted" style="font-size:.8rem">Tick the correct answer.</span>${q.options.length < 5 && !ro ? `<button type="button" class="btn ghost sm" data-act="opt-add" data-i="${i}">Add option</button>` : ""}</div></div>`).join("");
  const file = id => e.files[id] || {};
  const up = e.uploading;
  const status = pub ? `Published · version ${esc(cur.label)} · published ${fmtDate(cur.publishedAt)}` : arch ? `Archived · hidden from staff${cur ? ` · last version ${esc(cur.label)}` : ""}` : `Draft · version ${esc(startLabel)} when published · staff can't see it yet`;
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/library">← SOP library</a><h1>${esc(dr.title || "Untitled")}</h1><span class="muted">${status}</span></div></div>
    ${e.hold && e.status === "draft" ? `<div class="banner" style="margin-bottom:16px"><div class="main"><strong>On hold</strong><div class="muted" style="font-size:.9rem">${esc(e.hold)}. It is left out of "Publish all". Publishing it here removes the hold.</div></div>${ro ? "" : `<button type="button" class="btn sm" data-act="ed-release-hold">Remove hold</button>`}</div>` : ""}
    ${e.draftDirty && !e.localDirty ? `<div class="banner" style="margin-bottom:16px"><div class="main"><strong>Saved changes not yet published</strong><div class="muted" style="font-size:.9rem">Staff still see version ${esc(cur.label)}. Publish the changes, or discard them.</div></div>${ro ? "" : `<button type="button" class="btn sm" data-act="ed-discard">Discard changes</button>`}</div>` : ""}
    ${e.localDirty ? `<div class="notice" style="margin-bottom:16px">You have unsaved changes.</div>` : ""}
    <form data-form="doc" class="editor"><fieldset ${ro ? "disabled" : ""} style="border:0;padding:0;margin:0;min-width:0;display:contents">
      <div class="stack" style="gap:16px;min-width:0">
        <section class="card pad stack" style="gap:14px">
          <div class="grid2"><div class="field"><label for="ed-code">Document code</label><input id="ed-code" type="text" data-bind="edit.code" value="${esc(e.code)}" ${never ? "" : "disabled"}>${never ? "" : `<span class="hint">Fixed once published, because signed records use it.</span>`}</div>
          <div class="field"><label for="ed-kind">Type</label><select id="ed-kind" data-bind="edit.kind" ${never ? "" : "disabled"}>${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${e.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
          <div class="field"><label for="ed-title">Title</label><input id="ed-title" type="text" data-bind="edit.draft.title" value="${esc(dr.title)}" placeholder="e.g. Guest welcome and the 30-second rule"></div>
          <div class="field"><label for="ed-sum">Summary</label><textarea id="ed-sum" rows="2" data-bind="edit.draft.summary" placeholder="One or two sentences on why this matters">${esc(dr.summary)}</textarea></div>
          <div class="field"><label for="ed-body">Content</label><textarea id="ed-body" rows="16" data-bind="edit.draft.body" placeholder="Write the procedure here">${esc(dr.body)}</textarea><span class="hint">Start a line with ## for a heading, - for a bullet, 1. for a numbered step, &gt; for a highlighted note. Wrap words in **double stars** for bold.</span></div>
          <div class="field"><span class="lbl">Training video (optional)</span>
            ${dr.videos.map((vd, i) => `<div class="attach"><span class="chip plain info">Video</span><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(vd.title || file(vd.fileId).name || "Training video")} · ${esc(fmtDur(file(vd.fileId).duration))}${file(vd.fileId).size ? " · " + esc(fmtSize(file(vd.fileId).size)) : ""}</span><a class="btn sm" href="/api/files/${esc(vd.fileId)}" target="_blank" rel="noopener">Play</a>${ro ? "" : `<button type="button" class="btn sm danger" data-act="video-remove" data-i="${i}">Remove</button>`}</div>
              <label class="sr-only" for="vt-${i}">Video title</label><input type="text" id="vt-${i}" data-bind="edit.draft.videos.${i}.title" value="${esc(vd.title || "")}" placeholder="Video title shown to staff">`).join("")}
            ${ro ? "" : up && up.kind === "video" ? `<div class="upload-row"><span>Uploading ${esc(up.name)}…</span><progress max="1" value="${up.pct || 0}"></progress></div>` : `<input type="file" id="ed-video" accept="video/mp4,.mp4,.m4v,.mov" data-change="video-upload"><span class="hint">MP4 (H.264). Compress long videos for mobile data; under 50 MB is best.</span>`}
            ${dr.videos.length ? `<label class="check" style="margin-top:4px"><input type="checkbox" id="ed-reqvid" data-bind="edit.draft.requireVideo" ${dr.requireVideo !== false ? "checked" : ""}><span>Staff must watch the whole video before they continue</span></label>` : ""}</div>
          <div class="field"><span class="lbl">Original PDF (optional)</span>
            ${dr.pdfFileId ? `<div class="attach"><span class="chip plain khaki">PDF</span><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(file(dr.pdfFileId).name || "Document")}${file(dr.pdfFileId).size ? " · " + esc(fmtSize(file(dr.pdfFileId).size)) : ""}</span><a class="btn sm" href="/api/files/${esc(dr.pdfFileId)}" target="_blank" rel="noopener">Open</a>${ro ? "" : `<button type="button" class="btn sm danger" data-act="pdf-remove">Remove</button>`}</div>`
            : ro ? `<span class="muted">None</span>` : up && up.kind === "pdf" ? `<div class="upload-row"><span>Uploading ${esc(up.name)}…</span><progress max="1" value="${up.pct || 0}"></progress></div>` : `<input type="file" id="ed-pdf" accept="application/pdf,.pdf" data-change="pdf-upload"><span class="hint">Staff open it from the Read step. Up to 25 MB.</span>`}</div>
        </section>
        <section class="card pad stack" style="gap:14px"><div class="row between"><div><h2>Questions</h2><p class="muted" style="font-size:.9rem">A short check after reading. Leave empty to skip the quiz.</p></div>
          <div class="field" style="width:140px"><label for="ed-pass">Pass mark</label><select id="ed-pass" data-bind="edit.draft.passMark" data-num="1">${[60, 70, 80, 90, 100].map(n => `<option value="${n}" ${Number(dr.passMark) === n ? "selected" : ""}>${n}%</option>`).join("")}</select></div></div>
          ${qs}
          ${ro ? "" : `<div class="row"><button type="button" class="btn" data-act="q-add">Add question</button>${S.features.aiQuestions ? `<button type="button" class="btn" data-act="ed-ai" ${S.aiBusy ? "disabled" : ""}>${S.aiBusy ? "Drafting questions…" : "Draft 5 questions from the content"}</button>` : ""}</div>
          ${S.features.aiQuestions ? `<p class="muted" style="font-size:.82rem">Drafted questions are added below the others. Check each answer before publishing.</p>` : ""}`}
        </section>
      </div>
      <aside class="side-panel">
        <section class="card pad stack" style="gap:12px"><h3>Who must complete it</h3>${aud}<p class="muted tnum" style="font-size:.86rem">${plural(people, "active staff member")} will get this.</p></section>
        <section class="card pad stack" style="gap:12px"><h3>Document details</h3><div class="field"><label for="ed-issue">Issue date</label><input id="ed-issue" type="text" data-bind="edit.draft.issueDate" value="${esc(dr.issueDate || "")}" placeholder="e.g. 10 June 2026"><span class="hint">As printed on the document.</span></div><div class="field"><label for="ed-applies">Applies to (wording)</label><input id="ed-applies" type="text" data-bind="edit.draft.appliesText" value="${esc(dr.appliesText || "")}" placeholder="e.g. All FOH staff"><span class="hint">Shown to staff. Who must sign is set above.</span></div></section>
        <section class="card pad stack" style="gap:12px"><div class="grid2" style="grid-template-columns:1fr 1fr"><div class="field"><label for="ed-min">Minutes</label><input id="ed-min" type="number" min="1" max="600" data-bind="edit.draft.estMinutes" data-num="1" value="${esc(dr.estMinutes)}"></div><div class="field"><label for="ed-ord">Course order</label><input id="ed-ord" type="number" data-bind="edit.draft.order" data-num="1" value="${esc(dr.order)}"></div></div><span class="hint muted" style="font-size:.8rem">Lower numbers come first in the course.</span></section>
        ${ro ? "" : `<section class="card pad stack" style="gap:12px">
          ${pub || (arch && cur) ? `<span class="lbl">How big is this change?</span>
            <label class="check"><input type="radio" name="chg" data-change="chg" data-v="minor" ${e.change === "minor" ? "checked" : ""}><span>Minor change (v${esc(nextMinor)})<br><span class="muted" style="font-size:.84rem">Wording or formatting. Signatures stay valid.</span></span></label>
            <label class="check"><input type="radio" name="chg" data-change="chg" data-v="major" ${e.change === "major" ? "checked" : ""}><span>New version (v${esc(nextMajor)})<br><span class="muted" style="font-size:.84rem">Staff must read and sign it again.</span></span></label>
            <button type="button" class="btn primary block" data-act="ed-publish" ${S.busy ? "disabled" : ""}>${arch && !e.draftDirty && !e.localDirty ? `Restore version ${esc(cur.label)}` : e.change === "major" ? `Publish version ${esc(nextMajor)}` : `Publish version ${esc(nextMinor)}`}</button>
            <button type="button" class="btn block" data-act="ed-save" ${S.busy ? "disabled" : ""}>Save without publishing</button>`
          : `<button type="button" class="btn primary block" data-act="ed-publish" ${S.busy ? "disabled" : ""}>Publish to staff</button><button type="button" class="btn block" data-act="ed-save" ${S.busy ? "disabled" : ""}>Save draft</button>`}
          ${e.problems.length && !e.localDirty && !pub ? `<p class="hint muted" style="font-size:.84rem">Before publishing: ${esc(e.problems[0])}</p>` : ""}
          <p class="err" id="ed-err" role="alert"></p>
          <button type="button" class="btn sm" data-act="ed-preview" title="Shows the last saved version">Preview as staff</button>
          ${e.status === "draft" && !e.hold ? `<button type="button" class="btn sm" data-act="ed-hold">Put on hold</button>` : ""}
          ${pub ? `<button type="button" class="btn sm danger" data-act="ed-archive">Archive</button>` : ""}
          ${never ? `<button type="button" class="btn sm danger" data-act="ed-delete">Delete draft</button>` : ""}
        </section>`}
        ${e.versions.length ? `<section class="card pad stack" style="gap:10px"><h3>Published versions</h3><p class="muted" style="font-size:.84rem">Each version is frozen exactly as staff saw it.</p>
          <div class="list">${e.versions.map(v => `<a class="li click" style="padding:8px 0;color:inherit;text-decoration:none" href="#/m/version/${encodeURIComponent(e.code)}/${v.id}"><div class="main"><div class="title tnum">Version ${esc(v.label)}</div><div class="sub">${fmtDate(v.publishedAt)}${v.by ? " · " + esc(v.by) : ""}</div></div></a>`).join("")}</div></section>` : ""}
      </aside>
    </fieldset></form>`;
}
function mNewDoc() {
  const n = S.newDoc || (S.newDoc = { kind: "sop", code: "" });
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/library">← SOP library</a><h1>New document</h1><span class="muted">It starts as a draft. Staff see it once you publish it.</span></div></div>
    <form data-form="newdoc" class="card pad stack" style="gap:16px;max-width:560px">
      <div class="field"><label for="nd-kind">Type</label><select id="nd-kind" data-change="nd-kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${n.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label for="nd-code">Document code</label><input id="nd-code" type="text" data-bind="newDoc.code" value="${esc(n.code)}" placeholder="PEL-SOP-013"><span class="hint">The next free number from the Document Register is filled in.</span></div>
      <p class="err" id="nd-err" role="alert"></p>
      <div class="row"><button type="submit" class="btn primary" ${S.busy ? "disabled" : ""}>Create draft</button><a class="btn" href="#/m/library">Cancel</a></div></form>`;
}
function mVersion(v) {
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/doc/${encodeURIComponent(v.code)}">← ${esc(v.code)}</a><h1>${esc(v.title)}</h1><span class="muted">Version ${esc(v.label)} as published on ${fmtDT(v.publishedAt)}${v.publishedBy ? " by " + esc(v.publishedBy) : ""} · ${plural(v.signoffs, "sign-off")} against this version</span></div><button type="button" class="btn" data-act="print">Print</button></div>
    <div class="stack" style="gap:18px">
    <section class="card pad stack" style="gap:10px"><h3>Record of this version</h3><dl class="kv"><dt>Code</dt><dd class="mono">${esc(v.code)}</dd><dt>Version</dt><dd>${esc(v.label)}</dd><dt>Issue date</dt><dd>${esc(v.issueDate || "—")}</dd><dt>Applies to</dt><dd>${esc(v.appliesText || audienceText(v.audience))}</dd><dt>Who must sign</dt><dd>${esc(audienceText(v.audience))}</dd><dt>Pass mark</dt><dd>${esc(v.passMark)}%</dd><dt>PDF</dt><dd>${v.pdf ? `<a href="/api/files/${esc(v.pdf.id)}" target="_blank" rel="noopener">${esc(v.pdf.name)}</a>` : "None"}</dd><dt>Videos</dt><dd>${v.videos.length ? v.videos.map(x => `<a href="/api/files/${esc(x.fileId)}" target="_blank" rel="noopener">${esc(x.title)}</a> (${esc(fmtDur(x.duration))})`).join(", ") : "None"}</dd><dt>Fingerprint</dt><dd class="hash">${esc(v.contentHash)}</dd></dl>
      <p class="muted" style="font-size:.84rem">The fingerprint (SHA-256) is calculated from the text, questions, answers and the exact files. Each sign-off stores the fingerprint of the version signed, so it can be shown that nothing changed afterwards.</p></section>
    ${v.summary ? `<p class="summary">${esc(v.summary)}</p>` : ""}
    <section class="card pad"><div class="doc">${md(v.body)}</div></section>
    ${v.questions.length ? `<section class="card pad stack" style="gap:14px"><h2>Questions and answers</h2>${v.questions.map((q, i) => `<div class="qe"><div class="lbl">Q${i + 1}. ${esc(q.q)}</div><ol style="margin:0;padding-left:1.4em">${q.options.map((o, j) => `<li${j === q.correct ? ' style="font-weight:700;color:var(--ok)"' : ""}>${esc(o)}${j === q.correct ? " ✓ correct" : ""}</li>`).join("")}</ol></div>`).join("")}</section>` : ""}
    </div>`;
}

/* ---------- reports ---------- */
function mReports(d) {
  const dots = { done: "done", updated: "updated", inprogress: "inprogress", todo: "todo", na: "na" };
  const words = { done: "Signed", updated: "Updated, sign again", inprogress: "In progress", todo: "Not started", na: "Not required" };
  return `<div class="page-head"><div class="t"><span class="eyebrow">Compliance</span><h1>Reports</h1><p class="muted">Use these figures for the monthly HR report.</p></div>
    <div class="row"><a class="btn primary" href="/api/admin/reports/register.csv" download>Download register (CSV)</a></div></div>
    <div class="stack" style="gap:20px">
    <section><div class="section-title"><h2>Department summary</h2><span class="muted" style="font-size:.86rem">As at ${fmtDate(d.asAt)}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Department</th><th>Staff</th><th>Sign-offs done</th><th>Completion</th><th>Fully up to date</th><th>Declarations</th></tr></thead><tbody>
      ${d.departments.map(r => `<tr><td class="nm">${esc(r.name)}</td><td class="tnum">${r.staff}</td><td class="tnum">${r.done} / ${r.required}</td><td class="tnum">${r.pct == null ? "—" : r.pct + "%"}</td><td class="tnum">${r.upToDate} / ${r.staff}</td><td class="tnum">${r.declarations} / ${r.staff}</td></tr>`).join("")}
      ${d.departments.length ? `<tr><td class="nm">All departments</td><td class="tnum nm">${d.total.staff}</td><td class="tnum nm">${d.total.done} / ${d.total.required}</td><td class="tnum nm">${d.total.pct == null ? "—" : d.total.pct + "%"}</td><td class="tnum nm">${d.total.upToDate} / ${d.total.staff}</td><td class="tnum nm">${d.total.declarations} / ${d.total.staff}</td></tr>` : `<tr><td colspan="6" class="muted">No staff yet.</td></tr>`}
    </tbody></table></div></section>
    <section><div class="section-title"><h2>Training matrix</h2>${d.scopeDept ? "" : `<label class="sr-only" for="rp-dept">Department</label><select id="rp-dept" data-bind="filt.rdept" data-reload="1" style="width:auto"><option value="">All departments</option>${S.org.departments.map(x => `<option value="${esc(x.id)}" ${S.filt.rdept === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`}</div>
      <div class="legend" style="margin-bottom:10px"><span><i class="dot done"></i>Signed</span><span><i class="dot updated"></i>Updated, sign again</span><span><i class="dot inprogress"></i>In progress</span><span><i class="dot todo"></i>Not started</span><span><i class="dot na"></i>Not required</span></div>
      ${d.matrix.length && d.documents.length ? `<div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>Staff member</th>${d.documents.map(m => `<th class="mod" title="${esc(m.title)}">${esc(m.code)}</th>`).join("")}<th>Done</th></tr></thead><tbody>
        ${d.matrix.map(r => `<tr class="click" data-href="#/m/staff/${r.id}"><td style="white-space:nowrap"><div class="nm">${esc(r.name)}</div><div class="muted" style="font-size:.8rem">${esc(r.positionName)}</div></td>${r.cells.map((c, i) => `<td class="cell"><i class="dot ${dots[c]}" title="${esc(d.documents[i].code)}: ${words[c]}"></i><span class="sr-only">${words[c]}</span></td>`).join("")}<td class="tnum">${r.done}/${r.total}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty"><p>The matrix fills in once you have staff and published documents.</p></div>`}</section>
    </div>`;
}

/* ---------- settings ---------- */
function mSettings(d) {
  const c = S.cfgEdit, ro = !canEdit(); if (!c) return "";
  const used = new Set(d.usedPositions);
  return `<div class="page-head"><div class="t"><span class="eyebrow">Portal</span><h1>Settings</h1></div></div>
    <div class="stack" style="gap:18px">
    <section class="card pad stack" style="gap:12px"><h2>Preview a position's course</h2><p class="muted">See exactly what a staff member in that position gets, drafts included. Nothing is saved.</p>
      <div class="row"><label class="sr-only" for="pv-pos">Position</label><select id="pv-pos" style="width:auto;min-width:220px">${positionOptions("waitron")}</select><button type="button" class="btn primary" data-act="start-preview">Start preview</button></div></section>
    <form data-form="config" class="stack" style="gap:18px"><fieldset ${ro ? "disabled" : ""} style="border:0;padding:0;margin:0;min-width:0" class="stack">
    <section class="card pad stack" style="gap:14px"><h2>Course and declaration</h2>
      <div class="grid2"><div class="field"><label for="cf-org">Business name</label><input id="cf-org" type="text" data-bind="cfgEdit.orgName" value="${esc(c.orgName)}"></div><div class="field"><label for="cf-course">Course name</label><input id="cf-course" type="text" data-bind="cfgEdit.courseTitle" value="${esc(c.courseTitle)}"></div></div>
      <div class="field"><label for="cf-decl">Declaration text</label><textarea id="cf-decl" rows="6" data-bind="cfgEdit.declarationText">${esc(c.declarationText)}</textarea><span class="hint">{name} and {position} are filled in for each person. Declarations already signed keep the wording they were signed with.</span></div></section>
    <section class="card pad stack" style="gap:14px"><div class="row between"><div><h2>Departments and positions</h2><p class="muted" style="font-size:.9rem">Positions decide which documents each person gets.</p></div>${ro ? "" : `<button type="button" class="btn sm" data-act="dept-add">Add department</button>`}</div>
      <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      ${c.departments.map((dp, di) => `<div class="qe"><div class="field"><label for="cd-${di}">Department</label><input id="cd-${di}" type="text" data-bind="cfgEdit.departments.${di}.name" value="${esc(dp.name)}"></div>
        <span class="lbl">Positions</span>${c.positions.map((p, pi) => p.dept !== dp.id ? "" : `<div class="pos-edit"><input type="text" id="cp-${pi}" data-bind="cfgEdit.positions.${pi}.name" value="${esc(p.name)}" aria-label="Position name">${ro ? "" : `<button type="button" class="btn ghost sm" data-act="pos-del" data-i="${pi}" ${used.has(p.id) ? 'disabled title="Staff hold this position"' : ""} aria-label="Remove position">✕</button>`}</div>`).join("")}
        ${ro ? "" : `<div class="row between"><button type="button" class="btn ghost sm" data-act="pos-add" data-d="${esc(dp.id)}">Add position</button>${c.positions.some(p => p.dept === dp.id) ? "" : `<button type="button" class="btn ghost sm" data-act="dept-del" data-i="${di}">Remove department</button>`}</div>`}</div>`).join("")}
      </div></section>
    ${ro ? "" : `<div class="row"><button type="submit" class="btn primary" ${S.busy ? "disabled" : ""}>Save settings</button><button type="button" class="btn" data-act="cfg-reset">Discard changes</button></div>`}
    </fieldset></form>
    <section class="card pad stack" style="gap:10px"><h2>How staff sign in</h2>
      <p>Staff sign in with their staff number and a 4 to 6 digit PIN, on the training tablet or their own phone. After 5 wrong PINs sign-in pauses for a minute, after 10 for 15 minutes, and after 15 it stays blocked until a manager resets the PIN.</p>
      <p class="muted" style="font-size:.9rem">Staff are signed out after 10 minutes without activity. Managers after 30 minutes.</p></section>
    </div>`;
}

/* ---------- audit log ---------- */
const ACTIONS = {
  "document.publish": "Published", "document.archive": "Archived", "document.restore": "Restored", "document.save_draft": "Saved draft",
  "document.create": "Created document", "document.delete_draft": "Deleted draft", "document.hold": "Put on hold", "document.release_hold": "Removed hold",
  "document.discard_changes": "Discarded changes", "document.import": "Imported", "document.ai_questions": "Drafted questions with AI",
  "staff.create": "Added staff member", "staff.update": "Changed staff details", "staff.pin_reset": "Reset PIN", "staff.deactivate": "Marked as left",
  "staff.reactivate": "Reactivated", "staff.manager_create_cli": "Created manager (server)", "staff.manager_reset_cli": "Reset manager (server)",
  "settings.update": "Changed settings", "report.export_csv": "Downloaded register", "file.upload": "Uploaded file",
};
function auditDetail(e) {
  const d = e.details || {};
  if (e.action === "document.publish") return `version ${d.version}${d.change === "major" ? " (new version, everyone signs again)" : d.change === "minor" ? " (minor change)" : ""}`;
  if (e.action === "staff.update") return Object.entries(d).map(([k, v]) => `${k}: ${v.from ?? "—"} → ${v.to ?? "—"}`).join("; ");
  if (e.action === "document.hold") return d.reason || "";
  if (e.action === "file.upload") return d.name || "";
  if (e.action === "report.export_csv") return plural(d.rows || 0, "row");
  if (e.action === "settings.update") return d.declarationChanged ? "declaration wording changed" : "";
  return "";
}
function mAudit(d) {
  return `<div class="page-head"><div class="t"><span class="eyebrow">Evidence</span><h1>Audit log</h1><p class="muted">Every change managers make, newest first. Entries can't be edited or deleted.</p></div></div>
    ${d.entries.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Details</th></tr></thead><tbody>
    ${d.entries.map(e => `<tr class="audit-row"><td class="when">${fmtDT(e.at)}</td><td>${esc(e.actor || "System")}</td><td>${esc(ACTIONS[e.action] || e.action)}</td><td class="mono">${esc(e.entity === "staff" ? "Staff #" + e.entity_id : e.entity_id || "")}</td><td class="muted" style="font-size:.86rem">${esc(auditDetail(e))}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><p>Nothing recorded yet.</p></div>`}`;
}

window.PelMgr = { vMgr, setEdit, reminderText };
})();
