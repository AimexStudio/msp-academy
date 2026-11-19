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
    "m-edit": mEdit, "m-version": mVersion, "m-course": mCourse, "m-reviews": mReviews, "m-reports": mReports, "m-settings": mSettings, "m-audit": mAudit }[v] || (() => ""))(S.data[v]);
  return `<div class="gutter"><div class="mgr"><nav class="rail" aria-label="Manager"><span class="eyebrow">${esc(P.isAuthor() ? "MSP Academy author" : P.isSupport() ? P.SUPPORT_LABEL : ROLE_LABEL[P.role()])}</span>
    ${nav("#/m/overview", "Overview", ["m-overview"])}
    ${nav("#/m/staff", "Staff", ["m-staff", "m-person", "m-staffnew"])}
    ${canDocs() ? nav("#/m/library", "SOP library", ["m-library", "m-edit", "m-version", "m-course"], drafts ? `<span class="count tnum">${drafts} draft${drafts > 1 ? "s" : ""}</span>` : "") : ""}
    ${nav("#/m/reports", "Reports", ["m-reports"])}
    ${canDocs() ? nav("#/m/settings", "Settings", ["m-settings"]) : ""}
    ${nav("#/m/reviews", "Reviews", ["m-reviews"])}
    ${canDocs() ? nav("#/m/audit", "Audit log", ["m-audit"]) : ""}
    ${P.isSupport() || P.isAuthor() ? "" : `<hr><a class="nav" href="#/home"><span>My training</span></a>`}</nav>
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
    ${d.evidencePending ? `<div class="banner"><div class="main"><strong>${plural(d.evidencePending, "evidence submission")} waiting for review</strong><div class="muted" style="font-size:.9rem">Staff submitted proof in a course. Approve it to complete that lesson.</div></div><a class="btn" href="#/m/reviews">Review</a></div>` : ""}
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
    ${coursesCard(d.courses || [])}
    <div class="toolbar">${tab("all", "All")}${tab("published", "Published")}${tab("draft", "Drafts")}${tab("archived", "Archived")}</div>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Document</th><th>Type</th><th>Assigned to</th><th>Status</th><th>Signed</th></tr></thead><tbody>
      ${list.map(m => `<tr class="click" data-href="#/m/doc/${encodeURIComponent(m.code)}"><td><a class="nm" href="#/m/doc/${encodeURIComponent(m.code)}" style="color:inherit;text-decoration:none">${esc(m.title)}</a><div class="mono muted">${esc(m.code)} · v${esc(m.label)} · ${plural(m.questionCount, "question")}${m.videoCount ? ` · ▶ ${plural(m.videoCount, "video")}` : ""}</div></td><td>${esc(KINDS[m.kind])}</td><td style="max-width:260px">${esc(audienceText(m.audience))}</td>
        <td><div class="chips">${m.status === "published" ? '<span class="chip ok">Published</span>' : m.status === "draft" ? '<span class="chip warn">Draft</span>' : '<span class="chip">Archived</span>'}${m.status === "draft" && m.hold ? `<span class="chip plain khaki" title="${esc(m.hold)}">On hold</span>` : ""}${m.draftDirty ? '<span class="chip plain tag-dirty">Unpublished changes</span>' : ""}${m.shared ? `<span class="chip plain info" title="Content provided by ${esc(m.shared.provider)}">${esc(m.shared.provider)}</span>` : ""}</div></td>
        <td>${m.stats ? `<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="progress" style="width:70px"><span style="width:${m.stats.total ? Math.round(m.stats.done / m.stats.total * 100) : 0}%"></span></div><span class="tnum muted" style="font-size:.84rem">${m.stats.done}/${m.stats.total}</span></div>` : '<span class="muted">—</span>'}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><h3>No documents here</h3><p>Create an SOP, training manual or policy, assign it to positions and publish it.</p>${canEdit() ? `<a class="btn primary" href="#/m/doc/new">New document</a>` : ""}</div>`}`;
}

/* ---------- courses: built from modules and lessons ---------- */
const LESSON_TYPES = { text: "Text", video: "Video", pdf: "PDF", checklist: "Checklist", quiz: "Quiz", signoff: "Policy sign-off", evidence: "Field evidence", document: "SOP or policy" };
const LESSON_ICON = { text: "¶", video: "▶", pdf: "⎙", checklist: "☑", quiz: "?", signoff: "✍", evidence: "📷", document: "✎" };
const LESSON_HINT = { text: "Something to read", video: "An uploaded video, with watch rules", pdf: "A PDF to open and read", checklist: "Steps to tick off",
  quiz: "Questions with a pass mark", signoff: "Agree to a statement and sign", evidence: "Proof for a manager to approve", document: "One of your SOPs or policies" };
function courseChip(c) {
  if (c.status === "archived") return '<span class="chip">Archived</span>';
  if (c.status === "published") return `<span class="chip ok">Published v${esc(c.label)}</span>${c.draftDirty ? ' <span class="chip plain tag-dirty">Unpublished changes</span>' : ""}`;
  return '<span class="chip warn">Draft</span>';
}
function coursesCard(list) {
  const T = P.term;
  return `<section class="card pad stack" style="gap:12px;margin-bottom:18px"><div class="row between"><div><h2>${esc(T("courses"))}</h2><p class="muted" style="font-size:.9rem">Build ${esc(T("courses").toLowerCase())} from ${esc(T("modules").toLowerCase())} and lessons: text, video, PDF, quizzes, and your SOPs and policies. Finishing one gives the person a certificate.</p></div>${canEdit() ? `<a class="btn sm primary" href="#/m/course/new">New ${esc(T("course").toLowerCase())}</a>` : ""}</div>
    ${list.length ? `<div class="list">${list.map(c => `<a class="li click" href="#/m/course/${encodeURIComponent(c.id)}" style="color:inherit;text-decoration:none"><div class="main"><div class="title">${esc(c.title)}</div><div class="sub">${plural(c.moduleCount, T("module").toLowerCase())} · ${plural(c.lessonCount, "lesson")}${c.stats ? ` · ${c.stats.completed} of ${c.stats.total} completed` : ""}</div></div><div class="chips">${courseChip(c)}${c.shared ? `<span class="chip plain info">${esc(c.shared.provider)}</span>` : ""}</div></a>`).join("")}</div>`
      : `<p class="muted">No ${esc(T("courses").toLowerCase())} yet.</p>`}</section>`;
}
function mCourseNew() {
  const e = S.courseEdit, T = P.term;
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/library">← SOP library</a><h1>New ${esc(T("course").toLowerCase())}</h1><p class="muted">Give it a title. You'll add ${esc(T("modules").toLowerCase())} and lessons next.</p></div></div>
    <form data-form="course-new" class="card pad stack" style="gap:14px;max-width:640px">
      <div class="field"><label for="cn-title">Title</label><input id="cn-title" type="text" data-bind="courseEdit.title" value="${esc(e.title)}" placeholder="e.g. Guest Service Basics"></div>
      <div class="field"><label for="cn-desc">Description (optional)</label><textarea id="cn-desc" rows="2" data-bind="courseEdit.description">${esc(e.description)}</textarea></div>
      <p class="err" id="course-err" role="alert"></p>
      <div class="row"><button type="submit" class="btn primary">Create ${esc(T("course").toLowerCase())}</button><a class="btn" href="#/m/library">Cancel</a></div></form>`;
}
function lessonEditor(l, i, j, d) {
  const e = S.courseEdit, p = `courseEdit.draft.modules.${i}.lessons.${j}`;
  const title = `<div class="field"><label for="le-t-${i}-${j}">Lesson title</label><input id="le-t-${i}-${j}" type="text" data-bind="${p}.title" data-live="1" value="${esc(l.title)}"></div>`;
  if (l.type === "text") return `${title}<div class="field"><label for="le-b-${i}-${j}">Text</label><textarea id="le-b-${i}-${j}" rows="10" data-bind="${p}.body">${esc(l.body || "")}</textarea><span class="hint">## for a heading, - for a bullet, 1. for a numbered step, **bold**.</span></div>`;
  if (l.type === "video" && l.source === "youtube") {
    const id = ytIdOf(l.youtubeUrl);
    return `${title}${sourcePicker(l, i, j)}
      <div class="field"><label for="le-yt-${i}-${j}">YouTube link</label><input id="le-yt-${i}-${j}" type="url" data-bind="${p}.youtubeUrl" data-rerender-blur="1" value="${esc(l.youtubeUrl || "")}" placeholder="https://www.youtube.com/watch?v=…">
        <span class="hint">${l.youtubeUrl && !id ? '<span class="err-inline">That doesn\'t look like a YouTube video link.</span>' : "Learners watch it here, inside the platform: they can't click through to YouTube."}</span></div>
      ${id ? `<div class="yt-preview" data-yt="${esc(id)}" data-lesson="${esc(l.id)}"></div>` : ""}
      <div class="field" style="max-width:220px"><label for="le-yd-${i}-${j}">Length</label><input id="le-yd-${i}-${j}" class="mono" type="text" data-bind="${p}.durationText" value="${esc(l.durationText || "")}" placeholder="m:ss"><span class="hint">Fills in by itself from the preview.</span></div>
      ${videoSettings(l, i, j, p)}`;
  }
  if (l.type === "video" || l.type === "pdf") {
    const f = l.fileId && e.files[l.fileId], up = e.uploading && e.uploading.key === `${i}-${j}`;
    return `${title}${l.type === "video" ? sourcePicker(l, i, j) : ""}<div class="field"><span class="lbl">${l.type === "video" ? "Video (MP4)" : "PDF"}</span>
      ${f ? `<div class="attach"><span class="chip plain ${l.type === "video" ? "info" : "khaki"}">${l.type === "video" ? "Video" : "PDF"}</span><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(f.name)}${f.duration ? " · " + esc(P.fmtDur(f.duration)) : ""}${f.size ? " · " + esc(P.fmtSize(f.size)) : ""}</span><a class="btn sm" href="/api/files/${esc(l.fileId)}" target="_blank" rel="noopener">Open</a></div>` : ""}
      ${up ? `<div class="upload-row"><span>Uploading ${esc(e.uploading.name)}…</span><progress max="1" value="${e.uploading.pct || 0}"></progress></div>`
        : `<input type="file" accept="${l.type === "video" ? "video/mp4,.mp4,.m4v,.mov" : "application/pdf,.pdf"}" data-change="cb-upload" data-i="${i}" data-j="${j}"><span class="hint">${f ? "Choose a file to replace it." : l.type === "video" ? "MP4 (H.264), under 30 MB." : "Up to 25 MB."}</span>`}</div>
      ${l.type === "video" ? videoSettings(l, i, j, p) : ""}`;
  }
  if (l.type === "document") {
    const docs = d.lib.documents.filter(m => m.status !== "archived" || m.code === l.code);
    return `<div class="field"><label for="le-d-${i}-${j}">SOP or policy</label><select id="le-d-${i}-${j}" data-bind="${p}.code" data-rerender="1"><option value="">Choose…</option>${docs.map(m => `<option value="${esc(m.code)}" ${l.code === m.code ? "selected" : ""}>${esc(m.code)} · ${esc(m.title)}${m.status !== "published" ? " (draft)" : ""}</option>`).join("")}</select>
      <span class="hint">People read and sign it as usual; signing it finishes this lesson. Who must sign it is still set on the document.</span></div>`;
  }
  if (l.type === "checklist") return `${title}<div class="field"><label for="le-s-${i}-${j}">Summary (optional)</label><input id="le-s-${i}-${j}" type="text" data-bind="${p}.summary" value="${esc(l.summary || "")}" placeholder="e.g. Do these at the start of every shift"></div>
    <div class="field"><span class="lbl">Steps people tick off</span>${(l.steps || []).map((st, k) => `<div class="opt-row"><span class="cl-num tnum">${k + 1}</span><input type="text" aria-label="Step ${k + 1}" data-bind="${p}.steps.${k}" value="${esc(st)}" placeholder="Step ${k + 1}"><button type="button" class="btn ghost sm" data-act="cb-step-del" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Remove step">✕</button></div>`).join("")}
    <div class="row"><button type="button" class="btn sm" data-act="cb-step-add" data-i="${i}" data-j="${j}">Add step</button></div></div>`;
  if (l.type === "signoff") return `${title}<div class="grid2"><div class="field"><label for="le-c-${i}-${j}">Policy reference (optional)</label><input id="le-c-${i}-${j}" type="text" data-bind="${p}.code" value="${esc(l.code || "")}" placeholder="e.g. POL-009"></div></div>
    <div class="field"><label for="le-st-${i}-${j}">Statement people agree to</label><textarea id="le-st-${i}-${j}" rows="4" data-bind="${p}.statement" placeholder="e.g. I have read the safety policy and will follow it at all times.">${esc(l.statement || "")}</textarea><span class="hint">People tick to agree and type their full name, which must match their profile. It's recorded in their certificate.</span></div>`;
  if (l.type === "evidence") return `${title}<div class="field"><label for="le-pr-${i}-${j}">What must people submit?</label><textarea id="le-pr-${i}-${j}" rows="3" data-bind="${p}.prompt" placeholder="e.g. Describe how you set up your station, and add a photo.">${esc(l.prompt || "")}</textarea></div>
    <div class="grid2"><div class="field"><label for="le-ph-${i}-${j}">Example answer (optional)</label><input id="le-ph-${i}-${j}" type="text" data-bind="${p}.placeholder" value="${esc(l.placeholder || "")}"></div>
      <div class="field"><label for="le-pho-${i}-${j}">Photo</label><select id="le-pho-${i}-${j}" data-bind="${p}.photo">${[["optional", "Optional"], ["required", "Required"], ["none", "No photo"]].map(([v, t]) => `<option value="${v}" ${l.photo === v ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
    <p class="hint muted" style="font-size:.84rem">A manager approves or returns each submission under <strong>Reviews</strong>. People can carry on with the next lessons meanwhile; the certificate waits for approval.</p>`;
  const qs = (l.questions || []).map((q, k) => `<div class="qe"><div class="row between"><span class="lbl">Question ${k + 1}</span><button type="button" class="btn ghost sm" data-act="cb-q-del" data-i="${i}" data-j="${j}" data-k="${k}">Remove</button></div>
    <input type="text" aria-label="Question ${k + 1}" data-bind="${p}.questions.${k}.q" value="${esc(q.q)}" placeholder="Question">
    ${q.options.map((o, n) => `<div class="opt-row"><input type="radio" name="cq-${i}-${j}-${k}" aria-label="Mark option ${n + 1} correct" data-change="cb-q-correct" data-i="${i}" data-j="${j}" data-k="${k}" data-n="${n}" ${q.correct === n ? "checked" : ""}><input type="text" aria-label="Option ${n + 1}" data-bind="${p}.questions.${k}.options.${n}" value="${esc(o)}" placeholder="Option ${n + 1}"><button type="button" class="btn ghost sm" data-act="cb-opt-del" data-i="${i}" data-j="${j}" data-k="${k}" data-n="${n}" ${q.options.length <= 2 ? "disabled" : ""} aria-label="Remove option">✕</button></div>`).join("")}
    <div class="row between"><span class="hint muted" style="font-size:.8rem">Tick the correct answer.</span>${q.options.length < 6 ? `<button type="button" class="btn ghost sm" data-act="cb-opt-add" data-i="${i}" data-j="${j}" data-k="${k}">Add option</button>` : ""}</div></div>`).join("");
  return `${title}<div class="field" style="max-width:160px"><label for="le-pm-${i}-${j}">Pass mark</label><select id="le-pm-${i}-${j}" data-bind="${p}.passMark" data-num="1">${[60, 70, 80, 90, 100].map(n => `<option value="${n}" ${Number(l.passMark) === n ? "selected" : ""}>${n}%</option>`).join("")}</select></div>
    ${qs}<div class="row"><button type="button" class="btn sm" data-act="cb-q-add" data-i="${i}" data-j="${j}">Add question</button></div>`;
}
const ytIdOf = u => { const s = String(u || "").trim(); let m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null; };
function sourcePicker(l, i, j) {
  const yt = l.source === "youtube";
  return `<div class="seg" role="radiogroup" aria-label="Where the video comes from"><button type="button" class="seg-b ${yt ? "" : "on"}" data-act="cb-vsrc" data-i="${i}" data-j="${j}" data-v="upload" aria-pressed="${!yt}">Upload a video</button><button type="button" class="seg-b ${yt ? "on" : ""}" data-act="cb-vsrc" data-i="${i}" data-j="${j}" data-v="youtube" aria-pressed="${yt}">YouTube link</button></div>`;
}
function videoSettings(l, i, j, p) {
  const cp = l.checkpoint;
  return `<div class="cb-subcard stack" style="gap:10px"><span class="lbl">Watch rules</span>
      <div class="grid2"><div class="field"><label for="le-mw-${i}-${j}">Must watch at least</label><select id="le-mw-${i}-${j}" data-bind="${p}.minWatchPct" data-num="1">${[[0, "Optional"], [75, "75%"], [80, "80%"], [85, "85%"], [90, "90%"], [100, "The whole video"]].map(([v, t]) => `<option value="${v}" ${Number(l.minWatchPct ?? 90) === v ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
      <label class="check"><input type="checkbox" data-bind="${p}.noSkipAhead" ${l.noSkipAhead !== false ? "checked" : ""}><span>Don't allow skipping ahead</span></label>
      <label class="check"><input type="checkbox" data-bind="${p}.pauseWhenHidden" ${l.pauseWhenHidden !== false ? "checked" : ""}><span>Pause when the person switches to another tab or app</span></label>
      <p class="hint muted" style="font-size:.82rem">The server counts only the parts really played, and never faster than real time.</p></div>
    <div class="cb-subcard stack" style="gap:8px"><span class="lbl">Chapters (optional)</span>
      ${(l.chapters || []).map((c, k) => `<div class="opt-row"><input type="text" class="ch-time mono" aria-label="Chapter ${k + 1} time" data-bind="${p}.chapters.${k}.time" value="${esc(c.time ?? "")}" placeholder="0:00"><input type="text" aria-label="Chapter ${k + 1} name" data-bind="${p}.chapters.${k}.label" value="${esc(c.label)}" placeholder="Chapter name"><button type="button" class="btn ghost sm" data-act="cb-ch-del" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Remove chapter">✕</button></div>`).join("")}
      <div class="row"><button type="button" class="btn sm" data-act="cb-ch-add" data-i="${i}" data-j="${j}">Add chapter</button><span class="hint muted" style="font-size:.8rem">Time as minutes:seconds, e.g. 1:30.</span></div></div>
    <div class="cb-subcard stack" style="gap:8px"><span class="lbl">Check question after the video (optional)</span>
      ${cp ? `<input type="text" aria-label="Check question" data-bind="${p}.checkpoint.q" value="${esc(cp.q)}" placeholder="Question">
        ${cp.options.map((o, n) => `<div class="opt-row"><input type="radio" name="cp-${i}-${j}" aria-label="Mark option ${n + 1} correct" data-change="cb-cp-correct" data-i="${i}" data-j="${j}" data-n="${n}" ${cp.correct === n ? "checked" : ""}><input type="text" aria-label="Option ${n + 1}" data-bind="${p}.checkpoint.options.${n}" value="${esc(o)}" placeholder="Option ${n + 1}"><button type="button" class="btn ghost sm" data-act="cb-cp-opt-del" data-i="${i}" data-j="${j}" data-n="${n}" ${cp.options.length <= 2 ? "disabled" : ""} aria-label="Remove option">✕</button></div>`).join("")}
        <div class="row between">${cp.options.length < 6 ? `<button type="button" class="btn ghost sm" data-act="cb-cp-opt-add" data-i="${i}" data-j="${j}">Add option</button>` : "<span></span>"}<button type="button" class="btn ghost sm danger" data-act="cb-cp-del" data-i="${i}" data-j="${j}">Remove question</button></div>`
      : `<div class="row"><button type="button" class="btn sm" data-act="cb-cp-add" data-i="${i}" data-j="${j}">Add a check question</button><span class="hint muted" style="font-size:.8rem">Answered after watching; marked on the server.</span></div>`}</div>`;
}
function lessonLabel(l, d) {
  if (l.type === "document") { const m = d.lib.documents.find(x => x.code === l.code); return l.title || (m ? m.title : l.code || "Choose an SOP or policy"); }
  return l.title || `Untitled ${LESSON_TYPES[l.type].toLowerCase()} lesson`;
}
function mCourse(d) {
  const e = S.courseEdit; if (!e) return "";
  if (!e.id) return mCourseNew();
  const T = P.term, Mod = T("module");
  const dr = e.draft, a = dr.audience, ro = !canEdit(), sh = !!e.shared, lock = ro || sh;
  const pub = e.status === "published", cur = e.label;
  const [maj, min] = cur ? cur.split(".").map(Number) : [0, 0];
  const nMinor = `${maj}.${min + 1}`, nMajor = `${maj + 1}.0`;
  const counts = d.lib.activeByPosition || {};
  const people = a.all ? Object.values(counts).reduce((n, x) => n + x, 0) : (a.positions || []).reduce((n, p) => n + (counts[p] || 0), 0);
  let num = 0;
  const modules = dr.modules.map((m, i) => `<section class="card pad stack cb-module" style="gap:12px">
    <div class="row" style="flex-wrap:nowrap;gap:8px"><span class="cb-modnum">${esc(Mod)} ${i + 1}</span><label class="sr-only" for="cm-${i}">${esc(Mod)} title</label><input id="cm-${i}" type="text" data-bind="courseEdit.draft.modules.${i}.title" value="${esc(m.title)}" placeholder="${esc(Mod)} title" style="flex:1">
      ${lock ? "" : `<button type="button" class="btn ghost sm" data-act="cb-mod-move" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button type="button" class="btn ghost sm" data-act="cb-mod-move" data-i="${i}" data-d="1" ${i === dr.modules.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button><button type="button" class="btn ghost sm danger" data-act="cb-mod-del" data-i="${i}" aria-label="Remove">✕</button>`}</div>
    ${m.lessons.length ? `<ol class="cb-lessons">${m.lessons.map((l, j) => { num++; const open = e.open === l.id;
      return `<li class="cb-lesson ${open ? "open" : ""}"><div class="cb-row"><span class="cb-icon t-${l.type}" aria-hidden="true">${LESSON_ICON[l.type]}</span><span class="ci-num tnum">${num}</span><button type="button" class="cb-title linkish" data-act="cb-les-open" data-id="${esc(l.id)}">${esc(lessonLabel(l, d))}</button><span class="chip plain">${esc(LESSON_TYPES[l.type])}</span>
        ${lock ? "" : `<span class="cb-tools"><button type="button" class="btn ghost sm" data-act="cb-les-move" data-i="${i}" data-j="${j}" data-d="-1" ${i === 0 && j === 0 ? "disabled" : ""} aria-label="Move lesson up">↑</button><button type="button" class="btn ghost sm" data-act="cb-les-move" data-i="${i}" data-j="${j}" data-d="1" ${i === dr.modules.length - 1 && j === m.lessons.length - 1 ? "disabled" : ""} aria-label="Move lesson down">↓</button><button type="button" class="btn ghost sm danger" data-act="cb-les-del" data-i="${i}" data-j="${j}" aria-label="Remove lesson">✕</button></span>`}</div>
        ${open ? `<div class="cb-editor stack" style="gap:12px">${lessonEditor(l, i, j, d)}</div>` : ""}</li>`; }).join("")}</ol>` : `<p class="muted" style="font-size:.9rem">No lessons in this ${esc(Mod.toLowerCase())} yet.</p>`}
    ${lock ? "" : `<div class="cb-insert"><span class="lbl">Add a lesson</span><div class="cb-insert-btns">${Object.entries(LESSON_TYPES).map(([k, v]) => `<button type="button" class="cb-ins" data-act="cb-les-add" data-i="${i}" data-type="${k}" title="${esc(LESSON_HINT[k])}"><span class="cb-icon t-${k}" aria-hidden="true">${LESSON_ICON[k]}</span>${esc(v)}</button>`).join("")}</div></div>`}
  </section>`).join("");
  const aud = `<label class="check"><input type="checkbox" data-bind="courseEdit.draft.audience.all" data-rerender="1" ${a.all ? "checked" : ""}><span><strong>All staff</strong></span></label>
    ${a.all ? "" : S.org.departments.map(dp => { const ps = S.org.positions.filter(p => p.dept === dp.id); if (!ps.length) return "";
      return `<div class="aud-dept"><div class="dh"><span>${esc(dp.name)}</span></div>${ps.map(p => `<label class="check"><input type="checkbox" data-change="cb-aud-pos" data-p="${esc(p.id)}" ${a.positions.includes(p.id) ? "checked" : ""}><span>${esc(p.name)}</span></label>`).join("")}</div>`; }).join("")}`;
  const status = e.status === "archived" ? "Archived · hidden from staff" : pub ? `Published · version ${esc(cur)}${e.draftDirty ? " · unpublished changes" : ""}` : "Draft · staff can't see it yet";
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/library">← SOP library</a><h1>${esc(dr.title || "Untitled")}</h1><span class="muted">${status}</span></div></div>
    ${sh ? `<div class="notice info" style="margin-bottom:16px"><strong>Provided by ${esc(e.shared.provider)}.</strong> The lessons can't be changed here. Choose who at ${esc(S.org.orgName)} must complete it, then publish.</div>` : ""}
    ${e.dirty ? `<div class="notice" style="margin-bottom:16px">You have unsaved changes.</div>` : ""}
    <form data-form="course" class="editor"><div class="stack" style="gap:16px;min-width:0"><fieldset ${lock ? "disabled" : ""} style="border:0;padding:0;margin:0;min-width:0;display:contents">
      <section class="card pad stack" style="gap:14px"><div class="field"><label for="c-title">Title</label><input id="c-title" type="text" data-bind="courseEdit.draft.title" value="${esc(dr.title)}"></div>
        <div class="field"><label for="c-desc">Description</label><textarea id="c-desc" rows="2" data-bind="courseEdit.draft.description">${esc(dr.description)}</textarea></div></section>
      ${modules || `<div class="card empty"><h3>Start with a ${esc(Mod.toLowerCase())}</h3><p>${esc(T("modules"))} group lessons, e.g. "Welcome", "On the floor", "Check".</p></div>`}
      ${lock ? "" : `<div class="row"><button type="button" class="btn" data-act="cb-mod-add">Add ${esc(Mod.toLowerCase())}</button></div>`}
    </fieldset></div>
    <aside class="side-panel">
      <section class="card pad stack" style="gap:12px"><h3>Who must complete it</h3><fieldset ${ro ? "disabled" : ""} style="border:0;padding:0;margin:0;min-width:0;display:contents">${aud}</fieldset><p class="muted tnum" style="font-size:.86rem">${P.isAuthor() ? "Each client it's shared with chooses who completes it. This sets the starting choice." : `${plural(people, "active staff member")} will get this.`}</p></section>
      ${e.stats && !P.isAuthor() ? `<section class="card pad stack" style="gap:6px"><h3>Completed</h3><p class="tnum" style="font-size:1.4rem;margin:0">${e.stats.completed} <span class="muted" style="font-size:1rem">of ${e.stats.total}</span></p><p class="muted" style="font-size:.84rem">Each one has a certificate in their training record.</p></section>` : ""}
      ${ro ? "" : `<section class="card pad stack" style="gap:12px">
        <button type="submit" class="btn block">Save draft</button>
        ${pub ? `<span class="lbl">How big is this change?</span>
          <label class="check"><input type="radio" name="cchg" data-change="cb-chg" data-v="minor" ${e.change === "minor" ? "checked" : ""}><span>Minor change (v${esc(nMinor)})<br><span class="muted" style="font-size:.84rem">Progress and certificates stay valid.</span></span></label>
          <label class="check"><input type="radio" name="cchg" data-change="cb-chg" data-v="major" ${e.change === "major" ? "checked" : ""}><span>New version (v${esc(nMajor)})<br><span class="muted" style="font-size:.84rem">Everyone takes it again.</span></span></label>` : ""}
        <button type="button" class="btn primary block" data-act="cb-publish" ${S.busy ? "disabled" : ""}>${pub ? `Publish version ${esc(e.change === "major" ? nMajor : nMinor)}` : "Publish to staff"}</button>
        ${e.problems.length && !e.dirty ? `<p class="hint muted" style="font-size:.84rem">Before publishing: ${esc(e.problems[0])}${e.problems.length > 1 ? ` (and ${e.problems.length - 1} more)` : ""}</p>` : ""}
        <p class="err" id="course-err" role="alert"></p>
        <button type="button" class="btn sm danger" data-act="course-del">${e.label ? "Archive" : "Delete"}</button></section>`}
      ${e.versions.length ? `<section class="card pad stack" style="gap:8px"><h3>Published versions</h3>${e.versions.map(v => `<div class="tnum" style="font-size:.9rem">Version ${esc(v.label)} <span class="muted">· ${fmtDate(v.publishedAt)}</span></div>`).join("")}</section>` : ""}
    </aside></form>`;
}

/* ---------- field evidence waiting for review ---------- */
function mReviews(d) {
  const cur = S.params.filter || "pending";
  const tab = (k, label) => `<a class="btn sm ${cur === k ? "primary" : ""}" href="#/m/reviews/${k}" aria-current="${cur === k ? "page" : "false"}">${label}</a>`;
  return `<div class="page-head"><div class="t"><h1>Reviews</h1><p class="muted">Field evidence your staff submitted in courses. Approving it completes that lesson; returning it asks them to submit again.</p></div></div>
    <div class="toolbar">${tab("pending", `Waiting${d.pending ? ` <span class="tnum" style="opacity:.8">${d.pending}</span>` : ""}`)}${tab("approved", "Approved")}${tab("rejected", "Returned")}${tab("all", "All")}</div>
    ${d.items.length ? `<div class="rv-list">${d.items.map(e => `<article class="card rv-card">
      ${e.fileId ? `<a class="rv-photo" href="/api/files/${esc(e.fileId)}" target="_blank" rel="noopener"><img src="/api/files/${esc(e.fileId)}" alt="Photo submitted by ${esc(e.staffName)}"></a>` : `<div class="rv-photo none">No photo</div>`}
      <div class="rv-body stack" style="gap:6px"><div class="row between" style="gap:8px"><strong>${esc(e.staffName)} <span class="muted mono" style="font-weight:400">${esc(e.staffNo)}</span></strong>${e.status === "pending" ? '<span class="chip warn">Waiting</span>' : e.status === "approved" ? '<span class="chip ok">Approved</span>' : '<span class="chip bad">Returned</span>'}</div>
        <div class="muted" style="font-size:.86rem">${esc(e.courseTitle)} · ${esc(e.lessonTitle)} · ${P.fmtDT(e.submittedAt)}</div>
        <p class="rv-text">${esc(e.text)}</p>${e.note ? `<p class="muted" style="font-size:.86rem">Note: ${esc(e.note)}</p>` : ""}
        ${e.status === "pending" && canEdit() ? `<div class="row"><button type="button" class="btn primary sm" data-act="rv-approve" data-id="${esc(e.id)}">Approve</button><button type="button" class="btn sm" data-act="rv-reject" data-id="${esc(e.id)}" data-name="${esc(e.staffName)}">Return with a note</button></div>` : ""}</div></article>`).join("")}</div>`
      : `<div class="card empty"><h3>Nothing here</h3><p>${S.params.filter && S.params.filter !== "pending" ? "No evidence in this list yet." : "No evidence is waiting for review."}</p></div>`}`;
}

/* ---------- editor ---------- */
function setEdit(det) { S.edit = Object.assign(P.clone(det), { change: "minor", localDirty: false, uploading: null }); }
function mEdit(d) {
  if (S.params.id === "new") return mNewDoc();
  const e = S.edit; if (!e) return "";
  const dr = e.draft, a = dr.audience, ro = !canEdit();
  const sh = !!e.shared; // provided by MSP Academy: only who completes it, and its order, can change
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
    ${sh ? `<div class="notice info" style="margin-bottom:16px"><strong>Provided by ${esc(e.shared.provider)}.</strong> The content can't be changed here. Choose who at ${esc(S.org.orgName)} must complete it, and its place in the course, then publish.</div>` : ""}
    ${e.localDirty ? `<div class="notice" style="margin-bottom:16px">You have unsaved changes.</div>` : ""}
    <form data-form="doc" class="editor"><fieldset ${ro ? "disabled" : ""} style="border:0;padding:0;margin:0;min-width:0;display:contents">
      <div class="stack" style="gap:16px;min-width:0"><fieldset ${sh ? "disabled" : ""} style="border:0;padding:0;margin:0;min-width:0;display:contents">
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
      </fieldset></div>
      <aside class="side-panel">
        <section class="card pad stack" style="gap:12px"><h3>Who must complete it</h3>${aud}<p class="muted tnum" style="font-size:.86rem">${plural(people, "active staff member")} will get this.</p></section>
        <section class="card pad stack" style="gap:12px"><h3>Document details</h3><fieldset ${sh ? "disabled" : ""} style="border:0;padding:0;margin:0;min-width:0;display:contents"><div class="field"><label for="ed-issue">Issue date</label><input id="ed-issue" type="text" data-bind="edit.draft.issueDate" value="${esc(dr.issueDate || "")}" placeholder="e.g. 10 June 2026"><span class="hint">As printed on the document.</span></div><div class="field"><label for="ed-applies">Applies to (wording)</label><input id="ed-applies" type="text" data-bind="edit.draft.appliesText" value="${esc(dr.appliesText || "")}" placeholder="e.g. All FOH staff"><span class="hint">Shown to staff. Who must sign is set above.</span></div></fieldset></section>
        <section class="card pad stack" style="gap:12px"><div class="grid2" style="grid-template-columns:1fr 1fr"><div class="field"><label for="ed-min">Minutes</label><input id="ed-min" type="number" min="1" max="600" data-bind="edit.draft.estMinutes" data-num="1" value="${esc(dr.estMinutes)}" ${sh ? "disabled" : ""}></div><div class="field"><label for="ed-ord">Course order</label><input id="ed-ord" type="number" data-bind="edit.draft.order" data-num="1" value="${esc(dr.order)}"></div></div><span class="hint muted" style="font-size:.8rem">Lower numbers come first in the course.</span></section>
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
      <div class="field"><label for="nd-code">Document code</label><input id="nd-code" type="text" data-bind="newDoc.code" value="${esc(n.code)}" placeholder="${esc((S.brand && S.brand.docPrefix) || "DOC")}-SOP-013"><span class="hint">The next free number from the Document Register is filled in.</span></div>
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
      <p>${d.domains && d.domains.length ? `Staff open <strong>${d.domains.map(esc).join("</strong> or <strong>")}</strong>, or the shared sign-in page with the client code <strong class="mono">${esc(d.loginCode || "")}</strong>.` : `On the shared sign-in page, staff first enter the client code <strong class="mono">${esc(d.loginCode || "")}</strong>. A shared tablet remembers it.`}
        Documents are numbered ${esc(d.docPrefix || "")}-SOP-001 and so on${d.staffNoPrefix ? `, and staff numbers start with ${esc(d.staffNoPrefix)}` : ""}. To change these, contact MSP Academy.</p>
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
