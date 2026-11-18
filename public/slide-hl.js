/* Sliding highlight (same behaviour as the e-PP dashboard): a pill — or an underline — that moves
   under the item the pointer or keyboard focus is on, and back to the current item when the pointer leaves.
   slideHL(container, itemSelector, currentSelector, {line: true} for an underline instead of a pill).
   The pill copies each item's corner radius; its colour comes from the page's CSS (.shl). */
(function () {
  function slideHL(box, items, cur, opt) {
    if (!box || box.classList.contains("hl-on")) return;
    opt = opt || {};
    var ind = document.createElement("span");
    ind.className = "shl" + (opt.line ? " shl-line" : "");
    ind.setAttribute("aria-hidden", "true");
    box.insertBefore(ind, box.firstChild);
    box.classList.add("hl-on");
    var hov = null;
    function move(b, instant) {
      if (!b || !b.offsetWidth) { ind.style.opacity = "0"; return; }
      if (instant) ind.style.transition = "none";
      ind.style.opacity = "1";
      ind.style.width = b.offsetWidth + "px";
      if (opt.line) {
        ind.style.transform = "translate(" + b.offsetLeft + "px," + (b.offsetTop + b.offsetHeight - 2) + "px)";
      } else {
        ind.style.height = b.offsetHeight + "px";
        ind.style.borderRadius = getComputedStyle(b).borderRadius;
        ind.style.transform = "translate(" + b.offsetLeft + "px," + b.offsetTop + "px)";
      }
      if (instant) { void ind.offsetWidth; ind.style.transition = ""; }
    }
    function sync(instant) {
      if (ind.parentNode !== box) box.insertBefore(ind, box.firstChild); /* the page rebuilt the group's contents */
      move(hov || box.querySelector(cur), instant);
    }
    /* delegated: works for buttons the page re-creates later */
    function pick(t) { var b = t && t.closest ? t.closest(items) : null; return b && box.contains(b) ? b : null; }
    box.addEventListener("mouseover", function (ev) { var b = pick(ev.target); if (b && b !== hov) { hov = b; box.classList.add("hl-hov"); sync(); } });
    box.addEventListener("focusin", function (ev) { var b = pick(ev.target); if (b && b.matches(":focus-visible")) { hov = b; box.classList.add("hl-hov"); sync(); } });
    box.addEventListener("focusout", function (ev) { if (hov && hov === pick(ev.target)) { hov = null; box.classList.remove("hl-hov"); sync(); } });
    box.addEventListener("mouseleave", function () { hov = null; box.classList.remove("hl-hov"); sync(); });
    new MutationObserver(function () { if (hov && !box.contains(hov)) hov = null; sync(); }).observe(box, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["class", "hidden", "aria-current", "aria-selected", "aria-pressed"] });
    if (window.ResizeObserver) new ResizeObserver(function () { sync(true); }).observe(box);
    addEventListener("resize", function () { sync(true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { sync(true); });
    setTimeout(function () { sync(true); }, 0);
  }
  window.slideHL = slideHL;
})();

/* this dashboard */
(function () {
  function init() {
    slideHL(document.querySelector(".nav-links"), "a", "a.on", { line: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
