// YouTube videos inside the platform. The official player is loaded only when a page needs it, in
// privacy-enhanced mode (youtube-nocookie.com). Learners never leave the platform: the player is covered
// by a transparent shield and driven by MSP Academy's own controls (see learn.js), so the YouTube title,
// logo, timeline and end-of-video suggestions can't be clicked.
(function () {
"use strict";
let apiPromise = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error("YouTube could not be reached.")); };
    document.head.appendChild(s);
  });
  return apiPromise;
}
const PLAYER_VARS = { rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, origin: location.origin };

/** Create a player in element `el` for video `id`. Resolves to the YT.Player once it's ready. */
async function player(el, id, { controls = false, events = {} } = {}) {
  const YT = await loadApi();
  return new Promise(resolve => {
    const p = new YT.Player(el, { videoId: id, host: "https://www.youtube-nocookie.com", width: "100%", height: "100%",
      playerVars: { ...PLAYER_VARS, controls: controls ? 1 : 0, disablekb: controls ? 0 : 1, fs: 0 },
      events: { ...events, onReady: e => { resolve(p); if (events.onReady) events.onReady(e); } } });
  });
}

/** The builder's preview: shows the video and fills in its length if it's still empty. */
function mountPreviews() {
  document.querySelectorAll(".yt-preview[data-yt]:not([data-mounted])").forEach(async box => {
    box.setAttribute("data-mounted", "1");
    const inner = document.createElement("div"); box.appendChild(inner);
    try {
      const p = await player(inner, box.dataset.yt, { controls: true });
      let tries = 0;
      const read = () => {
        const d = Math.round(p.getDuration() || 0);
        if (!d && tries++ < 8) return setTimeout(read, 700);
        const cb = window.PelYT.onDuration || window.PelYTDuration; // set by events.js, which loads first
        if (d && cb) cb(box.dataset.lesson, d);
      };
      read();
    } catch (e) { box.innerHTML = `<p class="muted" style="padding:12px">${e.message}</p>`; }
  });
}

window.PelYT = { loadApi, player, mountPreviews, onDuration: null };
})();
