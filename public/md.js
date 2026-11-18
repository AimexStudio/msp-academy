// Markdown renderer for document text, carried over unchanged from the prototype so documents look identical.
// All text is HTML-escaped before any formatting is applied.
(function () {
"use strict";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function inlineMd(src){
  let h = esc(src);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[\s(“])\*(?!\s)([^*]+?)\*(?=$|[\s.,;:!?)”])/g, "$1<em>$2</em>");
  return h.replace(/＊/g, "*").replace(/ ¶ /g, "<br>").replace(/\\\|/g, "|");
}
function splitRow(line){
  let s = line.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = []; let cur = "";
  for (let i = 0; i < s.length; i++){ const ch = s[i]; if (ch === "\\" && s[i+1] === "|"){ cur += "\\|"; i++; continue; } if (ch === "|"){ cells.push(cur.trim()); cur = ""; continue; } cur += ch; }
  cells.push(cur.trim()); return cells;
}
const isSepRow = l => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");
function tableHtml(rows){
  let head = null, body = rows;
  if (rows.length > 1 && isSepRow(rows[1])){ head = splitRow(rows[0]); body = rows.slice(2); }
  const hasHead = head && head.some(c => c.replace(/\*/g, "").trim());
  const th = hasHead ? "<thead><tr>" + head.map(c => "<th>" + inlineMd(c.replace(/^\*\*(.*)\*\*$/, "$1")) + "</th>").join("") + "</tr></thead>" : "";
  const tb = body.filter(r => !isSepRow(r)).map(r => "<tr>" + splitRow(r).map(c => "<td>" + inlineMd(c) + "</td>").join("") + "</tr>").join("");
  return '<div class="doc-table"><table>' + th + "<tbody>" + tb + "</tbody></table></div>";
}
function md(src){
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  const out = []; let para = []; const stack = [];
  const listRe = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
  const fp = () => { if (para.length){ out.push("<p>" + inlineMd(para.join(" ")) + "</p>"); para = []; } };
  const closeTo = ind => { while (stack.length && stack[stack.length-1].ind > ind) out.push("</li></" + stack.pop().t + ">"); };
  const closeAll = () => closeTo(-1);
  for (let i = 0; i < lines.length; i++){
    const raw = lines[i], l = raw.trim(); let m;
    if (!l){ fp(); if (stack.length){ let j = i + 1; while (j < lines.length && !lines[j].trim()) j++; if (!(j < lines.length && listRe.test(lines[j]))) closeAll(); } continue; }
    if (l.startsWith("|")){ fp(); closeAll(); const rows = []; while (i < lines.length && lines[i].trim().startsWith("|")){ rows.push(lines[i]); i++; } i--; out.push(tableHtml(rows)); continue; }
    if (l.startsWith(">")){ fp(); closeAll(); const parts = []; while (i < lines.length && lines[i].trim().startsWith(">")){ parts.push(lines[i].trim().replace(/^>\s?/, "")); i++; } i--; out.push('<aside class="callout">' + parts.filter(x => x.trim()).map(inlineMd).join("<br>") + "</aside>"); continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))){ fp(); closeAll(); const t = m[2], caps = /[A-Z]/.test(t) && t === t.toUpperCase(); out.push(m[1].length === 3 ? "<h4>" + inlineMd(t) + "</h4>" : "<h3" + (caps ? ' class="caps"' : "") + ">" + inlineMd(t) + "</h3>"); continue; }
    if ((m = raw.match(listRe))){
      fp(); const ind = m[1].replace(/\t/g, "    ").length, t = /^\d/.test(m[2]) ? "ol" : "ul";
      closeTo(ind); const top = stack[stack.length-1];
      if (top && top.ind === ind){ if (top.t === t) out.push("</li><li>" + inlineMd(m[3])); else { out.push("</li></" + stack.pop().t + ">"); out.push("<" + t + "><li>" + inlineMd(m[3])); stack.push({ind, t}); } }
      else { out.push("<" + t + "><li>" + inlineMd(m[3])); stack.push({ind, t}); }
      continue;
    }
    if (stack.length && /^\s{2,}/.test(raw)){ out.push(" " + inlineMd(l)); continue; }
    closeAll(); para.push(l);
  }
  fp(); closeAll(); return out.join("");
}

window.PelMd = { md, esc };
})();
