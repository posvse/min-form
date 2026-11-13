/* Min Form – PWA-stöd för iPhone/Safari.
 * - Registrerar service worker och visar en uppdateringsknapp när en ny version är klar.
 * - Visar installationshjälp (Dela > Lägg till på hemskärmen) när appen körs i Safari.
 * - Visar tydligt när appen är offline.
 * - Lägger till inputmode/enterkeyhint/aria-label på fält som saknar dem.
 */
(function (global) {
  "use strict";

  var ua = navigator.userAgent || "";
  var reg = null;
  var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  var reloading = false;

  function isIOS() {
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return navigator.standalone === true || (global.matchMedia && matchMedia("(display-mode: standalone)").matches);
  }
  function isSafari() {
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo/.test(ua);
  }
  function whenFlushed(fn) {
    var p = global.MFStore && MFStore.flush ? MFStore.flush() : Promise.resolve();
    Promise.resolve(p).then(fn, fn);
  }

  // ---------- Service worker och uppdatering ----------
  function offerUpdate() {
    if (document.getElementById("verBar")) return;
    var b = document.createElement("div");
    b.id = "verBar";
    b.className = "verbar";
    b.setAttribute("role", "status");
    b.appendChild(document.createTextNode("En ny version av Min Form är klar. Din data påverkas inte. "));
    var btn = document.createElement("button");
    btn.textContent = "Uppdatera";
    btn.onclick = function () { applyWaiting(); };
    b.appendChild(btn);
    document.body.appendChild(b);
  }

  function applyWaiting() {
    if (reg && reg.waiting) {
      whenFlushed(function () { reg.waiting.postMessage({ type: "SKIP_WAITING" }); });
    } else {
      whenFlushed(function () { location.reload(); });
    }
  }

  // Hämtar ny version utan att ta bort cachar eller avregistrera något.
  async function update() {
    try {
      if (reg) {
        await reg.update();
        for (var i = 0; i < 32 && !reg.waiting; i++) await new Promise(function (r) { setTimeout(r, 250); });
      }
    } catch (e) { /* offline: ladda om från cache */ }
    applyWaiting();
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").then(function (r) {
      reg = r;
      if (r.waiting && navigator.serviceWorker.controller) offerUpdate();
      r.addEventListener("updatefound", function () {
        var w = r.installing;
        if (!w) return;
        w.addEventListener("statechange", function () {
          if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate();
        });
      });
    }).catch(function () {});
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloading || !hadController) return; // första installationen ska inte ladda om sidan
      reloading = true;
      whenFlushed(function () { location.reload(); });
    });
  }

  // ---------- Installationshjälp för iPhone ----------
  var HINT_KEY = "minform_ios_hint";
  function showInstallHint() {
    if (!isIOS() || isStandalone()) return;
    try { if (localStorage.getItem(HINT_KEY) === "1") return; } catch (e) {}
    var d = document.createElement("div");
    d.className = "mf-hint";
    d.setAttribute("role", "note");
    var t = document.createElement("div");
    var h = document.createElement("b");
    h.textContent = "Installera Min Form på iPhone";
    t.appendChild(h);
    var p = document.createElement("p");
    p.style.margin = "4px 0 0";
    p.textContent = isSafari()
      ? "Tryck på Dela-knappen (rutan med pil upp) i Safari, välj Lägg till på hemskärmen och öppna sedan appen från den nya ikonen. Appen fungerar även utan installation."
      : "Öppna den här sidan i Safari, tryck på Dela och välj Lägg till på hemskärmen. Appen fungerar även utan installation.";
    t.appendChild(p);
    var x = document.createElement("button");
    x.className = "subtle";
    x.textContent = "Stäng";
    x.onclick = function () {
      try { localStorage.setItem(HINT_KEY, "1"); } catch (e) {}
      d.remove();
    };
    d.appendChild(t);
    d.appendChild(x);
    document.body.insertBefore(d, document.body.firstChild);
  }

  // ---------- Offline-läge ----------
  function offlineBadge() {
    var el = document.createElement("div");
    el.id = "mfOffline";
    el.className = "mf-offline";
    el.setAttribute("role", "status");
    el.hidden = true;
    el.textContent = "Offline. Du ser sparad data och allt du registrerar sparas i telefonen. Kopplingar och AI kräver internet.";
    document.body.appendChild(el);
    function sync() { el.hidden = navigator.onLine !== false; }
    addEventListener("online", sync);
    addEventListener("offline", sync);
    sync();
  }

  // ---------- Fält: tangentbord och tillgänglighet ----------
  function enhanceField(el) {
    var tag = el.tagName;
    if (tag === "INPUT") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "number") {
        if (!el.hasAttribute("inputmode")) el.setAttribute("inputmode", "decimal");
        if (!el.hasAttribute("autocomplete")) el.setAttribute("autocomplete", "off");
      } else if (type === "search") {
        if (!el.hasAttribute("enterkeyhint")) el.setAttribute("enterkeyhint", "search");
        if (!el.hasAttribute("autocomplete")) el.setAttribute("autocomplete", "off");
      }
      if (type === "hidden" || type === "checkbox" || type === "radio" || type === "file" || type === "button" || type === "submit") return;
    }
    if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) return;
    if (el.closest("label")) return;
    if (el.id && document.querySelector('label[for="' + (global.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]')) return;
    var name = el.getAttribute("placeholder") || el.getAttribute("title");
    if (name) el.setAttribute("aria-label", name);
  }
  function enhanceTree(root) {
    if (root.nodeType !== 1) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(root.tagName)) enhanceField(root);
    var list = root.querySelectorAll ? root.querySelectorAll("input,select,textarea") : [];
    for (var i = 0; i < list.length; i++) enhanceField(list[i]);
  }
  function watchFields() {
    enhanceTree(document.body);
    var queue = [], scheduled = false;
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { m.addedNodes.forEach(function (n) { queue.push(n); }); });
      if (scheduled || !queue.length) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        var q = queue; queue = [];
        q.forEach(enhanceTree);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    showInstallHint();
    offlineBadge();
    watchFields();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  if (document.readyState === "complete") registerSW();
  else global.addEventListener("load", registerSW);

  global.MFPwa = { update: update, isIOS: isIOS, isStandalone: isStandalone };
})(window);
