// Steam Hunters profile pages: a small launcher icon (top left) that opens the report card,
// plus ▲/▼ tags on changed games in the list.
(() => {
  const { h, when, reportView, glyph } = globalThis.SHPT;
  const KEYS = ["steamId", "reports", "lastCheck", "lastError", "snapshot", "unseen"];
  const pageId = pageSteamId();
  if (!pageId) return;

  let state = {};
  let busy = false;
  let open = false;

  const badge = h("span", { class: "shpt-badge" });
  const fab = h("button", { class: "shpt-fab", type: "button", title: "SteamHunters D2D Point Tracker", "aria-label": "SteamHunters D2D Point Tracker", onclick: toggle }, glyph(), badge);
  const pop = h("section", { class: "shpt-pop", hidden: "" });
  const root = h("div", { class: "shpt-root" }, fab, pop);
  document.body.append(root);

  chrome.storage.local.get(KEYS).then((s) => { state = s; render(); tagRows(); });
  chrome.storage.onChanged.addListener((changes) => {
    for (const [k, { newValue }] of Object.entries(changes)) state[k] = newValue;
    render();
    retagRows();
  });
  // Game rows are drawn client-side and redrawn on sort/filter/page.
  // Skip our own panel's mutations: its list redraws on every scroll.
  new MutationObserver((records) => records.some((m) => !root.contains(m.target)) && tagRows())
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener("keydown", (e) => e.key === "Escape" && open && toggle());
  document.addEventListener("mousedown", (e) => open && !root.contains(e.target) && toggle());

  function pageSteamId() {
    const direct = location.pathname.match(/^\/profiles\/(\d{17})/);
    if (direct) return direct[1];
    const link = document.querySelector('a[href^="https://steamcommunity.com/profiles/"]');
    return link?.href.match(/profiles\/(\d{17})/)?.[1] ?? null;
  }

  function toggle() {
    open = !open;
    pop.hidden = !open;
    fab.classList.toggle("shpt-active", open);
    if (open && state.unseen) chrome.storage.local.set({ unseen: false });
    render();
  }

  function send(msg) {
    busy = true; render();
    return chrome.runtime.sendMessage(msg).then((res) => {
      busy = false;
      if (!res?.ok) state.lastError = res?.error ?? "Extension error";
      render();
    });
  }

  const isMine = () => state.steamId === pageId;

  function renderBadge() {
    const latest = state.reports?.[0];
    badge.textContent = isMine() && state.unseen && latest ? String(latest.rows.length) : "";
    badge.hidden = !badge.textContent;
  }

  const head = (sub, actions) => h("header", { class: "shpt-head" },
    h("div", { class: "shpt-head-text" }, h("strong", {}, "SteamHunters D2D Point Tracker"), sub && h("span", { class: "shpt-muted" }, sub)),
    h("div", { class: "shpt-actions" }, actions));

  const iconBtn = (label, title, onclick) =>
    h("button", { class: "shpt-icon-btn", type: "button", title, "aria-label": title, onclick, ...(busy ? { disabled: "" } : {}) }, label);

  function render() {
    renderBadge();
    if (!open) return;

    if (!isMine()) {
      const tracked = state.steamId;
      pop.replaceChildren(
        head(tracked ? "Tracking a different account" : "No account yet", iconBtn("✕", "Close", toggle)),
        h("div", { class: "shpt-body" },
          h("p", { class: "shpt-muted" }, "Track this profile to see which of its games gain or lose points after each Steam Hunters recalculation."),
          h("button", {
            class: "shpt-btn", type: "button", ...(busy ? { disabled: "" } : {}),
            onclick: () => (!tracked || confirm("Switch accounts? History for the current account will be cleared.")) && send({ type: "setAccount", profile: pageId }),
          }, busy ? "Working…" : tracked ? "Track this profile instead" : "This is my account")));
      return;
    }

    const reports = state.reports ?? [];
    const sub = state.lastError ? null : state.lastCheck ? `Checked ${when(state.lastCheck)}` : "Not checked yet";
    pop.replaceChildren(
      head(sub, [iconBtn(busy ? "…" : "↻", "Check now", () => send({ type: "check" })), iconBtn("✕", "Close", toggle)]),
      ...(state.lastError ? [h("div", { class: "shpt-error" }, state.lastError)] : []),
      h("div", { class: "shpt-body" }, reports.length
        ? reportView(reports, pageId)
        : h("p", { class: "shpt-muted" }, state.snapshot
          ? `Baseline of ${Object.keys(state.snapshot.games).length.toLocaleString()} games saved ${when(state.snapshot.at)}. Each day's changes appear here as they happen.`
          : "Taking the first snapshot…")));
  }

  let byApp = { rows: null, map: null };
  function latestByApp() {
    if (!isMine() || !state.reports?.length) return null;
    const { rows } = state.reports[0];
    if (byApp.rows !== rows) byApp = { rows, map: new Map(rows.map((r) => [r.appid, r])) };
    return byApp.map;
  }

  function retagRows() {
    document.querySelectorAll(".shpt-tag").forEach((t) => t.remove());
    document.querySelectorAll("[data-shpt]").forEach((r) => delete r.dataset.shpt);
    tagRows();
  }

  function tagRows() {
    const changed = latestByApp();
    if (!changed) return;
    for (const a of document.querySelectorAll('tr a[href*="/apps/"]')) {
      const row = a.closest("tr");
      if (row.dataset.shpt || root.contains(row)) continue;
      const appid = a.getAttribute("href").match(/\/apps\/(\d+)/)?.[1];
      if (!appid) continue;
      row.dataset.shpt = appid;
      const r = changed.get(appid);
      if (!r) continue;
      const up = r.dValue > 0;
      a.after(h("span", {
        class: `shpt-tag ${up ? "shpt-tag-up" : "shpt-tag-down"}`,
        title: `Value ${r.oldValue.toLocaleString()} → ${r.value.toLocaleString()} · yours ${r.oldMine.toLocaleString()} → ${r.mine.toLocaleString()} (${when(state.reports[0].at)})`,
      }, `${up ? "▲ +" : "▼ −"}${Math.abs(r.dValue).toLocaleString()}`));
    }
  }
})();
