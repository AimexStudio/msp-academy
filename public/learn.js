// Taking a course: the course page, the lesson player and the certificate.
(function () {
"use strict";
const P = window.Pel;
const { S, esc, md, fmtDate, plural } = P;
const TYPE = { text: "Read", video: "Watch", pdf: "Read the PDF", checklist: "Checklist", quiz: "Quiz", signoff: "Sign", evidence: "Show your work", document: "Read & sign" };
const ICON = { text: "¶", video: "▶", pdf: "⎙", checklist: "☑", quiz: "?", signoff: "✍", evidence: "📷", document: "✎" };
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const lessons = c => c.modules.flatMap(m => m.lessons.map(l => ({ ...l, moduleTitle: m.title })));

/** The courses block on My training. */
function coursesSection(list) {
  if (!list || !list.length) return "";
  const T = P.term;
  return `<section class="stack" style="gap:10px"><div class="section-title"><h2>${esc(T("courses"))}</h2><span class="muted tnum" style="font-size:.88rem">${list.filter(c => c.completedAt).length} of ${list.length} completed</span></div>
    <div class="course-cards">${list.map(c => { const pct = c.total ? Math.round(c.done / c.total * 100) : 0;
      return `<a class="card course-card ${c.completedAt ? "complete" : ""}" href="#/course/${encodeURIComponent(c.id)}"><div class="cc-top"><span class="eyebrow">${c.completedAt ? "Completed" : c.retake ? "New version: take it again" : c.done ? "In progress" : "Not started"}</span>${c.completedAt ? '<span class="chip ok">Certificate</span>' : ""}</div>
        <h3>${esc(c.title)}</h3>${c.description ? `<p class="muted">${esc(c.description)}</p>` : ""}
        <div class="cc-meta muted">${plural(c.modules, T("module").toLowerCase())} · ${plural(c.total, "lesson")}</div>
        <div class="row" style="gap:10px;flex-wrap:nowrap"><div class="progress" style="flex:1"><span style="width:${pct}%"></span></div><span class="tnum muted" style="font-size:.84rem">${c.done}/${c.total}</span></div></a>`; }).join("")}</div></section>`;
}

function vCourse(d) {
  const c = d.course, pr = d.progress, all = lessons(c), T = P.term;
  const next = all.find(l => l.state.status === "open");
  let n = 0;
  return `<main class="wrap gutter stack" style="gap:22px"><a class="back" href="#/home">← My training</a>
    <section class="course-hero card pad stack" style="gap:10px"><span class="eyebrow">${esc(T("course"))} · version ${esc(c.label)}</span><h1>${esc(c.title)}</h1>${c.description ? `<p class="muted">${esc(c.description)}</p>` : ""}
      <div class="row" style="gap:12px;flex-wrap:nowrap;max-width:520px"><div class="progress" style="flex:1"><span style="width:${pr.total ? Math.round(pr.done / pr.total * 100) : 0}%"></span></div><span class="tnum muted">${pr.done} of ${pr.total} lessons</span></div>
      ${pr.retake ? `<div class="notice info">This ${esc(T("course").toLowerCase())} has a new version. Take it again to get an up-to-date certificate.</div>` : ""}
      ${pr.completion ? `<div class="row"><a class="btn primary" href="#/course/${encodeURIComponent(c.id)}/certificate">View certificate</a><span class="muted">Completed ${fmtDate(pr.completion.at)}</span></div>`
        : pr.allDone ? `<div class="row"><button type="button" class="btn primary" data-act="lc-cert">Get my certificate</button></div>`
        : next ? `<div class="row"><a class="btn primary" href="#/course/${encodeURIComponent(c.id)}/${encodeURIComponent(next.id)}">${pr.done ? "Continue" : "Start"}</a></div>` : ""}</section>
    ${c.modules.map((m, mi) => `<section class="stack" style="gap:8px"><div class="section-title"><h2>${esc(T("module"))} ${mi + 1} · ${esc(m.title)}</h2></div><ol class="course card">${m.lessons.map(l => { n++; const st = l.state.status;
      return `<li class="ci ${st === "done" ? "done" : ""} ${st === "locked" ? "locked" : ""}"><span class="ci-num tnum" aria-hidden="true">${st === "done" ? "✓" : n}</span><div style="min-width:0"><div class="ci-code">${ICON[l.type]} ${esc(TYPE[l.type])}${l.type === "document" ? ` · ${esc(l.code)}` : ""}</div><div class="ci-title">${esc(l.title || l.code)}</div>${l.state.notRequired ? '<div class="ci-meta">Not required for your position</div>' : ""}</div>
        <div class="ci-side">${st === "done" ? '<span class="chip ok">Done</span>' : st === "locked" ? '<span class="chip">Locked</span>' : '<span class="chip info">Next</span>'}${st !== "locked" ? `<a class="btn sm ${st === "open" ? "primary" : ""}" href="#/course/${encodeURIComponent(c.id)}/${encodeURIComponent(l.id)}">${st === "done" ? "Review" : "Open"}</a>` : ""}</div></li>`; }).join("")}</ol></section>`).join("")}
  </main>`;
}

function vLesson(d) {
  const c = d.course, all = lessons(c), id = S.params.lesson;
  const i = all.findIndex(l => l.id === id), l = all[i];
  if (!l) return `<main class="wrap gutter"><div class="card empty"><h3>Lesson not found</h3><a class="btn" href="#/course/${encodeURIComponent(c.id)}">Back</a></div></main>`;
  const st = l.state.status, done = st === "done", next = all[i + 1];
  const back = `#/course/${encodeURIComponent(c.id)}`;
  const nextBtn = next ? `<a class="btn primary" href="${back}/${encodeURIComponent(next.id)}">Next lesson</a>` : `<a class="btn primary" href="${back}">Finish</a>`;
  let body = "";
  if (st === "locked") body = `<div class="card empty"><h3>Not yet</h3><p>Finish the lessons before this one first.</p><a class="btn" href="${back}">Back</a></div>`;
  else if (l.type === "text") body = `<article class="card pad doc">${md(l.body || "")}</article><div class="row">${done ? nextBtn : `<button type="button" class="btn primary" data-act="lc-done">I've read this</button>`}</div>`;
  else if (l.type === "video") {
    // Watch rules: the server counts what was really played; the page also stops skipping ahead and pauses when hidden.
    const w = l.state.watched || 0;
    S.lv = { lesson: l.id, versionId: c.versionId, noSkip: l.noSkipAhead !== false, pauseHidden: l.pauseWhenHidden !== false, need: l.minWatchPct || 0,
      maxPos: w, segStart: null, lastPos: 0, cp: S.lv && S.lv.lesson === l.id ? S.lv.cp : null, watched: w, duration: 0, failed: l.state.failed };
    const ready = done || l.state.failed || !S.lv.need;
    body = `<div class="card pad stack" style="gap:12px"><video id="lc-video" controls playsinline preload="metadata" controlslist="nodownload noplaybackrate" disablepictureinpicture src="/api/files/${esc(l.fileId)}" style="width:100%;border-radius:10px;background:#000"></video>
      ${l.chapters && l.chapters.length ? `<div class="lc-chapters">${l.chapters.map(ch => `<button type="button" class="btn sm" data-act="lc-seek" data-at="${ch.at}" ${!done && S.lv.noSkip && ch.at > w + 1 ? "disabled" : ""}>${mmss(ch.at)} · ${esc(ch.label)}</button>`).join("")}</div>` : ""}
      ${done ? "" : `<div class="lc-watch"><div class="progress"><span id="lc-watch-bar" style="width:0%"></span></div><span class="muted tnum" id="lc-watch-text">${S.lv.need ? `Watch at least ${S.lv.need}%` : "Watching is optional"}${S.lv.noSkip ? " · skipping ahead is off" : ""}</span></div>
        <p class="muted" style="font-size:.84rem;margin:0">Can't play the video on this device? <button type="button" class="linkish" data-act="lc-vfail">Let your manager know and continue</button></p>`}</div>
    ${l.checkpoint && !done ? `<fieldset class="card pad quiz-q" id="lc-cp" ${ready ? "" : "hidden"}><legend class="q-text">${esc(l.checkpoint.q)}</legend>
        ${l.checkpoint.options.map((o, n) => `<label class="opt"><input type="radio" name="lc-cp" data-change="lc-cp" data-n="${n}" ${S.lv.cp === n ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}</fieldset>` : ""}
    <p class="err" id="lc-err" role="alert"></p>
    <div class="row">${done ? nextBtn : `<button type="button" class="btn primary" data-act="lc-done" id="lc-video-done" ${ready && (!l.checkpoint || S.lv.cp !== null) ? "" : "disabled"}>${l.checkpoint ? "Check my answer" : "Continue"}</button>`}</div>`;
  }
  else if (l.type === "pdf") body = `<div class="card pad stack" style="gap:12px"><p>Open the PDF and read it through.</p><div class="row"><a class="btn" href="/api/files/${esc(l.fileId)}" target="_blank" rel="noopener" data-act="lc-pdf-open">Open the PDF</a></div></div>
    <div class="row">${done ? nextBtn : `<button type="button" class="btn primary" data-act="lc-done" id="lc-pdf-done" ${S.lc && S.lc.pdfOpened === l.id ? "" : "disabled"}>I've read it</button>`}</div>`;
  else if (l.type === "quiz") {
    const q = S.lc && S.lc.lesson === l.id && S.lc.answers.length === l.questions.length ? S.lc : (S.lc = { ...(S.lc || {}), lesson: l.id, answers: l.questions.map(() => null), result: null });
    const res = q.result;
    body = done && !res ? `<div class="card pad"><p><strong>Passed.</strong> ${l.state.lastScore != null ? `Your score: ${l.state.lastScore}%.` : ""}</p></div><div class="row">${nextBtn}</div>`
      : `<form data-form="lc-quiz" class="stack" style="gap:14px"><p class="muted">You need ${esc(l.passMark)}% to pass. You can try again if you don't.</p>${l.questions.map((x, k) => `<fieldset class="card pad quiz-q ${res && res.wrong.includes(k) ? "wrong" : ""}"><legend class="q-text">${k + 1}. ${esc(x.q)}</legend>
          ${x.options.map((o, n) => `<label class="opt ${q.answers[k] === n ? "sel" : ""}"><input type="radio" name="lq-${k}" data-change="lc-answer" data-k="${k}" data-n="${n}" ${q.answers[k] === n ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}</fieldset>`).join("")}
        ${res ? `<div class="notice ${res.passed ? "ok" : "bad"}">${res.passed ? `Passed with ${res.score}%.` : `${res.score}%. You need ${res.passMark}% to pass. The questions marked in red were wrong. Try again.`}</div>` : ""}
        <div class="row">${res && res.passed ? nextBtn : `<button type="submit" class="btn primary" ${q.answers.every(a => a !== null) ? "" : "disabled"}>Check my answers</button>`}</div></form>`;
  } else if (l.type === "checklist") {
    const ck = S.lck && S.lck.lesson === l.id ? S.lck : (S.lck = { lesson: l.id, checked: [] });
    body = `<div class="card pad stack" style="gap:12px">${l.summary ? `<p>${esc(l.summary)}</p>` : ""}
      ${l.steps.map((st, k) => `<label class="check lc-step ${done || ck.checked.includes(k) ? "on" : ""}"><input type="checkbox" data-change="lc-step" data-k="${k}" ${done || ck.checked.includes(k) ? "checked" : ""} ${done ? "disabled" : ""}><span><span class="tnum muted">${k + 1}.</span> ${esc(st)}</span></label>`).join("")}</div>
      <p class="err" id="lc-err" role="alert"></p>
      <div class="row">${done ? nextBtn : `<button type="button" class="btn primary" data-act="lc-check" ${ck.checked.length === l.steps.length ? "" : "disabled"}>I confirm I follow every step</button>`}</div>`;
  } else if (l.type === "signoff") {
    const sg = S.lsg && S.lsg.lesson === l.id ? S.lsg : (S.lsg = { lesson: l.id, agree: false, name: "" });
    body = `<div class="card pad stack" style="gap:12px">${l.code ? `<span class="mono muted">${esc(l.code)}</span>` : ""}<blockquote class="lc-statement">${esc(l.statement)}</blockquote>
      ${done ? `<p class="muted">You signed this.</p>` : `<label class="check"><input type="checkbox" data-bind="lsg.agree" ${sg.agree ? "checked" : ""}><span>I agree</span></label>
      <div class="field" style="max-width:420px"><label for="lc-name">Type your full name to sign</label><input id="lc-name" type="text" autocomplete="off" data-bind="lsg.name" value="${esc(sg.name)}"><span class="hint">As it appears on your profile: ${esc(S.me ? S.me.name : "")}</span></div>`}</div>
      <p class="err" id="lc-err" role="alert"></p>
      <div class="row">${done ? nextBtn : `<button type="button" class="btn primary" data-act="lc-sign">Sign</button>`}</div>`;
  } else if (l.type === "evidence") {
    const ev = l.state.evidence, pending = ev && ev.status === "pending";
    const fe = S.lev && S.lev.lesson === l.id ? S.lev : (S.lev = { lesson: l.id, text: "", photo: null, busy: false });
    const form = `<div class="field"><label for="lc-ev">Your answer</label><textarea id="lc-ev" rows="4" data-bind="lev.text" placeholder="${esc(l.placeholder || "")}">${esc(fe.text)}</textarea></div>
      ${l.photo !== "none" ? `<div class="field"><span class="lbl">Photo${l.photo === "required" ? "" : " (optional)"}</span><input type="file" accept="image/jpeg,image/png" capture="environment" data-change="lc-photo">${fe.photo ? `<img class="lc-ev-preview" src="${fe.photo}" alt="Your photo"><span class="hint"><strong>Photo added.</strong> Choose another to replace it.</span>` : `<span class="hint">A photo from your phone's camera is fine.</span>`}</div>` : ""}
      <p class="err" id="lc-err" role="alert"></p>
      <div class="row"><button type="button" class="btn primary" data-act="lc-evidence" ${fe.busy ? "disabled" : ""}>${fe.busy ? "Sending…" : "Send to my manager"}</button></div>`;
    body = `<div class="card pad stack" style="gap:12px"><p>${esc(l.prompt)}</p>
      ${done ? `<div class="notice ok">Your manager approved this.</div>`
        : pending ? `<div class="notice info">Sent ${fmtDate(ev.submittedAt)}. Waiting for your manager's review. You can carry on with the next lessons meanwhile.</div><p class="muted">${esc(ev.text)}</p>`
        : `${ev && ev.status === "rejected" ? `<div class="notice bad">Your manager returned this${ev.note ? `: ${esc(ev.note)}` : "."} Please send it again.</div>` : ""}${form}`}</div>
      ${done || pending ? `<div class="row">${nextBtn}</div>` : ""}`;
  } else if (l.type === "document") body = `<div class="card pad stack" style="gap:10px"><span class="mono muted">${esc(l.code)}</span><p>${l.state.notRequired ? "This document isn't required for your position, so this lesson counts as done." : done ? "You have signed the current version." : l.state.signedOlder ? "This document was updated. Read and sign the new version." : "Read it, answer its questions and sign it. You'll come back here afterwards."}</p>
      ${l.state.notRequired ? "" : `<div class="row"><a class="btn ${done ? "" : "primary"}" href="#/doc/${encodeURIComponent(l.code)}" data-act="lc-doc" data-back="${esc(location.hash)}">${done ? "Open it" : "Read & sign"}</a></div>`}</div>
    ${done ? `<div class="row">${nextBtn}</div>` : ""}`;
  const pct = Math.round(((i + (done ? 1 : 0)) / all.length) * 100);
  return `<main class="wrap gutter stack" style="gap:18px;max-width:900px"><div class="row between"><a class="back" href="${back}">← ${esc(c.title)}</a><span class="muted tnum" style="font-size:.86rem">Lesson ${i + 1} of ${all.length}</span></div>
    <div class="progress thin"><span style="width:${pct}%"></span></div>
    <div class="stack" style="gap:4px"><span class="eyebrow">${esc(l.moduleTitle)} · ${esc(TYPE[l.type])}</span><h1>${esc(l.title || l.code)}</h1></div>
    ${body}</main>`;
}

function vCert(d) {
  const c = d.certificate;
  return `<main class="wrap gutter stack" style="gap:16px"><div class="row between no-print"><a class="back" href="#/course/${encodeURIComponent(S.params.id)}">← Back</a><button type="button" class="btn sm" data-act="print">Print</button></div>
    <article class="course-cert"><div class="cc-mark">${S.brand && S.brand.logoUrl ? `<img src="${esc(S.brand.logoUrl)}" alt="">` : `<span>${esc(S.brand ? S.brand.wordmark : c.orgName)}</span>`}</div>
      <p class="eyebrow">Certificate of completion</p><h1>${esc(c.name)}</h1><p>${esc(c.positionName || "")}${c.staffNo ? ` · ${esc(c.staffNo)}` : ""}</p>
      <p class="cc-line">has completed</p><h2>${esc(c.title)}</h2><p class="muted">Version ${esc(c.label)} · ${plural(c.lessons, "lesson")}</p>
      <div class="cc-foot"><div><span class="muted">Completed</span><strong>${fmtDate(c.at)}</strong></div><div><span class="muted">Organisation</span><strong>${esc(c.orgName)}</strong></div><div><span class="muted">Reference</span><strong class="mono">${esc(c.reference)}</strong></div></div>
      <p class="muted cc-note">Part of ${esc(c.name)}'s tamper-evident training record · <img class="cc-powered" src="/brand/msp-academy.svg" alt="MSP Academy"></p></article></main>`;
}

/* ---------- clicks ---------- */
const url = (s = "") => `/api/my/courses/${encodeURIComponent(S.params.id)}${s}`;
function refreshWith(r) { S.data[S.view] = { ...S.data[S.view], course: r.course, progress: r.progress }; P.render(); }
function goNext(r) {
  if (r.progress.completion && r.progress.done === r.progress.total) { P.toast("Completed. Your certificate is ready."); location.hash = `#/course/${encodeURIComponent(S.params.id)}`; return; }
  const all = lessons(r.course), i = all.findIndex(l => l.id === S.params.lesson), next = all[i + 1];
  location.hash = next ? `#/course/${encodeURIComponent(S.params.id)}/${encodeURIComponent(next.id)}` : `#/course/${encodeURIComponent(S.params.id)}`;
}
P.addActions({
  "lc-done": async () => {
    const d = S.data[S.view], l = currentLesson();
    if (l && l.type === "video") await flushVideo();
    try { const r = await P.POST(url(`/lessons/${encodeURIComponent(S.params.lesson)}/done`), { versionId: d.course.versionId, ...(l && l.type === "video" && l.checkpoint ? { checkpoint: S.lv.cp } : {}) }); refreshWith(r); goNext(r); }
    catch (e) { showErr(e); }
  },
  "lc-check": async () => {
    const d = S.data[S.view];
    try { const r = await P.POST(url(`/lessons/${encodeURIComponent(S.params.lesson)}/done`), { versionId: d.course.versionId, checked: S.lck.checked }); refreshWith(r); goNext(r); }
    catch (e) { showErr(e); }
  },
  "lc-sign": async () => {
    const d = S.data[S.view];
    try { const r = await P.POST(url(`/lessons/${encodeURIComponent(S.params.lesson)}/done`), { versionId: d.course.versionId, agree: !!S.lsg.agree, typedName: S.lsg.name }); S.lsg = null; refreshWith(r); goNext(r); }
    catch (e) { showErr(e); }
  },
  "lc-evidence": async () => {
    const d = S.data[S.view], fe = S.lev; fe.busy = true; P.render();
    try { const r = await P.POST(url(`/lessons/${encodeURIComponent(S.params.lesson)}/evidence`), { versionId: d.course.versionId, text: fe.text, photo: fe.photo }); S.lev = null; refreshWith(r); P.toast("Sent to your manager."); }
    catch (e) { fe.busy = false; P.render(); showErr(e); }
  },
  "lc-seek": (t, ds) => { const v = document.getElementById("lc-video"); if (!v || !S.lv) return; const at = Number(ds.at); if (S.lv.noSkip && at > S.lv.maxPos + 1) return; v.currentTime = at; v.play().catch(() => {}); },
  "lc-vfail": async () => { await reportVideo([], true); P.toast("Noted. You can continue."); const b = document.getElementById("lc-video-done"); if (b) b.disabled = !!(S.data[S.view] && currentLesson().checkpoint && S.lv.cp === null); const cp = document.getElementById("lc-cp"); if (cp) cp.hidden = false; },
  "lc-pdf-open": () => { S.lc = { ...(S.lc || {}), pdfOpened: S.params.lesson }; setTimeout(() => { const b = document.getElementById("lc-pdf-done"); if (b) b.disabled = false; }, 0); },
  "lc-doc": (t, ds) => { S.lcReturn = ds.back; },
  "lc-cert": async () => { try { refreshWith(await P.POST(url("/certificate"))); P.toast("Your certificate is ready."); } catch (e) { P.fail(e); } },
});
P.addForms({
  "lc-quiz": async () => {
    const d = S.data[S.view], q = S.lc;
    try { const r = await P.POST(url(`/lessons/${encodeURIComponent(S.params.lesson)}/quiz`), { versionId: d.course.versionId, answers: q.answers }); q.result = r.result; refreshWith(r); window.scrollTo(0, 0); }
    catch (e) { if (e.status === 409) { P.toast(e.message); P.load(); } else P.fail(e); }
  },
});
function currentLesson() { const d = S.data[S.view]; return d && d.course ? lessons(d.course).find(l => l.id === S.params.lesson) : null; }
function showErr(e) { if (e.status === 409) { P.toast(e.message); P.load(); return; } const el = document.getElementById("lc-err"); if (el) el.textContent = e.message; else P.fail(e); }
document.addEventListener("change", async e => {
  const ds = e.target.dataset || {};
  if (ds.change === "lc-answer" && S.lc) { S.lc.answers[Number(ds.k)] = Number(ds.n); S.lc.result = null; P.render(); }
  if (ds.change === "lc-step" && S.lck) { const k = Number(ds.k), c = new Set(S.lck.checked); e.target.checked ? c.add(k) : c.delete(k); S.lck.checked = [...c]; P.render(); }
  if (ds.change === "lc-cp" && S.lv) { S.lv.cp = Number(ds.n); const b = document.getElementById("lc-video-done"); const cp = document.getElementById("lc-cp"); if (b && cp && !cp.hidden) b.disabled = false; }
  if (ds.change === "lc-photo" && S.lev) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    // Phone photos are large: scale down to at most 1600 pixels before sending.
    try { S.lev.photo = await shrink(f); P.render(); } catch { const el = document.getElementById("lc-err"); if (el) el.textContent = "That photo couldn't be read. Try another."; }
  }
});
// Read the photo as a data: URL (the page's security rules allow data: images, not blob: ones), then scale it.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("unreadable"));
    fr.onload = () => {
      const img = new Image();
      img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL("image/jpeg", 0.82)); };
      img.onerror = () => reject(new Error("bad image"));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------- watching a video lesson ---------- */
let videoTimer = null;
async function reportVideo(segments, failed = false) {
  if (!S.lv) return;
  try {
    const r = await P.POST(url(`/lessons/${encodeURIComponent(S.lv.lesson)}/video`), { versionId: S.lv.versionId, segments, ...(failed ? { failed: true } : {}) });
    S.lv.watched = r.watched; S.lv.duration = r.duration; if (r.failed) S.lv.failed = true; showWatch(r);
  } catch {}
}
function showWatch(r) {
  const pct = r.duration ? Math.min(100, Math.round(r.watched / r.duration * 100)) : 0;
  const bar = document.getElementById("lc-watch-bar"), txt = document.getElementById("lc-watch-text");
  if (bar) bar.style.width = `${pct}%`;
  const ok = S.lv.failed || !S.lv.need || (r.duration && r.watched >= r.duration * S.lv.need / 100 - 0.5);
  if (txt) txt.textContent = S.lv.need ? `Watched ${pct}%${ok ? " · enough to continue" : ` · ${S.lv.need}% needed`}` : `Watched ${pct}%`;
  if (ok) { const cp = document.getElementById("lc-cp"); if (cp) cp.hidden = false; const b = document.getElementById("lc-video-done"); if (b && (!cp || S.lv.cp !== null)) b.disabled = false; }
  document.querySelectorAll('[data-act="lc-seek"]').forEach(btn => { if (!S.lv.noSkip || Number(btn.dataset.at) <= S.lv.maxPos + 1) btn.disabled = false; });
}
async function flushVideo() {
  const v = document.getElementById("lc-video");
  if (!v || !S.lv || S.lv.segStart === null) return;
  const seg = [S.lv.segStart, v.currentTime]; S.lv.segStart = v.paused ? null : v.currentTime;
  if (seg[1] > seg[0] + 0.5) await reportVideo([seg]);
}
document.addEventListener("play", e => { if (e.target.id !== "lc-video" || !S.lv) return; S.lv.segStart = e.target.currentTime; S.lv.lastPos = e.target.currentTime; clearInterval(videoTimer); videoTimer = setInterval(flushVideo, 15000); }, true);
document.addEventListener("pause", e => { if (e.target.id !== "lc-video") return; clearInterval(videoTimer); flushVideo(); }, true);
document.addEventListener("ended", e => { if (e.target.id !== "lc-video") return; clearInterval(videoTimer); flushVideo(); }, true);
document.addEventListener("timeupdate", e => {
  if (e.target.id !== "lc-video" || !S.lv) return;
  const t = e.target.currentTime;
  if (!e.target.seeking && t >= S.lv.lastPos && t - S.lv.lastPos < 3) S.lv.maxPos = Math.max(S.lv.maxPos, t);
  S.lv.lastPos = t;
}, true);
document.addEventListener("seeking", e => {
  if (e.target.id !== "lc-video" || !S.lv) return;
  if (S.lv.noSkip && e.target.currentTime > S.lv.maxPos + 1) { e.target.currentTime = S.lv.maxPos; return; }
  S.lv.segStart = e.target.paused ? null : e.target.currentTime; S.lv.lastPos = e.target.currentTime;
}, true);
document.addEventListener("loadedmetadata", e => { if (e.target.id === "lc-video" && S.lv) { S.lv.duration = e.target.duration; showWatch({ watched: S.lv.watched, duration: e.target.duration }); } }, true);
document.addEventListener("error", e => { if (e.target.id === "lc-video") { const t = document.getElementById("lc-watch-text"); if (t) t.textContent = "The video didn't load. Use the link below to continue."; } }, true);
document.addEventListener("visibilitychange", () => { const v = document.getElementById("lc-video"); if (document.hidden && v && S.lv && S.lv.pauseHidden && !v.paused) v.pause(); });

window.PelLearn = { coursesSection, vCourse, vLesson, vCert };
})();
