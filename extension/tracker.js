// Fetching, snapshotting and diffing. Shared by the service worker and the popup.

const API = (id) => `https://steamhunters.com/api/steam-users/${id}/licenses`;
const MAX_REPORTS = 50;

export async function resolveSteamId(input) {
  const profile = input.trim().replace(/\/+$/, "");
  const id = profile.match(/(\d{17})$/);
  if (id) return id[1];
  const vanity = profile.split("/").pop();
  const res = await fetch(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`);
  const m = (await res.text()).match(/<steamID64>(\d{17})<\/steamID64>/);
  if (!m) throw new Error(`Couldn't find a Steam profile for "${input}"`);
  return m[1];
}

// Switching account wipes history: snapshots and reports belong to one profile.
export async function setAccount(profile) {
  const steamId = await resolveSteamId(profile);
  const { steamId: current } = await chrome.storage.local.get("steamId");
  if (steamId !== current) {
    await chrome.storage.local.remove(["snapshot", "reports", "unseen", "lastCheck", "lastError"]);
    await chrome.storage.local.set({ steamId });
  }
  return steamId;
}

// { appid: { name, value, mine, unlocked } } for games that carry achievements.
async function fetchGames(steamId) {
  const res = await fetch(API(steamId));
  if (!res.ok) throw new Error(`Steam Hunters returned HTTP ${res.status}`);
  const games = {};
  for (const [appid, lic] of Object.entries(await res.json())) {
    if (!lic.app.achievementCount) continue;
    games[appid] = {
      name: lic.app.name || `App ${appid}`,
      value: lic.app.points ?? 0,
      mine: lic.points ?? 0,
      unlocked: lic.achievementUnlockCount ?? 0,
    };
  }
  return games;
}

// Values drift by a few points all day as players unlock things, so small moves aren't maintenance.
export const DEFAULT_MIN_CHANGE = 5;

export function diff(prev, next, minChange = DEFAULT_MIN_CHANGE) {
  const rows = [];
  for (const [appid, g] of Object.entries(next)) {
    const o = prev[appid];
    if (!o || Math.abs(g.value - o.value) < minChange) continue;
    rows.push({
      appid,
      name: g.name,
      oldValue: o.value,
      value: g.value,
      dValue: g.value - o.value,
      oldMine: o.mine,
      mine: g.mine,
      dMine: g.mine - o.mine,
      newUnlocks: g.unlocked - o.unlocked,
    });
  }
  return rows.sort((a, b) => b.dValue - a.dValue);
}

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// One report per local day: today's moves against where each game stood when the day began.
// A day's baseline is the last snapshot of the day before, so nothing falls between days.
// Returns { baseline, gameCount, report|null, changed }.
export async function check() {
  const { steamId, snapshot, dayBase, minChange } =
    await chrome.storage.local.get(["steamId", "snapshot", "dayBase", "minChange"]);
  if (!steamId) throw new Error("Set your Steam profile first");
  const games = await fetchGames(steamId);
  const gameCount = Object.keys(games).length;
  if (!gameCount) throw new Error("No games found. Is the profile public and synced on Steam Hunters?");

  const now = new Date().toISOString();
  const today = localDate();
  const base = dayBase?.date === today ? dayBase : { date: today, at: snapshot?.at ?? now, games: snapshot?.games ?? games };
  await chrome.storage.local.set({ snapshot: { at: now, games }, dayBase: base, lastCheck: now, lastError: null });
  if (!snapshot) return { baseline: true, gameCount, report: null, changed: false };

  const rows = diff(base.games, games, minChange ?? DEFAULT_MIN_CHANGE);
  const { reports = [] } = await chrome.storage.local.get("reports");
  const earlier = reports.find((r) => r.date === today);
  const others = reports.filter((r) => r.date !== today);
  const report = rows.length ? { date: today, at: now, since: base.at, rows } : null;
  const changed = !!report && rows.length !== earlier?.rows.length;
  await chrome.storage.local.set({
    reports: (report ? [report, ...others] : others).slice(0, MAX_REPORTS),
    ...(changed && { unseen: true }),
  });
  return { baseline: false, gameCount, report, changed };
}
