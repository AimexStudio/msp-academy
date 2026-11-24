// Leave tracking screens: managers' overview and person pages, and staff's "My leave".
(function () {
"use strict";
const P = window.Pel;
const { S, esc, fmtDate } = P;
const n = x => (Math.round(x * 100) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const daysTxt = x => `${n(x)} day${Math.abs(x) === 1 ? "" : "s"}`;
const TYPE_CHIP = { annual: "info", sick: "warn", family: "khaki", special: "plain", unpaid: "plain", adjustment: "plain" };
const period = e => e.type === "adjustment" ? fmtDate(e.startDate) : e.startDate === e.endDate ? fmtDate(e.startDate) : `${fmtDate(e.startDate)} – ${fmtDate(e.endDate)}`;

function balanceCards(b, at, todayIso, opts = {}) {
  const proj = at && at.date !== todayIso;
  return `<div class="leave-cards">
    <div class="card leave-card main"><span class="lbl">Annual leave today</span><strong class="tnum">${n(b.annual.balance)}</strong><span class="muted">days · ${n(b.annual.perYear)} a year</span></div>
    <div class="card leave-card"><span class="lbl">Sick leave left</span><strong class="tnum">${n(b.sick.left)}</strong><span class="muted">of ${n(b.sick.allowance)} · until ${b.sick.cycleEnd ? fmtDate(b.sick.cycleEnd) : "—"}</span></div>
    <div class="card leave-card"><span class="lbl">Family responsibility left</span><strong class="tnum">${n(b.family.left)}</strong><span class="muted">of ${n(b.family.allowance)} · until ${b.family.cycleEnd ? fmtDate(b.family.cycleEnd) : "—"}</span></div>
    <div class="card leave-card proj"><label class="lbl" for="leave-at">Annual leave on</label><input id="leave-at" type="date" data-change="leave-at" value="${esc(at ? at.date : todayIso)}" min="${esc(todayIso)}">
      <strong class="tnum">${n((proj ? at : b).annual.balance)}</strong><span class="muted">days${proj ? ", counting leave already booked before then" : ". Pick a future date to see what it will be."}</span></div>
  </div>${opts.note || ""}`;
}
function historyTable(entries, { manage = false } = {}) {
  if (!entries.length) return `<div class="card empty"><p>No leave recorded yet.</p></div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Type</th><th>When</th><th class="tnum">Days</th>${manage ? "<th>Note</th>" : ""}<th>Certificate</th>${manage ? "<th></th>" : ""}</tr></thead><tbody>
    ${entries.map(e => `<tr><td><span class="chip ${TYPE_CHIP[e.type] || "plain"}">${esc(e.typeName)}</span></td><td style="white-space:nowrap">${period(e)}</td><td class="tnum">${e.days > 0 && e.type === "adjustment" ? "+" : ""}${n(e.days)}</td>
      ${manage ? `<td class="muted" style="max-width:280px">${esc(e.note || "")}</td>` : ""}
      <td>${e.certificateFileId ? `<a href="/api/files/${esc(e.certificateFileId)}" target="_blank" rel="noopener">Open</a>` : "—"}</td>
      ${manage ? `<td style="white-space:nowrap">${P.canEdit() ? `<button type="button" class="btn ghost sm" data-act="lv-edit" data-id="${esc(e.id)}">Change</button><button type="button" class="btn ghost sm danger" data-act="lv-del" data-id="${esc(e.id)}">Remove</button>` : ""}</td>` : ""}</tr>`).join("")}
  </tbody></table></div>`;
}

/* ---------- managers ---------- */
function mList(d) {
  const set = d.staff.filter(r => r.configured).length;
  return `<div class="page-head"><div class="t"><span class="eyebrow">People</span><h1>Leave</h1><p class="muted">Annual, sick, family responsibility and special leave. Balances as at ${fmtDate(d.today)}. Open a person to record leave or change their yearly leave.</p></div></div>
    ${set < d.staff.length ? `<div class="notice info" style="margin-bottom:14px">${d.staff.length - set} of ${d.staff.length} people don’t have their yearly leave set yet. Open each one to set it.</div>` : ""}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Department</th><th class="tnum">Annual</th><th class="tnum">Sick left</th><th class="tnum">Family left</th><th>Leave</th></tr></thead><tbody>
    ${d.staff.map(r => `<tr class="click" data-href="#/m/leave/${encodeURIComponent(r.id)}"><td><a class="nm" href="#/m/leave/${encodeURIComponent(r.id)}" style="color:inherit;text-decoration:none"><strong>${esc(r.name)}</strong></a><div class="muted mono" style="font-size:.8rem">${esc(r.staffNo)} · ${esc(r.positionName)}</div></td>
      <td>${esc(r.deptName)}</td><td class="tnum">${r.configured ? n(r.annual) : '<span class="chip warn">Set up</span>'}</td><td class="tnum">${n(r.sickLeft)}</td><td class="tnum">${n(r.familyLeft)}</td>
      <td>${r.onLeave ? `<span class="chip ok">On leave until ${fmtDate(r.onLeave.endDate)}</span>` : r.next ? `<span class="muted">${esc(r.next.typeName)} from ${fmtDate(r.next.startDate)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">No staff yet.</td></tr>'}
    </tbody></table></div>`;
}
function mPerson(d) {
  const f = S.lv, edit = P.canEdit(), pr = f.profile;
  const form = !edit ? "" : `<form data-form="lv-entry" class="card pad stack" style="gap:12px" id="lv-form"><h2>${f.editing ? "Change leave record" : "Record leave"}</h2>
      <div class="grid2"><div class="field"><label for="lv-type">Type</label><select id="lv-type" data-bind="lv.entry.type" data-rerender="1">${Object.entries(d.types).map(([k, v]) => `<option value="${k}" ${f.entry.type === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
        <div class="field"><label for="lv-days">${f.entry.type === "adjustment" ? "Days to add (e.g. 2) or take away (e.g. -2)" : "Number of days"}</label><input id="lv-days" type="number" step="0.5" data-bind="lv.entry.days" value="${esc(f.entry.days)}"><span class="hint">${f.entry.type === "adjustment" ? "" : "Working days are suggested (weekends and public holidays skipped). Change it for weekend workers or half days."}</span></div></div>
      <div class="grid2"><div class="field"><label for="lv-from">${f.entry.type === "adjustment" ? "Date" : "First day"}</label><input id="lv-from" type="date" data-change="lv-dates" data-bind="lv.entry.startDate" value="${esc(f.entry.startDate)}"></div>
        ${f.entry.type === "adjustment" ? "" : `<div class="field"><label for="lv-to">Last day</label><input id="lv-to" type="date" data-change="lv-dates" data-bind="lv.entry.endDate" value="${esc(f.entry.endDate)}"></div>`}</div>
      <div class="field"><label for="lv-note">${f.entry.type === "adjustment" ? "Reason" : "Note (managers only)"}</label><textarea id="lv-note" rows="2" data-bind="lv.entry.note">${esc(f.entry.note)}</textarea></div>
      ${f.entry.type === "sick" || f.entry.type === "family" || f.entry.certificateFileId ? `<div class="field"><span class="lbl">Medical certificate</span>${f.entry.certificateFileId ? `<div class="row"><span>${esc(f.entry.certificateName || "Certificate attached")}</span><button type="button" class="btn ghost sm" data-act="lv-cert-remove">Remove</button></div>` : ""}
        <input type="file" accept="application/pdf,image/jpeg,image/png" data-change="lv-cert"><span class="hint">PDF, or a photo of it. Visible to ${esc(d.person.name.split(" ")[0])} and managers only.</span></div>` : ""}
      <p class="err" id="lv-err" role="alert"></p>
      <div class="row"><button type="submit" class="btn primary">${f.editing ? "Save changes" : "Record leave"}</button>${f.editing ? `<button type="button" class="btn" data-act="lv-cancel">Cancel</button>` : ""}</div></form>`;
  return `<div class="page-head"><div class="t"><a class="back" href="#/m/leave">← Leave</a><h1>${esc(d.person.name)}</h1><p class="muted">${esc(d.person.staffNo)} · ${esc(d.person.positionName)}</p></div></div>
    ${d.configured ? "" : `<div class="notice warn" style="margin-bottom:14px">Yearly leave isn’t set for ${esc(d.person.name)} yet. Set it below; until then the balance shows the standard ${n(pr.annualDays)} days from their start date.</div>`}
    ${balanceCards(d.now, d.at, d.today)}
    <div class="leave-grid"><div class="stack" style="gap:16px;min-width:0">${form}<section class="stack" style="gap:10px"><h2>History</h2>${historyTable(d.entries, { manage: true })}</section></div>
      <form data-form="lv-profile" class="card pad stack" style="gap:12px"><h2>Yearly leave</h2><fieldset ${edit ? "" : "disabled"} style="border:0;padding:0;margin:0;display:contents">
        <div class="field"><label for="lp-annual">Annual leave per year (days)</label><input id="lp-annual" type="number" step="0.5" min="0" data-bind="lv.profile.annualDays" value="${esc(pr.annualDays)}"><span class="hint">15 working days is the legal minimum for a 5-day week.</span></div>
        <div class="field"><label for="lp-start">Builds up from</label><input id="lp-start" type="date" data-bind="lv.profile.accrualStart" value="${esc(pr.accrualStart || "")}"><span class="hint">Usually their start date. Sick and family leave cycles also start here.</span></div>
        <div class="field"><label for="lp-open">Opening balance (days)</label><input id="lp-open" type="number" step="0.5" data-bind="lv.profile.openingBalance" value="${esc(pr.openingBalance)}"><span class="hint">Leave owed from before, if any.</span></div>
        <div class="grid2"><div class="field"><label for="lp-sick">Sick days per 3 years</label><input id="lp-sick" type="number" min="0" data-bind="lv.profile.sickDays" value="${esc(pr.sickDays)}"></div>
          <div class="field"><label for="lp-fam">Family days per year</label><input id="lp-fam" type="number" min="0" data-bind="lv.profile.familyDays" value="${esc(pr.familyDays)}"></div></div>
        <p class="err" id="lp-err" role="alert"></p>
        ${edit ? `<div class="row"><button type="submit" class="btn">Save yearly leave</button></div>` : ""}</fieldset></form></div>`;
}
/* ---------- staff ---------- */
function sMine(d) {
  if (!d.enabled) return `<main class="wrap gutter"><div class="card empty"><h3>Leave isn’t tracked here</h3><a class="btn" href="#/home">Back</a></div></main>`;
  return `<main class="wrap gutter stack" style="gap:20px"><a class="back" href="#/home">← My training</a><div><span class="eyebrow">Leave</span><h1>My leave</h1>
      ${d.configured ? "" : `<p class="muted">Your manager hasn’t set your yearly leave yet, so these figures may change.</p>`}</div>
    ${balanceCards(d.now, d.at, d.today)}
    <section class="stack" style="gap:10px"><h2>My leave history</h2>${historyTable(d.entries)}</section>
    <p class="muted" style="font-size:.86rem">Something not right? Speak to your manager: they record leave and can correct it.</p></main>`;
}
function homeCard(d) {
  if (!d || !d.enabled) return "";
  return `<a class="card leave-home" href="#/leave"><div><span class="eyebrow">Leave</span><strong class="tnum">${n(d.now.annual.balance)} days</strong><span class="muted">annual leave today</span></div><span class="btn sm">My leave</span></a>`;
}

/* ---------- clicks and forms ---------- */
const blankEntry = () => ({ type: "annual", startDate: "", endDate: "", days: "", note: "", certificateFileId: null, certificateName: "" });
function prepare(d) { // called when a person page loads
  const keep = S.lv && S.lv.personId === d.person.id && S.lv.editing;
  S.lv = { personId: d.person.id, profile: { ...d.profile }, entry: keep ? S.lv.entry : blankEntry(), editing: keep ? S.lv.editing : null, entries: d.entries };
}
async function suggestDays() {
  const e = S.lv.entry; if (e.type === "adjustment" || !e.startDate) return;
  if (!e.endDate || e.endDate < e.startDate) e.endDate = e.startDate;
  try { const r = await P.GET(`/api/admin/leave-days?from=${e.startDate}&to=${e.endDate}`); e.days = r.days; } catch {}
  P.render();
}
function uploadCert(file) {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append("file", file, file.name);
    const x = new XMLHttpRequest(); x.open("POST", `/api/admin/leave/${encodeURIComponent(S.lv.personId)}/certificate`); x.setRequestHeader("x-pelagos", "1");
    x.onload = () => { let d = null; try { d = JSON.parse(x.responseText); } catch {} x.status === 200 ? resolve(d) : reject(new Error((d && d.error) || "Upload failed.")); };
    x.onerror = () => reject(new Error("Upload failed. Check the connection and try again.")); x.send(fd);
  });
}
const showErr = (id, e) => { const el = document.getElementById(id); if (el) el.textContent = e.message; else P.fail(e); };
P.addActions({
  "lv-edit": (t, ds) => {
    const e = S.lv.entries.find(x => x.id === ds.id); if (!e) return;
    S.lv.editing = e.id; S.lv.entry = { type: e.type, startDate: e.startDate, endDate: e.endDate, days: e.days, note: e.note || "", certificateFileId: e.certificateFileId, certificateName: e.certificateFileId ? "Certificate attached" : "" };
    P.render(); const f = document.getElementById("lv-form"); if (f) f.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  "lv-cancel": () => { S.lv.editing = null; S.lv.entry = blankEntry(); P.render(); },
  "lv-cert-remove": () => { S.lv.entry.certificateFileId = null; S.lv.entry.certificateName = ""; P.render(); },
  "lv-del": (t, ds) => P.confirmBox("Remove this leave record?", "It no longer counts towards the balance. The removal is kept in the audit log.", "Remove", async () => {
    await P.api("DELETE", `/api/admin/leave/entries/${encodeURIComponent(ds.id)}`); P.toast("Removed."); P.load();
  }, true),
});
P.addForms({
  "lv-entry": async () => {
    const e = S.lv.entry, body = { type: e.type, startDate: e.startDate, endDate: e.type === "adjustment" ? e.startDate : e.endDate, days: e.days === "" ? null : Number(e.days), note: e.note, certificateFileId: e.certificateFileId };
    try {
      if (S.lv.editing) await P.PUT(`/api/admin/leave/entries/${encodeURIComponent(S.lv.editing)}`, body);
      else await P.POST(`/api/admin/leave/${encodeURIComponent(S.lv.personId)}/entries`, body);
      P.toast(S.lv.editing ? "Changes saved." : "Leave recorded."); S.lv.editing = null; S.lv.entry = blankEntry(); P.load();
    } catch (err) { showErr("lv-err", err); }
  },
  "lv-profile": async () => {
    try { await P.PUT(`/api/admin/leave/${encodeURIComponent(S.lv.personId)}/profile`, S.lv.profile); P.toast("Yearly leave saved."); P.load(); }
    catch (err) { showErr("lp-err", err); }
  },
});
document.addEventListener("change", async e => {
  const ds = e.target.dataset || {};
  if (ds.change === "lv-dates" && S.lv) { setTimeout(suggestDays, 0); }
  if (ds.change === "leave-at") { const v = e.target.value; S.leaveAt = v; P.load(); }
  if (ds.change === "lv-cert" && S.lv) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const r = await uploadCert(f); S.lv.entry.certificateFileId = r.id; S.lv.entry.certificateName = f.name; P.render(); P.toast("Certificate attached. Save the record to keep it."); }
    catch (err) { showErr("lv-err", err); }
  }
});

window.PelLeave = { mList, mPerson, sMine, homeCard, prepare };
})();
