// The report card shared by the popup and the on-page panel: day picker, search, filters, sortable
// columns and a virtual-scrolled list, so a day with tens of thousands of moved games stays quick.
// Classic script, loaded after render.js: adds SHPT.reportView.
(() => {
  const { h, num, delta, tone, when, dayLabel } = globalThis.SHPT;
  const ROW_H = 26; // px, matches .shpt-row
  const OVERSCAN = 10;
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const SORTS = {
    name: (a, b) => collator.compare(a.name, b.name),
    dValue: (a, b) => a.dValue - b.dValue,
    dMine: (a, b) => a.dMine - b.dMine,
  };
  const COLS = [
    ["name", "Game", "Sort by name"],
    [null, "Value"],
    ["dValue", "Δ", "Sort by change in game value"],
    [null, "Yours"],
    ["dMine", "Δ", "Sort by change in your points"],
  ];
  const DIRS = [["all", "All"], ["up", "▲ Up"], ["down", "▼ Down"]];
  // In the toolbar popup (chrome-extension: / moz-extension:) a plain link would navigate the popup itself.
  const TARGET = location.protocol.endsWith("-extension:") ? "_blank" : "_top";

  // Outlives a single render: storage changes rebuild the whole card and the user shouldn't lose their place.
  const view = { date: null, q: "", dir: "all", mine: false, sort: "dValue", desc: true, scroll: 0 };
  const reportKey = (r) => r.date ?? r.at;

  function summary(report) {
    const up = report.rows.filter((r) => r.dValue > 0).length;
    const mine = report.rows.reduce((s, r) => s + r.dMine, 0);
    return h("div", { class: "shpt-summary" },
      h("span", { class: "shpt-up" }, `▲ ${num(up)} up`),
      h("span", { class: "shpt-down" }, `▼ ${num(report.rows.length - up)} down`),
      h("span", {}, "Your points: ", h("b", { class: tone(mine) }, delta(mine))));
  }

  function row(r, steamId, i) {
    const el = h("div", { class: "shpt-row" },
      h("span", { class: "shpt-name" },
        h("a", { href: `https://steamhunters.com/profiles/${steamId}/apps/${r.appid}/achievements`, target: TARGET, title: r.name }, r.name),
        r.newUnlocks > 0 && h("small", { class: "shpt-note", title: "You also unlocked achievements here since the last check" }, `+${r.newUnlocks} unl.`)),
      h("span", { class: "shpt-num shpt-muted" }, `${num(r.oldValue)} → ${num(r.value)}`),
      h("span", { class: `shpt-num ${tone(r.dValue)}` }, delta(r.dValue)),
      h("span", { class: "shpt-num shpt-muted" }, `${num(r.oldMine)} → ${num(r.mine)}`),
      h("span", { class: `shpt-num ${tone(r.dMine)}` }, delta(r.dMine)));
    el.style.top = `${i * ROW_H}px`; // CSSOM, not a style attribute: the site's CSP may block those
    return el;
  }

  function header(onSort) {
    return h("div", { class: "shpt-row shpt-head-row" }, COLS.map(([key, label, title], i) => {
      const cls = i ? "shpt-num" : "";
      if (!key) return h("span", { class: cls }, label);
      const on = view.sort === key;
      return h("button", { class: `shpt-sort ${cls}`, type: "button", title, onclick: () => onSort(key) },
        label, on && h("span", { class: "shpt-arrow" }, view.desc ? "▼" : "▲"));
    }));
  }

  // Sticky header plus only the rows in view (and a margin); the rest is empty height.
  function list(rows, steamId, onSort) {
    const inner = h("div", { class: "shpt-rows" });
    inner.style.height = `${rows.length * ROW_H}px`;
    const box = h("div", { class: "shpt-scroll" }, header(onSort), inner);
    let drawn = "";
    const paint = () => {
      const top = Math.max(0, box.scrollTop - ROW_H);
      const from = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
      const to = Math.min(rows.length, Math.ceil((top + (box.clientHeight || 400)) / ROW_H) + OVERSCAN);
      if (drawn === `${from}:${to}`) return;
      drawn = `${from}:${to}`;
      inner.replaceChildren(...rows.slice(from, to).map((r, k) => row(r, steamId, from + k)));
    };
    box.addEventListener("scroll", () => { view.scroll = box.scrollTop; paint(); }, { passive: true });
    paint();
    return { box, restore: () => { box.scrollTop = view.scroll; paint(); } };
  }

  function body(report, steamId, refocus) {
    let sorted = null;
    let sortedBy = "";
    const visible = () => {
      if (sortedBy !== `${view.sort}:${view.desc}`) {
        const cmp = SORTS[view.sort];
        sorted = [...report.rows].sort(view.desc ? (a, b) => cmp(b, a) : cmp);
        sortedBy = `${view.sort}:${view.desc}`;
      }
      const q = view.q.trim().toLowerCase();
      if (!q && view.dir === "all" && !view.mine) return sorted;
      return sorted.filter((r) =>
        (view.dir === "all" || (view.dir === "up" ? r.dValue > 0 : r.dValue < 0)) &&
        (!view.mine || r.dMine !== 0) &&
        (!q || r.appid === q || r.name.toLowerCase().includes(q)));
    };

    const listHolder = h("div");
    const count = h("div", { class: "shpt-muted shpt-count" });
    const update = (keepScroll) => {
      if (!keepScroll) view.scroll = 0;
      const rows = visible();
      const l = list(rows, steamId, sortBy);
      listHolder.replaceChildren(l.box, ...(rows.length ? [] : [h("p", { class: "shpt-muted shpt-empty" }, "No games match.")]));
      count.textContent = rows.length === report.rows.length
        ? `${num(rows.length)} games`
        : `${num(rows.length)} of ${num(report.rows.length)} games`;
      requestAnimationFrame(l.restore); // needs layout, which a fresh card doesn't have yet
    };
    const sortBy = (key) => {
      if (view.sort === key) view.desc = !view.desc;
      else { view.sort = key; view.desc = key !== "name"; }
      update();
    };

    const search = h("input", {
      class: "shpt-search", type: "search", placeholder: "Search games or app ID", value: view.q, autocomplete: "off",
      oninput: (e) => { view.q = e.target.value; update(); },
    });
    const seg = h("div", { class: "shpt-seg", role: "group", "aria-label": "Direction" },
      DIRS.map(([dir, label]) => h("button", {
        type: "button", "aria-pressed": String(view.dir === dir),
        onclick: (e) => {
          view.dir = dir;
          if (view.sort === "dValue") view.desc = dir !== "down"; // biggest moves first either way
          for (const b of seg.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
          update();
        },
      }, label)));
    const mine = h("label", { class: "shpt-check", title: "Only games where your own points changed" },
      h("input", { type: "checkbox", ...(view.mine ? { checked: "" } : {}), onchange: (e) => { view.mine = e.target.checked; update(); } }),
      "Mine only");

    update(true);
    if (refocus) requestAnimationFrame(() => { search.focus(); search.setSelectionRange(view.q.length, view.q.length); });
    return [
      h("div", { class: "shpt-muted shpt-range" }, report.date ? `${dayLabel(report)} · since ${when(report.since)}, updated ${when(report.at)}` : `${when(report.since)} → ${when(report.at)}`),
      summary(report),
      h("div", { class: "shpt-tools" }, search, seg, mine),
      listHolder,
      count,
    ];
  }

  // Report picker + body. `reports` is newest first.
  function reportView(reports, steamId) {
    // The card being replaced is still in the document, so this tells us the user was mid-search.
    let refocus = !!document.activeElement?.classList?.contains("shpt-search");
    let i = Math.max(0, reports.findIndex((r) => reportKey(r) === view.date));
    const holder = h("div", { class: "shpt-report" });
    const show = () => {
      view.date = reportKey(reports[i]);
      holder.replaceChildren(...body(reports[i], steamId, refocus));
      refocus = false;
    };
    const picker = reports.length > 1 && h("select", {
      class: "shpt-select",
      onchange: (e) => { i = +e.target.value; view.scroll = 0; show(); },
    }, reports.map((r, k) => h("option", { value: k, ...(k === i ? { selected: "" } : {}) }, `${dayLabel(r)} · ${num(r.rows.length)} games`)));
    show();
    return h("div", {}, picker, holder);
  }

  globalThis.SHPT.reportView = reportView;
})();
