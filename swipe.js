// EVALIU INK, Core only: dots and PC arrow buttons for the swipe sets (gallery tattoos, flash designs).
// The swipe itself is the browser's own CSS scroll-snap (shared/css/swipe.css), so it tracks the finger
// 1:1 with native momentum and works with no script at all. This script only
// adds, under the photo (never on it):
// - a row of dots showing which photo is in view;
// - on PC (a mouse or trackpad that can hover), Previous and Next buttons on either side of the dots.
// It reads the scroll position (passive listener, one update per frame), so a swipe, a trackpad, the arrow
// keys and the buttons all keep the dots right. Squarespace Core: Settings > Advanced > Code Injection >
// Footer, as <script src=".../swipe.js" defer></script> from the static host, with swipe.css in Custom CSS.
(() => {
  const sets = document.querySelectorAll('[data-swipe]');
  if (!sets.length) return;
  const chevron = (d) => `<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  sets.forEach((set) => {
    const track = set.querySelector('.swipe__track');
    const slides = track ? [...track.children] : [];
    // "Peek once" (swipe.css): once the first flash card's peek has played, or the visitor has pressed,
    // focused or swiped that card, the class swipe--peeked stops it for the rest of the visit. Without it,
    // the CSS stop (:focus-within, :active) ends when focus leaves and the browser starts the peek again.
    if (track && set.closest('.flash-card:first-of-type')) {
      const done = () => set.classList.add('swipe--peeked');
      set.addEventListener('animationend', (e) => { if (e.animationName === 'swipe-peek') done(); });
      set.addEventListener('pointerdown', done, { once: true });
      set.addEventListener('focusin', done, { once: true });
      track.addEventListener('scroll', done, { once: true, passive: true });
    }
    if (slides.length < 2) return;

    // Each set's buttons name its design ("Next photo of F1 Spider lilies", from data-swipe-name written
    // by build-sets.mjs), so a screen reader's list of buttons tells the cards apart. The buttons show only
    // an arrow, so the visible-label rule (WCAG 2.5.3) has no visible text to match.
    const name = (set.dataset.swipeName || '').replace(/[<>&"]/g, '').trim();
    const of = name ? ` of ${name}` : '';
    const controls = document.createElement('div');
    controls.className = 'swipe__controls';
    controls.innerHTML =
      `<button type="button" class="swipe__btn" data-dir="-1" aria-label="Previous photo${of}">${chevron('M9 2.5 4.5 7 9 11.5')}</button>` +
      `<span class="swipe__dots" aria-hidden="true">${'<span class="swipe__dot"></span>'.repeat(slides.length)}</span>` +
      `<button type="button" class="swipe__btn" data-dir="1" aria-label="Next photo${of}">${chevron('M5 2.5 9.5 7 5 11.5')}</button>` +
      // A polite live region: after the photo changes (swipe, buttons, arrow keys) it says "Photo 2 of 3".
      // It stays empty on load and during the Peek once hint (that moves the slides, not the scroll).
      `<span class="swipe__live" role="status" aria-live="polite" aria-atomic="true"></span>`;
    set.append(controls);
    const live = controls.querySelector('.swipe__live');
    set.classList.add('swipe--js');
    const dots = [...controls.querySelectorAll('.swipe__dot')];
    const [prev, next] = controls.querySelectorAll('.swipe__btn');

    let index = -1;
    const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const update = () => {
      const i = Math.min(slides.length - 1, Math.max(0, current()));
      if (i === index) return;
      dots[index]?.classList.remove('is-on');
      dots[i].classList.add('is-on');
      if (index !== -1) live.textContent = `Photo ${i + 1} of ${slides.length}`;
      index = i;
      // aria-disabled, not disabled: a real disabled button drops keyboard focus to <body> when the set
      // reaches its end with that button focused (WCAG 2.4.3 / 2.4.7). It stays focusable and says it is off.
      prev.setAttribute('aria-disabled', String(i === 0));
      next.setAttribute('aria-disabled', String(i === slides.length - 1));
    };
    let queued = false;
    track.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; update(); });
    }, { passive: true });
    // The buttons aim from where the set is heading, so quick clicks step one photo each.
    let target = null;
    track.addEventListener('scrollend', () => { target = null; update(); });
    controls.addEventListener('click', (e) => {
      const b = e.target.closest('.swipe__btn');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const from = target ?? current();
      target = Math.min(slides.length - 1, Math.max(0, from + Number(b.dataset.dir)));
      track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
      if (!('onscrollend' in window)) setTimeout(() => { target = null; }, 400);
    });
    // A resize keeps the photo that was in view (snap usually does this; this makes it certain).
    if ('ResizeObserver' in window) {
      let w = track.clientWidth;
      new ResizeObserver(() => {
        if (track.clientWidth === w) return;
        w = track.clientWidth;
        track.style.scrollBehavior = 'auto';
        track.scrollLeft = Math.max(0, index) * w;
        track.style.scrollBehavior = '';
      }).observe(track);
    }
    update();
  });
})();
