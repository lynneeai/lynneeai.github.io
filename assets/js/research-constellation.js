/* Research Constellation — progressive enhancement for the homepage research map.
 * Reads the semantic .research-constellation markup and, on wide screens, builds
 * an interactive node-graph (hub + 4 area nodes + paper leaves).
 *  - edges run center-to-center under nodes, so boxes visually mask the overlap
 *  - hovering an area (or any of its papers) keeps the branch open (hysteresis)
 *  - auto-demo pauses on hover and resumes when the pointer leaves the graph
 *  - hub and area nodes are draggable; edges re-route live
 * Narrow screens / no-JS / reduced motion keep the readable stacked fallback. */
(function () {
  function txt(el, d) { return el && el.textContent ? el.textContent.trim() : d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function init() {
    var root = document.querySelector(".research-constellation");
    if (!root || root.dataset.rcInit) return;
    root.dataset.rcInit = "1";

    // Left→right "flow" layout: hub anchored left, areas in a left-aligned
    // column, papers blooming into a tidy right-hand column.
    var W = 880, H = 480, LEFT_X = 330, PAPER_X = 690, NS = "http://www.w3.org/2000/svg";
    var hub = {
      kicker: txt(root.querySelector(".rc-kicker"), "research map"),
      title: txt(root.querySelector(".rc-title"), ""),
      x: 140, y: 240, hw: 105, hh: 40, el: null, glow: null,
    };
    var AREA_Y = [100, 193, 287, 380];

    var areas = [].slice.call(root.querySelectorAll(".rc-area")).map(function (sec, i) {
      return {
        idx: i,
        name: sec.getAttribute("data-name") || txt(sec.querySelector(".rc-area-name"), ""),
        color: (getComputedStyle(sec).getPropertyValue("--rc-ac") || "").trim() || "currentColor",
        x: 0, y: AREA_Y[i] != null ? AREA_Y[i] : 240,
        hw: 80, hh: 24, el: null, hubPath: null,
        leaves: [].slice.call(sec.querySelectorAll("a")).map(function (a) {
          return { t: a.textContent, h: a.getAttribute("href") || "#", el: null, path: null, x: 0, y: 0, hw: 0, hh: 0, arc: 0 };
        }),
      };
    });
    if (areas.length !== 4) return; // geometry tuned for 4 areas; otherwise keep fallback

    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var wrap = null, stage = null, edges = null, scale = 1;
    var demoTimer = null, di = 0, pinned = null, clearTimer = null, built = false;
    var drag = null, moved = false, rafId = null, floatT0 = 0;

    function build() {
      if (built) return;
      built = true;
      wrap = document.createElement("div"); wrap.className = "rc-wrap";
      stage = document.createElement("div"); stage.className = "rc-stage"; wrap.appendChild(stage);
      edges = document.createElementNS(NS, "svg");
      edges.setAttribute("class", "rc-edges"); edges.setAttribute("viewBox", "0 0 " + W + " " + H);
      stage.appendChild(edges);

      hub.glow = document.createElement("div"); hub.glow.className = "rc-glow"; stage.appendChild(hub.glow);

      hub.el = document.createElement("div");
      hub.el.className = "rc-node rc-hub-node";
      var k = document.createElement("span"); k.className = "rc-k"; k.textContent = hub.kicker;
      var t = document.createElement("span"); t.className = "rc-t"; t.textContent = hub.title;
      hub.el.appendChild(k); hub.el.appendChild(t);
      stage.appendChild(hub.el);

      areas.forEach(function (a) {
        a.hubPath = document.createElementNS(NS, "path");
        a.hubPath.setAttribute("class", "rc-edge-hub");
        a.hubPath.setAttribute("stroke", a.color);
        edges.appendChild(a.hubPath);

        a.el = document.createElement("div");
        a.el.className = "rc-node rc-area-node";
        a.el.style.setProperty("--rc-ac", a.color);
        a.el.setAttribute("data-a", a.idx);
        a.el.tabIndex = 0; a.el.setAttribute("role", "button");
        a.el.setAttribute("aria-label", a.name + ", " + a.leaves.length + " topics");
        var an = document.createElement("span"); an.className = "rc-an"; an.textContent = a.name;
        var ac = document.createElement("span"); ac.className = "rc-ac";
        var dot = document.createElement("span"); dot.className = "rc-dot";
        ac.appendChild(dot); ac.appendChild(document.createTextNode(a.leaves.length + " topics"));
        a.el.appendChild(an); a.el.appendChild(ac);
        stage.appendChild(a.el);

        a.leaves.forEach(function (lf) {
          lf.el = document.createElement("a");
          lf.el.className = "rc-leaf"; lf.el.href = lf.h; lf.el.textContent = lf.t;
          lf.el.style.setProperty("--rc-ac", a.color);
          lf.el.setAttribute("data-a", a.idx); lf.el.tabIndex = -1;
          stage.appendChild(lf.el);
          lf.path = document.createElementNS(NS, "path");
          lf.path.setAttribute("class", "rc-edge-leaf");
          lf.path.setAttribute("stroke", a.color);
          edges.appendChild(lf.path);
        });
      });

      root.parentNode.insertBefore(wrap, root.nextSibling);

      // measure real node sizes now that they're in the DOM, then place + draw
      hub.hw = hub.el.offsetWidth / 2; hub.hh = hub.el.offsetHeight / 2;
      areas.forEach(function (a) {
        a.hw = a.el.offsetWidth / 2; a.hh = a.el.offsetHeight / 2;
        a.x = LEFT_X + a.hw; // left-align the area column
        a.leaves.forEach(function (lf) {
          lf.hw = lf.el.offsetWidth / 2;
          lf.hh = lf.el.offsetHeight / 2;
        });
        layoutLeaves(a);
      });
      placeHub(); areas.forEach(placeArea);

      wireNode(hub.el, hub, true);
      areas.forEach(function (a) {
        wireNode(a.el, a, false);
        a.leaves.forEach(function (lf) {
          lf.el.addEventListener("pointerenter", function () { onEnter(a.idx); });
          lf.el.addEventListener("pointerleave", onLeave);
          lf.el.addEventListener("mouseenter", function () { onEnter(a.idx); });
          lf.el.addEventListener("mouseleave", onLeave);
        });
      });
      stage.addEventListener("pointerenter", function () { if (!drag) pauseDemo(); });
      stage.addEventListener("pointerleave", function () {
        if (drag) return;
        cancelClear();
        if (pinned) { activate(pinned); } else { clearAll(); resumeDemo(); }
      });
      stage.addEventListener("mouseenter", function () { if (!drag) pauseDemo(); });
      stage.addEventListener("mouseleave", function () {
        if (drag) return;
        cancelClear();
        if (pinned) { activate(pinned); } else { clearAll(); resumeDemo(); }
      });

      fit();
      activate("0"); di = 0;
      startDemo();
      startFloat();
    }

    /* gentle float, driven in JS so the edges follow the nodes (the active /
     * dragged node holds still so its branch stays crisp). */
    function startFloat() {
      if (reduce || rafId) return;
      floatT0 = performance.now();
      rafId = requestAnimationFrame(floatTick);
    }
    function floatTick(now) {
      if (!stage) { rafId = null; return; }
      var t = (now - floatT0) / 1000;
      for (var i = 0; i < areas.length; i++) {
        var a = areas[i];
        var still = a === drag || a.el.classList.contains("rc-on");
        a.fy = still ? 0 : Math.sin(t * 0.6 + i * 1.7) * 5;
        a.el.style.top = (a.y + a.fy) + "px";
        drawHubEdge(a);
        if (still) for (var j = 0; j < a.leaves.length; j++) drawLeafEdge(a, a.leaves[j]);
      }
      rafId = requestAnimationFrame(floatTick);
    }

    /* ---- geometry / drawing ---- */
    function placeHub() {
      hub.el.style.left = hub.x + "px"; hub.el.style.top = hub.y + "px";
      hub.glow.style.left = hub.x + "px"; hub.glow.style.top = hub.y + "px";
      areas.forEach(drawHubEdge);
    }
    function layoutLeaves(a) {
      var n = a.leaves.length, rowGap = n > 3 ? 40 : 50;
      a.leaves.forEach(function (lf, j) {
        var d = j - (n - 1) / 2;
        lf.x = PAPER_X;
        lf.y = a.y + d * rowGap;
        lf.arc = d === 0 ? -12 : d * 10;
        lf.el.style.setProperty("--rc-cx", ((a.x - lf.x) * 0.5).toFixed(0) + "px");
        lf.el.style.setProperty("--rc-cy", "0px");
      });
    }
    function placeArea(a) {
      a.el.style.left = a.x + "px"; a.el.style.top = a.y + "px";
      drawHubEdge(a);
      a.leaves.forEach(function (lf) { lf.el.style.left = lf.x + "px"; lf.el.style.top = lf.y + "px"; drawLeafEdge(a, lf); });
    }
    // Smooth connector between actual node borders. The extra curvature keeps
    // the graph from reading as a rigid diagram while still preserving direction.
    function flowPath(sx, sy, ex, ey, bend, arch) {
      var dx = ex - sx, dy = ey - sy;
      var curve = bend == null ? 0.36 : bend;
      var lift = Math.max(-34, Math.min(34, dy * 0.18));
      var a = arch || 0;
      return "M" + sx + " " + sy +
        " C" + (sx + dx * curve) + " " + (sy - lift + a) +
        " " + (ex - dx * curve) + " " + (ey + lift + a) +
        " " + ex + " " + ey;
    }
    function clientToSvg(x, y) {
      var m = edges.getScreenCTM();
      if (!m) return [x, y];
      var p = edges.createSVGPoint();
      p.x = x; p.y = y;
      p = p.matrixTransform(m.inverse());
      return [p.x, p.y];
    }
    function centerPoint(el) {
      var r = el.getBoundingClientRect();
      return clientToSvg(r.left + r.width / 2, r.top + r.height / 2);
    }
    function drawHubEdge(a) {
      var s = centerPoint(hub.el);
      var e = centerPoint(a.el);
      var arch = (a.idx - 1.5) * 10;
      a.hubPath.setAttribute("d", flowPath(s[0], s[1], e[0], e[1], 0.42, arch));
    }
    function drawLeafEdge(a, lf) {
      var s = centerPoint(a.el);
      var e = centerPoint(lf.el);
      lf.path.setAttribute("d", flowPath(s[0], s[1], e[0], e[1], 0.5, lf.arc));
    }

    /* ---- activation ---- */
    function activate(id) {
      if (!stage) return;
      stage.classList.add("rc-has-active");
      areas.forEach(function (a) {
        var on = String(a.idx) === String(id);
        a.el.classList.toggle("rc-on", on);
        a.hubPath.classList.toggle("rc-on", on);
        a.leaves.forEach(function (lf) {
          lf.el.classList.toggle("rc-show", on); lf.el.tabIndex = on ? 0 : -1;
          lf.path.classList.toggle("rc-show", on);
        });
      });
      requestAnimationFrame(function () {
        areas.forEach(function (a) {
          drawHubEdge(a);
          if (String(a.idx) === String(id)) a.leaves.forEach(function (lf) { drawLeafEdge(a, lf); });
        });
      });
    }
    function clearAll() {
      if (!stage) return;
      stage.classList.remove("rc-has-active");
      areas.forEach(function (a) {
        a.el.classList.remove("rc-on"); a.hubPath.classList.remove("rc-on");
        a.leaves.forEach(function (lf) { lf.el.classList.remove("rc-show"); lf.el.tabIndex = -1; lf.path.classList.remove("rc-show"); });
      });
    }
    function onEnter(id) { cancelClear(); pauseDemo(); activate(String(id)); }
    function onLeave() {
      cancelClear();
      clearTimer = setTimeout(function () { if (pinned) activate(pinned); else clearAll(); }, 240);
    }
    function cancelClear() { if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; } }
    function togglePin(id) {
      id = String(id);
      if (pinned === id) { pinned = null; clearAll(); resumeDemo(); }
      else { pinned = id; pauseDemo(); activate(id); }
    }

    /* ---- auto demo ---- */
    function startDemo() { if (reduce || pinned || demoTimer) return; demoTimer = setInterval(tick, 2400); }
    function pauseDemo() { if (demoTimer) { clearInterval(demoTimer); demoTimer = null; } }
    function resumeDemo() { if (reduce || pinned || demoTimer) return; activate(String(di)); demoTimer = setInterval(tick, 2400); }
    function tick() { di = (di + 1) % areas.length; activate(String(di)); }

    /* ---- dragging ---- */
    function wireNode(el, node, isHub) {
      el.addEventListener("pointerdown", function (e) {
        if (e.button) return;
        drag = node; moved = false;
        node.sx = e.clientX; node.sy = e.clientY; node.x0 = node.x; node.y0 = node.y;
        if (!isHub) node.leaves.forEach(function (lf) { lf.x0 = lf.x; lf.y0 = lf.y; });
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add("rc-dragging");
        cancelClear(); pauseDemo();
        if (!isHub) activate(String(node.idx));
        e.preventDefault();
      });
      el.addEventListener("pointermove", function (e) {
        if (drag !== node) return;
        var dx = (e.clientX - node.sx) / scale, dy = (e.clientY - node.sy) / scale;
        if (Math.abs(dx * scale) > 4 || Math.abs(dy * scale) > 4) moved = true;
        if (isHub) moveHub(node.x0 + dx, node.y0 + dy);
        else moveArea(node, node.x0 + dx, node.y0 + dy);
      });
      function end(e) {
        if (drag !== node) return;
        drag = null; el.classList.remove("rc-dragging");
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        if (!moved && !isHub) togglePin(node.idx);
      }
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      if (!isHub) {
        el.addEventListener("pointerenter", function () { onEnter(node.idx); });
        el.addEventListener("pointerleave", onLeave);
        el.addEventListener("mouseenter", function () { onEnter(node.idx); });
        el.addEventListener("mouseleave", onLeave);
        el.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePin(node.idx); }
        });
        el.addEventListener("focus", function () { cancelClear(); pauseDemo(); activate(String(node.idx)); });
      }
    }
    function moveHub(nx, ny) {
      hub.x = clamp(nx, hub.hw + 6, W - hub.hw - 6);
      hub.y = clamp(ny, hub.hh + 6, H - hub.hh - 6);
      placeHub();
    }
    function moveArea(a, nx, ny) {
      var cx = clamp(nx, a.hw + 6, W - a.hw - 6), cy = clamp(ny, a.hh + 6, H - a.hh - 6);
      var ddx = cx - a.x0, ddy = cy - a.y0;
      a.x = cx; a.y = cy; a.el.style.left = cx + "px"; a.el.style.top = cy + "px";
      a.leaves.forEach(function (lf) {
        lf.x = lf.x0 + ddx; lf.y = lf.y0 + ddy;
        lf.el.style.left = lf.x + "px"; lf.el.style.top = lf.y + "px";
        drawLeafEdge(a, lf);
      });
      drawHubEdge(a);
    }

    /* ---- lifecycle ---- */
    function destroy() {
      pauseDemo(); cancelClear();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      wrap = stage = edges = null; built = false; pinned = null; drag = null; di = 0;
    }
    function fit() {
      if (!wrap || !stage) return;
      scale = Math.min(1, wrap.clientWidth / W);
      stage.style.transform = "translateX(-50%) scale(" + scale + ")";
      wrap.style.height = (H * scale) + "px";
    }
    function apply() {
      var wide = window.innerWidth >= 768;
      if (wide && !built) { root.classList.add("rc-enhanced"); build(); }
      else if (!wide && built) { root.classList.remove("rc-enhanced"); destroy(); }
      else if (wide && built) { fit(); }
    }
    apply();
    var rt;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(apply, 150); });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
