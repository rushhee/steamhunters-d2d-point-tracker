// Stands in for the chrome.* APIs the extension uses, so its sources run unchanged as a userscript.
// build.mjs inlines this into dist/; ICON is defined there. Storage -> GM_getValue/GM_setValue,
// messaging -> direct calls, alarms -> timers while a Steam Hunters tab is open, popup -> menu commands.
const STORED = ["steamId", "reports", "lastCheck", "lastError", "snapshot", "dayBase", "unseen", "minChange"];

const storageListeners = [];
const emit = (changes) => setTimeout(() => storageListeners.forEach((fn) => fn(changes, "local")));
const storage = {
  local: {
    get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, GM_getValue(k)]).filter(([, v]) => v !== undefined)),
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) GM_setValue(k, v);
      emit(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])));
    },
    remove: async (keys) => {
      for (const k of [].concat(keys)) GM_deleteValue(k);
      emit(Object.fromEntries([].concat(keys).map((k) => [k, {}])));
    },
  },
  onChanged: { addListener: (fn) => storageListeners.push(fn) },
};
// Writes from other tabs, so an open panel follows a check that ran elsewhere.
if (typeof GM_addValueChangeListener === "function") {
  for (const k of STORED) GM_addValueChangeListener(k, (key, _old, newValue, remote) => remote && emit({ [key]: { newValue } }));
}

// The Steam Hunters API is same-origin here; the vanity lookup on steamcommunity.com goes through the manager.
const shFetch = (url) => new URL(url).origin === location.origin ? fetch(url) : new Promise((resolve, reject) => {
  GM_xmlhttpRequest({
    method: "GET",
    url,
    onload: (r) => resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.responseText,
      json: async () => JSON.parse(r.responseText),
    }),
    onerror: () => reject(new Error("Network error")),
  });
});

// No background page: the periodic check runs from whichever Steam Hunters tab is open once it's due.
// Each tick re-reads lastCheck, so several open tabs don't all check.
const alarmListeners = [];
let alarmTimer = null;
const alarms = {
  get: async () => null,
  create: (name, { periodInMinutes }) => {
    const period = periodInMinutes * 60e3;
    const tick = () => {
      const due = (Date.parse(GM_getValue("lastCheck")) || 0) + period - Date.now();
      if (due > 0) return (alarmTimer = setTimeout(tick, Math.min(due, 2 ** 31 - 1)));
      alarmListeners.forEach((fn) => fn({ name }));
      alarmTimer = setTimeout(tick, period);
    };
    clearTimeout(alarmTimer);
    alarmTimer = setTimeout(tick, 5000);
  },
  onAlarm: { addListener: (fn) => alarmListeners.push(fn) },
};

let backgroundListener = null;
const backgroundChrome = {
  storage,
  alarms,
  runtime: {
    onInstalled: { addListener: (fn) => setTimeout(fn) },
    onStartup: { addListener() {} },
    onMessage: { addListener: (fn) => (backgroundListener = fn) },
  },
  notifications: { create: ({ title, message }) => GM_notification({ title, text: message, image: ICON }) },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }, // the on-page launcher carries the count
};
const contentChrome = {
  storage,
  runtime: { sendMessage: (msg) => new Promise((resolve) => backgroundListener(msg, {}, resolve)) },
};

// Menu commands replace the toolbar popup. Account setup happens in the on-page panel.
GM_registerMenuCommand("Check now", async () => {
  if (!GM_getValue("steamId")) return alert("Open your Steam Hunters profile and click the tracker icon (top left) to set your account first.");
  const res = await contentChrome.runtime.sendMessage({ type: "check" });
  const r = res.result;
  alert(!res.ok ? res.error
    : r.baseline ? `Baseline of ${r.gameCount.toLocaleString()} games saved. Changes appear from the next check.`
    : r.report ? `${r.report.rows.length.toLocaleString()} games moved today. Open your profile to see them.`
    : "No games have moved today yet.");
});
GM_registerMenuCommand("Ignore changes smaller than…", () => {
  const input = prompt("Ignore daily changes smaller than how many points? Normal day-to-day drift is a few points.", GM_getValue("minChange") ?? 5);
  if (input != null) storage.local.set({ minChange: Math.max(1, Math.round(+input) || 5) });
});
GM_registerMenuCommand("Open my profile", () => {
  const id = GM_getValue("steamId");
  if (id) location.assign(`https://steamhunters.com/profiles/${id}`);
  else alert("No account yet. Open your Steam Hunters profile and click the tracker icon (top left).");
});
