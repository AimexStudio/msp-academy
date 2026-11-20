// Clicks, typing and form submits for every screen, plus start-up.
(function () {
"use strict";
const P = window.Pel, M = window.PelMgr;
const { S, GET, POST, PUT, PATCH, api, go, render, load, toast, fail, confirmBox, closeModal, setPath, getPath, plural } = P;
const $app = document.getElementById("app");

/* ---------- typing ---------- */
let liveTimer = null;
document.addEventListener("input", e => {
  const el = e.target, path = el.dataset && el.dataset.bind; if (!path) return;
  let val = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.num) val = Number(val);
  setPath(S, path, val);
  if (path.startsWith("edit.") && S.edit && !S.edit.localDirty) { S.edit.localDirty = true; }
  if (path.startsWith("courseEdit.draft") && S.courseEdit) S.courseEdit.dirty = true;
  if (el.dataset.live) { clearTimeout(liveTimer); liveTimer = setTimeout(() => rerenderKeepFocus(el.id), 150); }
  P.refreshGates();
});
document.addEventListener("change", async e => {
  const el = e.target, ds = el.dataset || {};
  if (ds.bind && (el.tagName === "SELECT" || el.type === "checkbox")) {
    let val = el.type === "checkbox" ? el.checked : el.value; if (ds.num) val = Number(val);
    setPath(S, ds.bind, val);
    if (ds.bind.startsWith("edit.") && S.edit) S.edit.localDirty = true;
    if (ds.bind.startsWith("courseEdit.draft") && S.courseEdit) S.courseEdit.dirty = true;
    if (ds.rerender) render();
    if (ds.reload) load();
    P.refreshGates();
    return;
  }
  const act = ds.change; if (!act) return;
  if (act === "quiz-answer") { S.docv.quiz.answers[ds.i] = Number(el.value); el.closest("fieldset").querySelectorAll(".opt").forEach(o => o.classList.toggle("sel", o.contains(el))); P.refreshGates(); }
  else if (act === "q-correct") { S.edit.draft.questions[ds.i].correct = Number(ds.j); S.edit.localDirty = true; }
  else if (act === "aud-pos") { const ps = S.edit.draft.audience.positions; const i = ps.indexOf(ds.p); if (el.checked && i < 0) ps.push(ds.p); if (!el.checked && i >= 0) ps.splice(i, 1); S.edit.localDirty = true; render(); }
  else if (act === "chg") { S.edit.change = ds.v; render(); }
  else if (act === "cb-aud-pos") { const ps = S.courseEdit.draft.audience.positions; const i = ps.indexOf(ds.p); if (el.checked && i < 0) ps.push(ds.p); if (!el.checked && i >= 0) ps.splice(i, 1); S.courseEdit.dirty = true; render(); }
  else if (act === "cb-q-correct") { cbLesson(ds).questions[ds.k].correct = Number(ds.n); S.courseEdit.dirty = true; }
  else if (act === "cb-cp-correct") { cbLesson(ds).checkpoint.correct = Number(ds.n); S.courseEdit.dirty = true; }
  else if (act === "cb-chg") { S.courseEdit.change = ds.v; render(); }
  else if (act === "cb-upload") {
    const f = el.files && el.files[0]; if (!f) return;
    const e = S.courseEdit, l = cbLesson(ds);
    e.uploading = { key: `${ds.i}-${ds.j}`, name: f.name, pct: 0 }; render();
    try {
      const r = await P.upload(f, pct => { e.uploading.pct = pct; const pr = $app.querySelector(".cb-editor progress"); if (pr) pr.value = pct; });
      if (r.kind !== (l.type === "video" ? "video" : "pdf")) throw new Error(l.type === "video" ? "That isn't a video. Upload an MP4." : "That isn't a PDF.");
      l.fileId = r.id; e.files[r.id] = r; e.dirty = true;
      if (!l.title) l.title = f.name.replace(/\.[^.]+$/, "");
    } catch (err) { fail(err); }
    e.uploading = null; render();
  }
  else if (act === "nd-kind") { S.newDoc.kind = el.value; try { S.newDoc.code = (await GET(`/api/admin/next-code?kind=${el.value}`)).code; } catch {} render(); }
  else if (act === "pdf-upload" || act === "video-upload") {
    const f = el.files && el.files[0]; if (!f) return;
    const kind = act === "pdf-upload" ? "pdf" : "video";
    S.edit.uploading = { kind, name: f.name, pct: 0 }; render();
    try {
      const r = await P.upload(f, pct => { S.edit.uploading.pct = pct; const pr = $app.querySelector("progress"); if (pr) pr.value = pct; });
      S.edit.files[r.id] = r;
      if (kind === "pdf") S.edit.draft.pdfFileId = r.id; else S.edit.draft.videos.push({ fileId: r.id, title: f.name.replace(/\.[^.]+$/, "") });
      S.edit.localDirty = true; toast(`${kind === "pdf" ? "PDF" : "Video"} uploaded. Save to keep it.`);
    } catch (err) { fail(err); }
    S.edit.uploading = null; render();
  }
});
function rerenderKeepFocus(id) {
  const el = document.getElementById(id); const pos = el && el.selectionStart;
  render();
  const n = document.getElementById(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} }
}

/* ---------- clicks ---------- */
document.addEventListener("click", async e => {
  const row = e.target.closest("[data-href]");
  const t = e.target.closest("[data-act]");
  if (!t && row && !e.target.closest("a,button,input,select,textarea,label")) { go(row.dataset.href); return; }
  if (!t) return;
  if (t.closest("[data-stop]") && t.dataset.act === "modal-close" && !t.matches("button")) return;
  const a = t.dataset.act, ds = t.dataset;
  try { await (ACTIONS[a] || (() => {}))(t, ds, e); } catch (err) { S.busy = false; fail(err); render(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && document.getElementById("modal").innerHTML) closeModal(); });

const ACTIONS = {
  "modal-close": (t, ds, e) => { if (e.target.closest(".modal") && !e.target.closest("button")) return; closeModal(); },
  "modal-ok": async () => { const fn = P.getModalAction(); closeModal(); if (fn) await fn(); },
  logout: () => P.logout(),
  "change-client": () => P.changeClient(),
  "support-end": async () => { const author = S.support && S.support.author, org = S.me && S.brand ? S.brand.orgId : ""; await POST("/api/platform/support/end"); location.href = author ? "/platform#/library" : `/platform#/clients/${encodeURIComponent(org)}`; },
  "course-del": () => confirmBox(S.courseEdit.label ? "Archive this course?" : "Delete this course?", S.courseEdit.label ? "Staff no longer see it. Certificates already earned are kept." : "The draft is deleted. SOPs and policies in it stay in your library.", S.courseEdit.label ? "Archive" : "Delete", async () => {
    await api("DELETE", `/api/admin/courses/${encodeURIComponent(S.courseEdit.id)}`); toast(S.courseEdit.label ? "Archived." : "Deleted."); S.courseEdit = null; location.hash = "#/m/courses";
  }, true),
  "cb-mod-add": () => { const e = S.courseEdit; e.draft.modules.push({ title: `${P.term("module")} ${e.draft.modules.length + 1}`, lessons: [] }); e.dirty = true; render(); },
  "cb-mod-del": (t, ds) => {
    const e = S.courseEdit, m = e.draft.modules[ds.i];
    const go = () => { e.draft.modules.splice(ds.i, 1); e.dirty = true; render(); };
    if (!m.lessons.length) return go();
    confirmBox(`Remove ${m.title || "this " + P.term("module").toLowerCase()}?`, `Its ${plural(m.lessons.length, "lesson")} will be removed when you save.`, "Remove", go, true);
  },
  "cb-mod-move": (t, ds) => { const ms = S.courseEdit.draft.modules, i = Number(ds.i), k = i + Number(ds.d); if (k < 0 || k >= ms.length) return; [ms[i], ms[k]] = [ms[k], ms[i]]; S.courseEdit.dirty = true; render(); },
  "cb-les-add": (t, ds) => {
    const e = S.courseEdit, type = ds.type || "text";
    const l = { id: "l-" + Math.random().toString(36).slice(2, 10), type, title: "" };
    if (type === "text") l.body = ""; if (type === "video" || type === "pdf") l.fileId = null; if (type === "document") l.code = "";
    if (type === "quiz") { l.passMark = 80; l.questions = [{ q: "", options: ["", ""], correct: -1 }]; }
    if (type === "video") Object.assign(l, { minWatchPct: 90, noSkipAhead: true, pauseWhenHidden: true, chapters: [], checkpoint: null });
    if (type === "checklist") Object.assign(l, { summary: "", steps: ["", ""] });
    if (type === "signoff") Object.assign(l, { code: "", statement: "" });
    if (type === "evidence") Object.assign(l, { prompt: "", placeholder: "", photo: "optional" });
    e.draft.modules[ds.i].lessons.push(l); e.open = l.id; e.dirty = true; render();
  },
  "cb-les-open": (t, ds) => { S.courseEdit.open = S.courseEdit.open === ds.id ? null : ds.id; render(); },
  "cb-les-del": (t, ds) => { S.courseEdit.draft.modules[ds.i].lessons.splice(ds.j, 1); S.courseEdit.dirty = true; render(); },
  // Up from a module's first lesson moves it to the end of the module before; down from the last moves it into the next.
  "cb-les-move": (t, ds) => {
    const ms = S.courseEdit.draft.modules, i = Number(ds.i), j = Number(ds.j), d = Number(ds.d), ls = ms[i].lessons;
    if (d < 0 && j > 0) [ls[j - 1], ls[j]] = [ls[j], ls[j - 1]];
    else if (d > 0 && j < ls.length - 1) [ls[j + 1], ls[j]] = [ls[j], ls[j + 1]];
    else if (d < 0 && i > 0) ms[i - 1].lessons.push(ls.splice(j, 1)[0]);
    else if (d > 0 && i < ms.length - 1) ms[i + 1].lessons.unshift(ls.splice(j, 1)[0]);
    else return;
    S.courseEdit.dirty = true; render();
  },
  "cb-vsrc": (t, ds) => { const l = cbLesson(ds); l.source = ds.v; if (ds.v === "youtube") { l.fileId = null; l.youtubeUrl = l.youtubeUrl || ""; l.durationText = l.durationText || ""; } S.courseEdit.dirty = true; render(); },
  "cb-step-add": (t, ds) => { cbLesson(ds).steps.push(""); S.courseEdit.dirty = true; render(); },
  "cb-step-del": (t, ds) => { cbLesson(ds).steps.splice(ds.k, 1); S.courseEdit.dirty = true; render(); },
  "cb-ch-add": (t, ds) => { cbLesson(ds).chapters.push({ time: "", label: "" }); S.courseEdit.dirty = true; render(); },
  "cb-ch-del": (t, ds) => { cbLesson(ds).chapters.splice(ds.k, 1); S.courseEdit.dirty = true; render(); },
  "cb-cp-add": (t, ds) => { cbLesson(ds).checkpoint = { q: "", options: ["", ""], correct: -1 }; S.courseEdit.dirty = true; render(); },
  "cb-cp-del": (t, ds) => { cbLesson(ds).checkpoint = null; S.courseEdit.dirty = true; render(); },
  "cb-cp-opt-add": (t, ds) => { cbLesson(ds).checkpoint.options.push(""); S.courseEdit.dirty = true; render(); },
  "cb-cp-opt-del": (t, ds) => { const q = cbLesson(ds).checkpoint, n = Number(ds.n); q.options.splice(n, 1); if (q.correct === n) q.correct = -1; else if (q.correct > n) q.correct--; S.courseEdit.dirty = true; render(); },
  "rv-approve": async (t, ds) => { try { await POST(`/api/admin/evidence/${encodeURIComponent(ds.id)}/review`, { decision: "approve" }); toast("Approved."); load(); } catch (e) { fail(e); } },
  "rv-reject": (t, ds) => {
    S.rvNote = "";
    confirmBox(`Return ${ds.name}'s evidence?`, "They'll see your note and can submit again.", "Return it", async () => {
      try { await POST(`/api/admin/evidence/${encodeURIComponent(ds.id)}/review`, { decision: "reject", note: S.rvNote }); toast("Returned."); load(); } catch (e) { fail(e); }
    }, false, `<div class="field" style="margin:14px 0"><label for="rv-note">What needs to change?</label><textarea id="rv-note" rows="3" data-bind="rvNote" placeholder="e.g. The photo is blurred; please take it again."></textarea></div>`);
  },
  "cb-q-add": (t, ds) => { cbLesson(ds).questions.push({ q: "", options: ["", ""], correct: -1 }); S.courseEdit.dirty = true; render(); },
  "cb-q-del": (t, ds) => { cbLesson(ds).questions.splice(ds.k, 1); S.courseEdit.dirty = true; render(); },
  "cb-opt-add": (t, ds) => { cbLesson(ds).questions[ds.k].options.push(""); S.courseEdit.dirty = true; render(); },
  "cb-opt-del": (t, ds) => { const q = cbLesson(ds).questions[ds.k], n = Number(ds.n); q.options.splice(n, 1); if (q.correct === n) q.correct = -1; else if (q.correct > n) q.correct--; S.courseEdit.dirty = true; render(); },
  "cb-publish": async () => {
    const e = S.courseEdit;
    e.publishError = null;
    if (!(await saveCourse(false))) { render(); return; }
    // Say clearly why it can't be published yet (the list comes from the save just made).
    if (e.problems && e.problems.length) { e.publishError = { message: "This course can't be published yet.", items: e.problems }; render(); toast("Not published yet: see the list at the top."); window.scrollTo(0, 0); return; }
    S.busy = true; render();
    try { const r = await POST(`/api/admin/courses/${encodeURIComponent(e.id)}/publish`, { change: e.change }); toast(`Published version ${r.result.label}. Staff can see it now.`); S.courseEdit.dirty = false; S.courseEdit.publishError = null; await load(); }
    catch (err) { S.courseEdit.publishError = { message: err.message, items: [] }; toast("Not published: see the message at the top."); window.scrollTo(0, 0); }
    S.busy = false; render();
  },
  reload: () => load(),
  stay: () => P.idle.poke(),
  print: () => window.print(),
  "dept-staff": (t, ds, e) => { e.preventDefault(); S.filt.dept = ds.d; go("#/m/staff"); },

  /* staff journey */
  "doc-step": (t, ds) => { S.docv.step = ds.step; if (ds.step === "quiz" && S.docv.quiz.result && !S.docv.quiz.result.passed) S.docv.quiz.result = null; render(); window.scrollTo(0, 0); },
  "mark-read": async () => {
    const d = S.docv.data.doc; S.busy = true; P.refreshGates();
    try {
      const r = await POST(`/api/my/documents/${encodeURIComponent(d.code)}/read`, { versionId: d.versionId });
      S.docv.data.state = r.state; S.docv.step = r.state.canSign ? "sign" : "quiz";
    } catch (err) { if (!P.staleCheck(err)) fail(err); }
    S.busy = false; render(); window.scrollTo(0, 0);
  },
  "quiz-retry": () => { const q = S.docv.quiz; (q.result.wrong || []).forEach(i => delete q.answers[i]); q.result = null; render(); },
  "sig-clear": () => { S.decl.strokes = []; render(); },

  /* overview and staff */
  "copy-reminder": () => { const d = S.data["m-overview"]; offerCopy(M.reminderText(d.attention), "overview"); },
  "copy-person": () => {
    const d = S.data["m-person"]; const out = d.record.items.filter(i => i.status !== "done");
    offerCopy(`Hi ${d.person.name.split(/\s+/)[0]}, please complete your outstanding training on the training tablet: ${out.map(o => o.code).join(", ")}. Sign in with your staff number and PIN. Thank you!`, "person");
  },
  "staff-active": (t, ds) => {
    const p = S.data["m-person"].person, on = ds.on === "1";
    const run = async () => { await POST(`/api/admin/staff/${p.id}/active`, { active: on }); toast(on ? `${p.name} is active again.` : `${p.name} is marked as left. Their records are kept.`); load(); };
    if (on) return run();
    confirmBox(`Mark ${p.name} as left?`, "They can no longer sign in and drop out of the completion figures. Their sign-offs and declaration are kept, and they stay in the register as Left.", "Mark as left", run, true);
  },
  "pin-new": () => { S.pinReset = { pin: P.randPin() }; render(); },
  "pin-cancel": () => { S.pinReset = null; render(); },

  /* library and editor */
  "lib-filter": (t, ds) => { S.filt.lib = ds.k; render(); },
  "publish-all": () => {
    const lib = S.data["m-library"]; const ready = lib.documents.filter(d => d.ready).length, held = lib.documents.filter(d => d.status === "draft" && d.hold).length;
    confirmBox(`Publish ${plural(ready, "document")}?`, `Staff see ${ready === 1 ? "it" : "them"} in their course straight away.${held ? ` ${plural(held, "document")} on hold stay${held === 1 ? "s" : ""} as draft${held === 1 ? "" : "s"}.` : ""}`, "Publish all", async () => {
      const r = await POST("/api/admin/documents/publish-all"); toast(`Published ${plural(r.published.length, "document")}.`); load();
    });
  },
  "aud-dept": (t, ds) => {
    const ps = S.edit.draft.audience.positions; const inD = S.org.positions.filter(p => p.dept === ds.d).map(p => p.id);
    const allIn = inD.every(id => ps.includes(id));
    S.edit.draft.audience.positions = allIn ? ps.filter(id => !inD.includes(id)) : [...new Set(ps.concat(inD))];
    S.edit.localDirty = true; render();
  },
  "q-add": () => { S.edit.draft.questions.push({ q: "", options: ["", "", "", ""], correct: -1 }); S.edit.localDirty = true; render(); const n = document.getElementById(`q-${S.edit.draft.questions.length - 1}`); if (n) n.focus(); },
  "q-del": (t, ds) => { S.edit.draft.questions.splice(Number(ds.i), 1); S.edit.localDirty = true; render(); },
  "opt-add": (t, ds) => { S.edit.draft.questions[ds.i].options.push(""); S.edit.localDirty = true; render(); },
  "opt-del": (t, ds) => { const q = S.edit.draft.questions[ds.i]; const j = Number(ds.j); q.options.splice(j, 1); if (q.correct === j) q.correct = -1; else if (q.correct > j) q.correct--; S.edit.localDirty = true; render(); },
  "video-remove": (t, ds) => { S.edit.draft.videos.splice(Number(ds.i), 1); S.edit.localDirty = true; render(); },
  "pdf-remove": () => { S.edit.draft.pdfFileId = null; S.edit.localDirty = true; render(); },
  "ed-save": async () => { await saveDoc(); toast(S.edit.status === "draft" ? "Draft saved." : "Saved. Staff still see the published version until you publish."); },
  "ed-publish": async () => {
    const e = S.edit;
    const doIt = async () => {
      if (e.localDirty) await saveDoc(true);
      S.busy = true; render();
      try {
        const r = await POST(`/api/admin/documents/${encodeURIComponent(S.edit.code)}/publish`, { change: S.edit.change });
        P.setEdit(r.document);
        toast(r.result.restored ? `Restored version ${r.result.label}.` : `Published version ${r.result.label}.`);
      } catch (err) { S.busy = false; showErr("ed-err", err); render(); return; }
      S.busy = false; render();
    };
    if (e.current && e.change === "major") confirmBox(`Publish version ${e.current.major + 1}.0?`, "Everyone it applies to must read, pass the questions and sign it again. Their earlier sign-off stays in their history.", "Publish new version", doIt);
    else await doIt();
  },
  "ed-archive": () => confirmBox("Archive this document?", "It disappears from staff courses. All sign-offs stay on record, and you can restore it later.", "Archive", async () => {
    const d = await POST(`/api/admin/documents/${encodeURIComponent(S.edit.code)}/archive`); P.setEdit(d); toast("Archived."); render();
  }, true),
  "ed-hold": () => confirmBox("Put this draft on hold?", "It stays a draft and is skipped by Publish all.", "Put on hold", async () => {
    const reason = (document.getElementById("hold-reason") || {}).value || "On hold";
    const d = await POST(`/api/admin/documents/${encodeURIComponent(S.edit.code)}/hold`, { reason }); P.setEdit(d); render();
  }, false, `<div class="field"><label for="hold-reason">Reason</label><input id="hold-reason" type="text" value="Not yet issued"></div>`),
  "ed-release-hold": async () => { const d = await POST(`/api/admin/documents/${encodeURIComponent(S.edit.code)}/hold`, { reason: null }); P.setEdit(d); render(); },
  "ed-discard": () => confirmBox("Discard the saved changes?", `The editor goes back to version ${S.edit.current.label}, which is what staff see.`, "Discard changes", async () => {
    const d = await POST(`/api/admin/documents/${encodeURIComponent(S.edit.code)}/discard`); P.setEdit(d); render();
  }, true),
  "ed-delete": () => confirmBox("Delete this draft?", "It has never been published, so no one has signed it. This can't be undone.", "Delete draft", async () => {
    await api("DELETE", `/api/admin/documents/${encodeURIComponent(S.edit.code)}`); S.edit = null; toast("Draft deleted."); go("#/m/library");
  }, true),
  "ed-preview": async () => {
    if (S.edit.localDirty) await saveDoc(true);
    const a = S.edit.draft.audience; const pos = a.all ? "waitron" : (a.positions[0] || S.org.positions[0].id);
    go(`#/preview/${encodeURIComponent(pos)}/doc/${encodeURIComponent(S.edit.code)}`);
  },
  "ed-ai": async () => {
    if (S.edit.localDirty) await saveDoc(true);
    S.aiBusy = true; render();
    try { const r = await POST(`/api/admin/documents/${encodeURIComponent(S.edit.code)}/draft-questions`); S.edit.draft.questions.push(...r.questions); S.edit.localDirty = true; toast(`Added ${plural(r.questions.length, "question")}. Check each answer, then save.`); }
    catch (err) { fail(err); }
    S.aiBusy = false; render();
  },

  /* settings */
  "start-preview": () => go(`#/preview/${encodeURIComponent(document.getElementById("pv-pos").value)}`),
  "dept-add": () => { S.cfgEdit.departments.push({ id: "new-" + Date.now(), name: "New department" }); render(); },
  "dept-del": (t, ds) => { S.cfgEdit.departments.splice(Number(ds.i), 1); render(); },
  "pos-add": (t, ds) => { S.cfgEdit.positions.push({ id: "new-" + Date.now(), name: "New position", dept: ds.d }); render(); },
  "pos-del": (t, ds) => { S.cfgEdit.positions.splice(Number(ds.i), 1); render(); },
  "cfg-reset": () => { S.cfgEdit = P.clone(S.data["m-settings"]); render(); },
};

function offerCopy(text, where) {
  S.copyText = { text, where, note: "Copied. Paste it into WhatsApp." };
  const fallback = () => { S.copyText.note = "Select the text below and copy it."; render(); const b = document.getElementById("copybox"); if (b) { b.focus(); b.select(); } };
  try { navigator.clipboard.writeText(text).then(() => { toast("Copied to clipboard"); render(); }, fallback); } catch { fallback(); }
}
function showErr(id, err) { const el = document.getElementById(id); if (el) el.textContent = err.message; else fail(err); }

async function saveDoc(quiet) {
  const e = S.edit; S.busy = true;
  try {
    const d = await PUT(`/api/admin/documents/${encodeURIComponent(S.params.id)}`, { draft: e.draft, code: e.code, kind: e.kind });
    const change = e.change; P.setEdit(d); S.edit.change = change;
    if (d.code !== S.params.id) { S.params.id = d.code; history.replaceState(null, "", `#/m/doc/${encodeURIComponent(d.code)}`); }
  } catch (err) { S.busy = false; if (!quiet) showErr("ed-err", err); throw err; }
  S.busy = false; render();
}

/* ---------- forms ---------- */
document.addEventListener("submit", async e => {
  const f = e.target.closest("[data-form]"); if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  try { await (FORMS[kind] || (() => {}))(f); } catch (err) { S.busy = false; fail(err); render(); }
});
const FORMS = {
  login: () => P.doLogin(),
  "client-code": () => P.chooseClient(),
  "course-new": async () => {
    const e = S.courseEdit;
    try {
      const r = await POST("/api/admin/courses", { draft: { title: e.title, description: e.description, audience: { all: true, positions: [] }, modules: [{ title: `${P.term("module")} 1`, lessons: [] }] } });
      S.courseEdit = null; location.hash = `#/m/course/${encodeURIComponent(r.id)}`;
    } catch (err) { const el = document.getElementById("course-err"); if (el) el.textContent = err.message; else fail(err); }
  },
  course: () => saveCourse(true),
  quiz: async () => {
    const dv = S.docv, d = dv.data.doc;
    const answers = d.questions.map((q, i) => dv.quiz.answers[i] ?? null);
    if (answers.some(a => a == null)) { toast("Answer every question first.", "bad"); return; }
    S.busy = true; P.refreshGates();
    try {
      const r = await POST(`/api/my/documents/${encodeURIComponent(d.code)}/attempts`, { versionId: d.versionId, answers });
      dv.quiz.result = r.result; dv.data.state = r.state;
    } catch (err) { if (!P.staleCheck(err)) fail(err); }
    S.busy = false; render();
    const res = document.querySelector(".result"); if (res) res.scrollIntoView({ behavior: "smooth", block: "center" });
  },
  sign: async () => {
    const dv = S.docv, d = dv.data.doc;
    S.busy = true; P.refreshGates();
    try {
      await POST(`/api/my/documents/${encodeURIComponent(d.code)}/signoff`, { versionId: d.versionId, agree: !!dv.ack.agree, typedName: dv.ack.name });
      toast("Signed. Thank you.");
      S.busy = false; await P.refreshDoc("done"); window.scrollTo(0, 0);
    } catch (err) { S.busy = false; if (!P.staleCheck(err)) showErr("ack-err", err); P.refreshGates(); }
  },
  declaration: async () => {
    S.busy = true; P.refreshGates();
    try {
      await POST("/api/my/declaration", { agree: !!S.decl.agree, typedName: S.decl.name, signature: P.sigPng() });
      S.decl = null; S.busy = false; toast("Declaration signed."); go("#/record");
    } catch (err) { S.busy = false; showErr("decl-err", err); P.refreshGates(); }
  },
  "staff-new": async () => {
    const e = S.staffEdit; S.busy = true; render();
    try {
      const r = await POST("/api/admin/staff", { name: e.name, staffNo: e.staffNo, positionId: e.positionId, startDate: e.startDate || null, role: e.role, pin: e.pin });
      S.busy = false; toast(`${e.name} added. Their PIN is ${e.pin}. Give it to them now.`); go(`#/m/staff/${r.id}`);
    } catch (err) { S.busy = false; render(); showErr("se-err", err); }
  },
  "staff-edit": async () => {
    const e = S.staffEdit; S.busy = true; render();
    try {
      const r = await PATCH(`/api/admin/staff/${e.id}`, { name: e.name, staffNo: e.staffNo, positionId: e.positionId, startDate: e.startDate || null, role: e.role });
      S.busy = false; toast(r.changed.length ? (r.changed.includes("position") ? "Saved. Their course now follows the new position." : "Saved.") : "No changes to save.");
      if (e.id === S.me.id) await P.loadMe();
      load();
    } catch (err) { S.busy = false; render(); showErr("se-err", err); }
  },
  pin: async () => {
    const p = S.data["m-person"].person;
    if (!/^\d{4,6}$/.test(S.pinReset.pin)) { toast("The PIN must be 4 to 6 digits.", "bad"); return; }
    await POST(`/api/admin/staff/${p.id}/pin`, { pin: S.pinReset.pin });
    toast(`New PIN for ${p.name}: ${S.pinReset.pin}. Give it to them now.`); S.pinReset = null; load();
  },
  newdoc: async () => {
    S.busy = true; render();
    try {
      const d = await POST("/api/admin/documents", { kind: S.newDoc.kind, code: S.newDoc.code || undefined });
      S.busy = false; S.newDoc = null; P.setEdit(d); go(`#/m/doc/${encodeURIComponent(d.code)}`);
    } catch (err) { S.busy = false; render(); showErr("nd-err", err); }
  },
  config: async () => {
    const c = S.cfgEdit; S.busy = true; render();
    try {
      await PUT("/api/admin/config", { orgName: c.orgName, courseTitle: c.courseTitle, declarationText: c.declarationText, departments: c.departments.map(d => ({ id: d.id, name: d.name })), positions: c.positions.map(p => ({ id: p.id, name: p.name, dept: p.dept })) });
      await P.loadMe(); S.busy = false; toast("Settings saved."); load();
    } catch (err) { S.busy = false; render(); fail(err); }
  },
};

/* ---------- navigation guard for unsaved edits ---------- */
let lastHash = location.hash;
window.addEventListener("hashchange", () => {
  if (S.platformMode) { if (window.PelPlat) window.PelPlat.route(); return; }
  if (S.view === "m-edit" && S.edit && S.edit.localDirty && !location.hash.startsWith(`#/m/doc/${encodeURIComponent(S.edit.code)}`) && !location.hash.startsWith("#/preview/")) {
    const target = location.hash;
    history.replaceState(null, "", lastHash);
    confirmBox("Leave without saving?", "Your changes to this document haven't been saved.", "Leave", () => { S.edit.localDirty = false; lastHash = target; location.hash = target; }, true);
    return;
  }
  lastHash = location.hash;
  P.route();
});
window.addEventListener("beforeunload", e => { if (S.edit && S.edit.localDirty) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- course builder helpers ---------- */
function cbLesson(ds) { return S.courseEdit.draft.modules[Number(ds.i)].lessons[Number(ds.j)]; }
async function saveCourse(showToast) {
  const e = S.courseEdit;
  try {
    const toSec = t => { const m = String(t ?? "").trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+)$/); if (!m) return 0; return m[4] ? Number(m[4]) : (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])); };
    const draft = { ...e.draft, modules: e.draft.modules.map(m => ({ ...m, lessons: m.lessons.map(l => l.type === "video" ? { ...l, chapters: (l.chapters || []).map(c => ({ at: c.time !== undefined ? toSec(c.time) : c.at, label: c.label })),
      ...(l.source === "youtube" ? { durationSec: l.durationText !== undefined ? toSec(l.durationText) : l.durationSec } : {}) } : l) })) };
    const r = await PUT(`/api/admin/courses/${encodeURIComponent(e.id)}`, { draft });
    e.dirty = false; e.problems = r.problems; e.draftDirty = r.draftDirty; e.saveError = null;
    if (showToast) { toast("Saved."); await load(); }
    return true;
  } catch (err) { e.saveError = err.message; render(); toast("Not saved: see the message at the top."); window.scrollTo(0, 0); return false; }
}

/* ---------- start ---------- */
// The platform admin screens (platform.js) and the course player (learn.js) add their own clicks and forms here.
P.addActions = o => Object.assign(ACTIONS, o);
P.addForms = o => Object.assign(FORMS, o);
document.addEventListener("DOMContentLoaded", async function boot() {
  if (S.platformMode) { if (window.PelPlat) await window.PelPlat.boot(); return; }
  if (!S.newDoc) S.newDoc = null;
  await P.loadBranding();
  try { await P.loadMe(); } catch { S.me = null; }
  if (S.me && location.hash.startsWith("#/m/doc/new")) { try { S.newDoc = { kind: "sop", code: (await GET("/api/admin/next-code?kind=sop")).code }; } catch {} }
  P.route();
});
window.addEventListener("hashchange", () => { if (S.platformMode) return; if (S.me && location.hash === "#/m/doc/new" && (!S.newDoc || !S.newDoc.code)) { GET("/api/admin/next-code?kind=sop").then(r => { S.newDoc = { kind: "sop", code: r.code }; render(); }).catch(() => {}); } });
})();

/* ---------- YouTube in the builder ---------- */
// The preview reports the video's length: fill it in if the author hasn't.
window.PelYTDuration = (lessonId, sec) => {
  const e = window.Pel.S.courseEdit; if (!e || !e.draft) return;
  for (const m of e.draft.modules) for (const l of m.lessons) if (l.id === lessonId && !l.durationText) {
    l.durationText = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; e.dirty = true;
    const box = document.querySelector(`.yt-preview[data-lesson="${lessonId}"]`), inp = box && box.parentElement.querySelector('input[data-bind$=".durationText"]');
    if (inp) inp.value = l.durationText;
  }
};
// A pasted link shows its preview once the field is left.
document.addEventListener("focusout", ev => { if (ev.target.dataset && ev.target.dataset.rerenderBlur) window.Pel.render(); });
