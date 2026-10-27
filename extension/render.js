// DOM + formatting helpers shared by the popup and the on-page panel. Classic script: exposes globalThis.SHPT.
(() => {
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...children.flat().filter((c) => c != null && c !== false));
    return el;
  }

  const num = (n) => n.toLocaleString();
  const delta = (n) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : "0");
  const tone = (n) => (n > 0 ? "shpt-up" : n < 0 ? "shpt-down" : "shpt-flat");

  function when(iso) {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }

  // "Today", "Yesterday", else "Mon 12 Oct". Reports saved before daily tracking have no date.
  function dayLabel(r) {
    if (!r.date) return when(r.at);
    const [y, m, d] = r.date.split("-").map(Number);
    const day = new Date(y, m - 1, d);
    const diff = Math.round((new Date().setHours(0, 0, 0, 0) - day) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  // The logo mark without its tile: a green up arrow beside a red down arrow.
  const GLYPH = `<svg viewBox="0 0 128 128" width="100%" height="100%" aria-hidden="true" fill="none" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <path d="M46 98V34M26 54L46 33L66 54" stroke="#4ade80"/><path d="M82 30V94M62 74L82 95L102 74" stroke="#f87171"/></svg>`;
  const glyph = () => {
    const el = h("span", { class: "shpt-glyph" });
    el.innerHTML = GLYPH; // static string above, no page data
    return el;
  };

  globalThis.SHPT = { h, num, delta, tone, when, dayLabel, glyph };
})();
