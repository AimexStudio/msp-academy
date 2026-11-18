// Taking a course: the course page, the lesson player and the certificate.
(function () {
"use strict";
const P = window.Pel;
const { S, esc, md, fmtDate, plural } = P;
const TYPE = { text: "Read", video: "Watch", pdf: "Read the PDF", quiz: "Quiz", document: "Read & sign" };
const ICON = { text: "¶", video: "▶", pdf: "⎙", quiz: "?", document: "✎" };
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
  else if (l.type === "video") body = `<div class="card pad stack" style="gap:12px"><video id="lc-video" controls playsinline preload="metadata" src="/api/files/${esc(l.fileId)}" style="width:100%;border-radius:10px;background:#000"></video>
      ${done ? "" : `<p class="muted" style="font-size:.9rem" id="lc-video-hint">Watch to the end to continue.</p>`}</div>
    <div class="row">${done ? nextBtn : `<button type="button" class="btn primary" data-act="lc-done" id="lc-video-done" disabled>I've watched it</button>`}</div>`;
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
    const d = S.data[S.view];
    try { const r = await P.POST(url(`/lessons/${encodeURIComponent(S.params.lesson)}/done`), { versionId: d.course.versionId }); refreshWith(r); goNext(r); }
    catch (e) { if (e.status === 409) { P.toast(e.message); P.load(); } else P.fail(e); }
  },
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
document.addEventListener("change", e => {
  const ds = e.target.dataset || {};
  if (ds.change !== "lc-answer" || !S.lc) return;
  S.lc.answers[Number(ds.k)] = Number(ds.n); S.lc.result = null; P.render();
});
// A video lesson can be finished only once the video has played to the end.
document.addEventListener("ended", e => {
  if (e.target.id !== "lc-video") return;
  const b = document.getElementById("lc-video-done"), h = document.getElementById("lc-video-hint");
  if (b) b.disabled = false; if (h) h.textContent = "Done watching. You can continue.";
}, true);

window.PelLearn = { coursesSection, vCourse, vLesson, vCert };
})();
