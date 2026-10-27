const { h, when, reportView } = globalThis.SHPT;
const $ = (id) => document.getElementById(id);
let busy = false;

async function render() {
  const s = await chrome.storage.local.get(["steamId", "reports", "lastCheck", "lastError", "unseen", "minChange"]);
  // The snapshot is every game in the library (MBs for big ones); only the empty state needs it.
  if (!s.reports?.length) Object.assign(s, await chrome.storage.local.get("snapshot"));
  if (s.steamId && document.activeElement !== $("profile")) $("profile").value = s.steamId;
  if (document.activeElement !== $("minChange")) $("minChange").value = s.minChange ?? 5;
  $("check").disabled = busy || !s.steamId;
  $("check").textContent = busy ? "Working…" : "Check now";
  $("status").className = s.lastError ? "shpt-down" : "shpt-muted";
  $("status").textContent = s.lastError || (s.lastCheck ? `Checked ${when(s.lastCheck)}` : s.steamId ? "" : "Add your account below");

  const reports = s.reports ?? [];
  $("report").replaceChildren(
    reports.length ? reportView(reports, s.steamId)
      : h("p", { class: "shpt-muted shpt-empty" }, s.snapshot
        ? `Baseline of ${Object.keys(s.snapshot.games).length.toLocaleString()} games saved ${when(s.snapshot.at)}. Each day's changes appear here as they happen.`
        : "Save your account to take the first snapshot. You can also open your Steam Hunters profile and click “track it”."));
  if (s.unseen) chrome.storage.local.set({ unseen: false });
}

async function send(msg) {
  busy = true; render();
  const res = await chrome.runtime.sendMessage(msg);
  busy = false;
  if (!res?.ok) await chrome.storage.local.set({ lastError: res?.error ?? "Extension error" });
  render();
}

$("check").addEventListener("click", () => send({ type: "check" }));
$("account").addEventListener("submit", async (e) => {
  e.preventDefault();
  const profile = $("profile").value.trim();
  if (!profile) return;
  const { steamId } = await chrome.storage.local.get("steamId");
  if (steamId && !profile.endsWith(steamId) && !confirm("Switch accounts? History for the current account will be cleared.")) return;
  send({ type: "setAccount", profile });
});
$("minChange").addEventListener("change", (e) => {
  const n = Math.max(1, Math.round(+e.target.value) || 5);
  chrome.storage.local.set({ minChange: n });
});
chrome.storage.onChanged.addListener(render);
render();
