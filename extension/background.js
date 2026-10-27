import { check, setAccount } from "./tracker.js";

const ALARM = "check";
const EVERY_MINUTES = 6 * 60;

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);

async function schedule() {
  if (!(await chrome.alarms.get(ALARM))) {
    chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: EVERY_MINUTES });
  }
  updateBadge();
}

async function runCheck() {
  try {
    const result = await check();
    if (result.changed) notify(result.report);
    return result;
  } catch (e) {
    await chrome.storage.local.set({ lastError: e.message });
    throw e;
  }
}

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== ALARM) return;
  const { steamId } = await chrome.storage.local.get("steamId");
  if (steamId) runCheck().catch(() => {});
});

// Popup and content script ask the worker to do the network work.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const job = msg.type === "check" ? runCheck()
    : msg.type === "setAccount" ? setAccount(msg.profile).then(runCheck)
    : null;
  if (!job) return false;
  job.then((result) => reply({ ok: true, result }), (e) => reply({ ok: false, error: e.message }));
  return true;
});

chrome.storage.onChanged.addListener((changes) => {
  if ("unseen" in changes || "reports" in changes) updateBadge();
});

function notify({ rows }) {
  const up = rows.filter((r) => r.dValue > 0).length;
  const mine = rows.reduce((s, r) => s + r.dMine, 0);
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "SteamHunters D2D Point Tracker",
    message: `${up} up, ${rows.length - up} down. Your points: ${mine >= 0 ? "+" : ""}${mine.toLocaleString()}`,
  });
}

async function updateBadge() {
  const { unseen, reports = [] } = await chrome.storage.local.get(["unseen", "reports"]);
  chrome.action.setBadgeText({ text: unseen && reports[0] ? String(reports[0].rows.length) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
}
