// EVALIU INK, Core only: motion picks R3-2. Page titles rise line by line ("Lines") and a light smooth
// scroll on PC ("Light"). The CSS half is motion-core.css; the page change ("Wipe") is CSS only.
// Squarespace (Core): put this file on the static host next to hero3d.js and load it from
// Settings > Advanced > Code Injection > Footer:
//   <script src="https://<static host>/motion-core.js" defer></script>
// Without this script: titles keep Squarespace's fade, scrolling stays the browser's.
// No reduced-motion fallbacks: the motion is the same for everyone (owner decision, CLAUDE.md).
// Locally this runs before sqs-animations.js (the stand-in for Squarespace's own animations), which then
// gives the split titles its fade classes as Squarespace would; motion-core.css keeps that fade off them.
(() => {
  // iPhones (Safari) often skip the :active press state on a tap unless the page listens for touches.
  // This empty passive listener is enough for every button and link to press in (scale 0.97 and the
  // like), and it never blocks or delays scrolling. If a real iPhone shows live Squarespace already
  // pressing in without it, it can go (its own scripts may add a touch listener).
  document.addEventListener('touchstart', () => {}, { passive: true });

  // ---------------------------------------------------------------------------------------------------
  // 1. Page titles: "Lines"
  // Every big title (page and section titles, not the home wordmark, not names on cards) is split into the
  // lines the browser already drew, each inside its own clip edge, and the lines slide up in reading order
  // the moment any of the title enters the window. When it is done the plain heading is put back, so
  // nothing stays split (resizing, copying, screen readers, the text editor of the preview).
  // Squarespace: Heading 1 / Heading 2 in text blocks sit inside <main id="page">, so the same selector
  // works there (confirm with Inspect). SKIP must match the list in motion-core.css (the hold rule).
  // ---------------------------------------------------------------------------------------------------
  const TITLES = 'main h1:not(.wordmark), main h2';
  const SKIP = '.card, li, article, figure, dialog, form, .hero--3d';
  const DUR = 700;
  const DELAYS = [0, 70, 130, 180, 220, 250]; // the gaps shrink, so it reads as one wave, not a metronome
  const root = document.documentElement;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Where the browser broke the plain title into lines, read without changing anything (one Range per
  // word). Splitting first and measuring after can re-wrap a title that fits by a hair (seen at 375 wide:
  // "Book a tattoo" went to two lines). A word broken by hyphenation leaves the title plain (it fades).
  function measureLines(h) {
    const node = h.firstChild;
    if (!node || node.nodeType !== 3 || h.childNodes.length !== 1) return null; // plain-text titles only
    const range = document.createRange();
    const lines = [];
    let top = null;
    for (const m of node.data.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (rects.length !== 1) return null;
      if (top === null || Math.abs(rects[0].top - top) > 2) { lines.push([]); top = rects[0].top; }
      lines[lines.length - 1].push(m[0]);
    }
    return lines.length ? lines : null;
  }

  // Each line keeps exactly the words it had (white-space: nowrap), so nothing on the page moves.
  // All the titles of a page are split together, in four passes, so the browser lays the page out
  // twice in all instead of twice per title (reading a size after a change forces a fresh layout; the
  // Gallery has six titles over 45 photos): (1) read every title's lines and width, (2) swap them all
  // into lines, (3) read every new width, (4) pin the widths that changed. Returns a Map title -> job.
  function splitAll(hs) {
    const found = [];
    for (const h of hs) { // 1. reads only
      const lines = measureLines(h);
      if (lines) found.push({ h, lines, orig: h.textContent, width: getComputedStyle(h).width, before: h.offsetWidth });
    }
    for (const f of found) { // 2. writes only
      f.h.setAttribute('aria-label', f.orig.replace(/\s+/g, ' ').trim());
      // The spaces between the lines keep copied text whole.
      f.h.innerHTML = f.lines.map((l, i) => `<span class="rl" aria-hidden="true"><span class="ri" style="--d: ${DELAYS[Math.min(i, DELAYS.length - 1)]}ms">${esc(l.join(' '))}</span></span>`).join(' ');
      f.h.classList.add('rise');
    }
    // 3. reads only. A title that sizes to its text (a flex item beside a link, as in the gallery's
    // group heads) would shrink to its longest line and let the link move up beside it...
    const shrunk = found.filter((f) => f.h.offsetWidth !== f.before);
    shrunk.forEach((f) => { f.h.style.width = f.width; }); // 4. ...so it keeps its width while it is split.
    const jobs = new Map();
    for (const f of found) jobs.set(f.h, { h: f.h, orig: f.orig, total: DELAYS[Math.min(f.lines.length - 1, DELAYS.length - 1)] + DUR });
    return jobs;
  }

  // Back to the plain heading. Its text is only put back while it still holds its lines: if something else
  // has already written other text into it (locally, the preview's text editor), that text stays. On
  // Squarespace nothing else touches the titles, so this is always the split heading.
  const isSplit = (h) => !!h.querySelector(':scope > .rl');
  const restore = ({ h, orig }) => {
    if (isSplit(h)) h.textContent = orig;
    h.classList.remove('rise', 'play');
    h.removeAttribute('aria-label');
    h.style.removeProperty('width');
    if (!h.getAttribute('style')) h.removeAttribute('style');
  };

  // A late script (on live Squarespace it can arrive after the 1s hold in motion-core.css has run out):
  // a title the visitor can already see is left plain, so it never shows, vanishes and rises again.
  // Titles further down the page still rise when they scroll in. The hold is a CSS animation, so while
  // it runs the title still lists it; once it is over the title no longer does.
  const holding = (h) => (h.getAnimations ? h.getAnimations().some((a) => a.animationName === 'title-hold') : performance.now() < 1000);
  const onScreen = (h) => { const r = h.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; };

  function titles() {
    let jobs = new Map();
    try {
      jobs = splitAll([...document.querySelectorAll(TITLES)].filter((h) => !h.closest(SKIP) && (holding(h) || !onScreen(h))));
    } finally {
      root.setAttribute('data-titles', ''); // ends the hold in motion-core.css, split or not
    }
    if (!jobs.size || !('IntersectionObserver' in window)) { jobs.forEach(restore); return; }

    // Play each title once, the moment any of it enters the window (like Squarespace's own trigger).
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const job = jobs.get(e.target);
        jobs.delete(e.target);
        if (!isSplit(e.target)) { restore(job); continue; } // already plain again: nothing to rise
        e.target.classList.add('play');
        setTimeout(() => restore(job), job.total + 50);
      }
    });
    jobs.forEach((job, h) => io.observe(h));

    // A title that has not played yet is measured again when its lines may have moved: the window got
    // narrower or wider, or a web font arrived after the split (Squarespace's fonts load from its servers).
    // All of them put back first, then split again together (same passes as at load).
    const again = () => {
      jobs.forEach((job, h) => { if (!isSplit(h)) { restore(job); jobs.delete(h); io.unobserve(h); } });
      if (!jobs.size) return;
      const waiting = [...jobs.keys()];
      jobs.forEach(restore);
      const next = splitAll(waiting);
      for (const h of waiting) {
        if (next.has(h)) jobs.set(h, next.get(h));
        else { jobs.delete(h); io.unobserve(h); }
      }
    };
    let lastW = innerWidth;
    addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; again(); } });
    document.fonts?.addEventListener?.('loadingdone', again);
  }

  // Measure with the page's own fonts when they are there; wait for them a little at most (the hold in
  // motion-core.css lasts 1s).
  if (!document.fonts || document.fonts.status === 'loaded') titles();
  else Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]).then(titles);

  // ---------------------------------------------------------------------------------------------------
  // 2. Smooth scroll on PC: "Light" (Lenis 1.3.27, about 6 KB, from esm.sh like three.js)
  // A wheel click glides for about 0.6s and eases to a stop (lerp 0.16; the browser's own scroll settles
  // in about 0.15-0.2s). Tested next to the statue in the R3-1 Core lab (docs/reports/round3-1-core-lab.md):
  // no dropped frames, the pinned statue holds and lets go exactly as without it. What it keeps to:
  // - Only on a computer with a mouse or trackpad. Touch screens keep their own scrolling; Lenis is not even
  //   downloaded there. Not inside a frame either (the preview's phone frame, Squarespace's editor).
  // - It loads only after the statue is live (or has given up), when the browser is idle.
  // - Sideways scrolling stays the browser's own: a wheel or trackpad move that is more sideways than up or
  //   down (or Shift + wheel) is never touched, so swipe sets (scroll-snap rows) and trackpad swipes scroll
  //   and snap as before.
  // - No frame loop runs unless a glide is moving, so the statue's "draw only when something changes" holds.
  // - Any key or click during a glide stops it where it is, so Space, Page Down, End, Tab and the skip link
  //   move the page as before (without this the glide undid them: the page jumped about 780px down and back).
  // - Same-page links (skip link, the gallery's jump links) keep the browser's own jump and focus move.
  // - The photo viewer or any pop-up never scrolls the page behind it.
  // - Boxes with their own scrollbar (the Book form's message box once it holds a long text) keep their own
  //   wheel scrolling: the box scrolls first, and the page glides only once the box is at its end, as without
  //   smooth scroll. Without this the page glided away and the box never moved (R4-4 round 2).
  // ---------------------------------------------------------------------------------------------------
  const LENIS_URL = 'https://esm.sh/lenis@1.3.27';
  const LERP = 0.16;
  const POPUPS = 'dialog, [aria-modal="true"], .gallery-lightbox, .sqs-lightbox'; // Squarespace's viewers: confirm with Inspect

  // Run fn once the statue has started or given up (data-3d ready / static), then when the browser is idle.
  const afterHero = (fn) => {
    const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
    const hero = document.querySelector('.hero--3d');
    const settled = () => /^(ready|static)$/.test(hero.getAttribute('data-3d') || '');
    if (!hero || settled()) return idle();
    const mo = new MutationObserver(() => { if (settled()) { mo.disconnect(); clearTimeout(t); idle(); } });
    mo.observe(hero, { attributes: true, attributeFilter: ['data-3d'] });
    const t = setTimeout(() => { mo.disconnect(); idle(); }, 10000); // the statue gives up after 8s
  };

  function smooth(Lenis) {
    const lenis = new Lenis({
      lerp: LERP,
      smoothWheel: true,
      syncTouch: false, // touch stays native
      autoRaf: false, // driven below, and only while a scroll is gliding
      anchors: false, // same-page links keep the browser's own jump and focus move
      stopInertiaOnNavigate: true,
      respectReducedMotion: false, // owner decision: motion is the same for everyone
      prevent: (node) => node.matches?.(POPUPS),
      allowNestedScroll: true, // a box that can still scroll that way (a long message) gets the wheel first
      // Sideways (or Shift + wheel): leave the event to the browser, untouched.
      virtualScroll: ({ deltaX, deltaY, event }) => !(event.shiftKey || Math.abs(deltaX) > Math.abs(deltaY)),
    });

    // Frame loop that sleeps when nothing glides. Every glide Lenis starts goes through scrollTo().
    let raf = 0;
    let fresh = true;
    const tick = (t) => {
      raf = 0;
      if (fresh) { lenis.time = t - 1000 / 60; fresh = false; } // first step: one frame, not the time since the last glide
      lenis.raf(t);
      if (lenis.isScrolling === 'smooth') raf = requestAnimationFrame(tick);
      else fresh = true;
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const scrollTo = lenis.scrollTo.bind(lenis);
    lenis.scrollTo = (...args) => { scrollTo(...args); wake(); };

    const halt = () => { if (lenis.isScrolling === 'smooth') lenis.reset(); };
    // A same-page link: drop any glide so the browser's own jump wins.
    document.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href*="#"]');
      if (a && a.pathname === location.pathname && a.hash) lenis.reset();
    }, true);
    // A pop-up opening while the page glides: stop the glide, so the page behind holds still.
    document.addEventListener('focusin', (e) => { if (e.target.closest?.(POPUPS)) lenis.reset(); }, true);
    document.addEventListener('keydown', halt, true);
    document.addEventListener('pointerdown', halt, true);
    window.__evlLenis = lenis; // hero3d.js resets it before jumping to the top when the statue gives up
  }

  if (window.self === window.top && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    afterHero(() => import(LENIS_URL).then(({ default: Lenis }) => smooth(Lenis)).catch(() => {})); // no Lenis (offline, blocked): normal scrolling
  }
})();
