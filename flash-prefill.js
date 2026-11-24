// EVALIU INK, Core only: "Book this design" fills in the booking form (owner pick R3-2 #13 "Filled").
// Built from site/prototypes/r3-core/prefill.js (docs/reports/round3-1-core-lab.md).
//
// Each flash card's "Book this design" link carries the design's details, written by build-sets.mjs:
//   book.html?design=F1%20Orchid&placement=Inner%20thigh&size=8%20cm%20(about%203%20in)&colour=black-grey
// On Squarespace the same link is /book?design=... On the Book page this script sets the kind of booking
// to "flash design" and fills in the design, placement, size and black and grey or colour. Never a price,
// a date or availability. Without the script the same link simply opens Book.
//
// - Fields are found by their LABEL TEXT (local form and Squarespace's form alike; confirm with Inspect):
//   "Custom piece ..." (dropdown; the option with "flash" in it),
//   "Flash design" (or a label starting "Design"),
//   "Placement", "Approximate size" and "Black and grey or colour" (dropdown).
// - Squarespace may build its form late and keep values in its own memory (React), so this waits up to
//   10s for the form, and sets each value the way typing does (the browser's own value setter, then
//   "input" and "change" events), so the value is really sent.
// - It never overwrites something the visitor already chose or typed.
// - It does nothing on a page without ?design=. Squarespace Core: Code Injection (Footer, or the Book
//   page's own injection), loaded from the static host; its note's style is in swipe.css (Custom CSS).
(() => {
  const params = new URLSearchParams(location.search);
  const clean = (s, max) => (s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const design = clean(params.get('design'), 80);
  if (!design) return;
  const values = {
    placement: clean(params.get('placement'), 60),
    size: clean(params.get('size'), 40),
    colour: clean(params.get('colour'), 20).toLowerCase(),
  };

  // The link's colour value -> the matching dropdown option (its text, or the local form's value).
  const colourOption = (c) => {
    if (/colou?r/.test(c)) return /^colou?r$/.test(c) ? /^colou?r$/ : null; // "black-and-color" is neither
    if (/black|gr[ae]y/.test(c)) return /^black(-| and )gr[ae]y$/;
    if (/^(not[- ]?sure|unsure)$/.test(c)) return /^not[- ]sure$/;
    return null;
  };
  const norm = (s) => (s || '').replace(/\(required\)|\*/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const control = (test) => {
    for (const label of document.querySelectorAll('label, legend')) {
      if (!test(norm(label.textContent))) continue;
      const el = (label.htmlFor && document.getElementById(label.htmlFor))
        || label.querySelector('input, select, textarea')
        || label.closest('fieldset, .form-item, .field')?.querySelector('input:not([type="hidden"]), select, textarea');
      if (el) return el;
    }
    return null;
  };
  const setValue = (el, value) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pick = (select, match) => {
    if (!(select instanceof HTMLSelectElement) || select.value) return false;
    const opt = [...select.options].find((o) => o.value && match(norm(o.textContent), o.value.toLowerCase()));
    if (!opt) return false;
    setValue(select, opt.value);
    return true;
  };
  const write = (field, value) => {
    if (!field || !value || field.value.trim()) return false;
    setValue(field, value);
    if (field instanceof HTMLInputElement) { // its line draws in once, then leaves
      field.classList.add('evl-prefilled');
      field.addEventListener('animationend', () => field.classList.remove('evl-prefilled'), { once: true });
    }
    return true;
  };

  const fill = () => {
    const name = control((t) => t.startsWith('flash design') || t.startsWith('design'));
    if (!name) return false; // the form is not there yet
    // Booking is either a custom piece or a flash design (owner 2026-11-15: no gallery option).
    const kind = /flash|available/;
    pick(control((t) => t.startsWith('custom piece')), (t, v) => kind.test(t) || kind.test(v));
    const did = [
      write(name, design),
      write(control((t) => t.startsWith('placement')), values.placement),
      write(control((t) => t.startsWith('approximate size') || t.startsWith('size')), values.size),
    ];
    // black / grey / gray -> "Black and gray"; colour / color -> "Color"; not-sure / unsure -> "Not sure".
    // Any other value (typed by hand into the link) leaves "Choose one", so the visitor picks.
    const want = colourOption(values.colour);
    if (want) pick(control((t) => /^black and gr[ae]y or colo/.test(t)), (t, v) => want.test(t) || want.test(v));
    if (did[0]) {
      const note = document.createElement('p');
      note.className = 'evl-prefill-note';
      note.setAttribute('role', 'status');
      note.append('You picked ', Object.assign(document.createElement('strong'), { textContent: design }), ". I've filled in what I could below. Add the rest, plus at least one reference image.");
      (name.form || name.closest('form'))?.prepend(note);
    }
    return true;
  };

  const start = () => {
    if (fill()) return;
    const mo = new MutationObserver(() => { if (fill()) stop(); });
    const t = setTimeout(() => stop(), 10000);
    const stop = () => { mo.disconnect(); clearTimeout(t); };
    mo.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
