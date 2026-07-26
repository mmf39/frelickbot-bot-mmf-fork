import "dotenv/config";

import { RealClient } from "../core/RealClient";
import {
  appendSheetRows,
  ensureSheetExists,
  readSheet,
} from "../google/SheetsClient";
import { getScheduleForDate } from "../google/ScheduleService";

type LeagueGame = {
  away: string;
  home: string;
};

type SubmittedLineup = {
  team?: string;
};

type LockRecord = {
  hour?: number | string;
  minute?: number | string;
  display?: string;
};

type ReminderType = "9pm" | "2hour" | "1hour";

type EasternNow = {
  isoDate: string;
  monthDay: string;
  hour: number;
  minute: number;
};

/*
 * ADD EACH GM'S REAL DM CHANNEL ID HERE.
 *
 * The key is the normalized team name. Keep the channel ID inside quotes.
 * Example:
 *   turkeys: "2205570",
 */
const TEAM_GM_CHANNELS: Record<string, string> = {
  turkeys: "7519070",
  gusnem: "7368245",
  thephantoms: "7510723",
  illegals: "7519076",
  thepandas: "7519078",
  superkings: "7402013",
  dreamteam: "7521466",
  badbois: "7244816",
  scorpions: "7202447",
  storm: "7509467"
};

const TEAM_EMOJIS: Record<string, string> = {
  turkeys: "🦃",
  gusnem: "💪",
  thephantoms: "👻",
  illegals: "🕶️",
  thepandas: "🐼",
  thepandas: "🐼",
  superkings: "👑",
  dreamteam: "💭",
  badbois: "😈",
  scorpions: "🦂",
  storm: "⛈️",
};

const REMINDER_LOG_SHEET = "GM Reminder Log";
const REMINDER_LOG_HEADERS = [
  "Date",
  "Team",
  "Reminder Type",
  "Sent At",
  "GM Channel ID",
];

function normalizeTeamName(team: string): string {
  return String(team || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getTeamEmoji(team: string): string {
  return TEAM_EMOJIS[normalizeTeamName(team)] || "🛡️";
}

function getGmChannelId(team: string): string | null {
  const channelId = String(TEAM_GM_CHANNELS[normalizeTeamName(team)] || "").trim();

  if (!channelId) {
    console.warn(`No GM DM channel ID is configured for ${team}.`);
    return null;
  }

  return channelId;
}

function getEasternNow(date = new Date()): EasternNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("Could not determine the current Eastern date and time.");
  }

  return {
    isoDate: `${year}-${month}-${day}`,
    monthDay: `${Number(month)}/${Number(day)}`,
    hour,
    minute,
  };
}

function addEasternDays(isoDate: string, days: number): { isoDate: string; monthDay: string } {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = shifted.getUTCMonth() + 1;
  const shiftedDay = shifted.getUTCDate();

  return {
    isoDate: `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}-${String(shiftedDay).padStart(2, "0")}`,
    monthDay: `${shiftedMonth}/${shiftedDay}`,
  };
}

function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatLockTime(lock: LockRecord): string {
  if (String(lock.display || "").trim()) {
    return String(lock.display).trim();
  }

  const hour = Number(lock.hour);
  const minute = Number(lock.minute);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return "the listed lineup deadline";
  }

  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix} ET`;
}

async function callLineupApi(
  action: string,
  body: Record<string, unknown> = {}
): Promise<any> {
  const apiUrl = String(process.env.LINEUP_API_URL || "").trim();
  if (!apiUrl) throw new Error("LINEUP_API_URL is missing in Railway.");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });

  const text = await response.text();
  let parsed: any;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Lineup API returned invalid JSON: ${text.slice(0, 300)}`);
  }

  if (!response.ok || parsed?.ok === false) {
    throw new Error(parsed?.message || `Lineup API action ${action} failed.`);
  }

  return parsed;
}

function extractLockRecord(data: any): LockRecord | null {
  const candidates = [data?.lock, data?.lineupLock, data?.result, data?.data, data];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    if (
      candidate.hour !== undefined ||
      candidate.minute !== undefined ||
      candidate.display !== undefined
    ) {
      return candidate as LockRecord;
    }
  }

  return null;
}

function extractSubmittedLineups(data: any): SubmittedLineup[] {
  const candidates = [data?.lineups, data?.submittedLineups, data?.results, data?.data, data];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

async function getSubmittedTeamKeys(date: string): Promise<Set<string>> {
  const response = await callLineupApi("getSubmittedLineups", { date });
  return new Set(
    extractSubmittedLineups(response)
      .map((lineup) => normalizeTeamName(String(lineup.team || "")))
      .filter(Boolean)
  );
}

async function getTeamRecords(): Promise<Map<string, string>> {
  const spreadsheetId = String(process.env.GOOGLE_SPREADSHEET_ID || "").trim();
  const rows = await readSheet(spreadsheetId, "Standings!A:F");
  const records = new Map<string, string>();

  for (const row of rows.slice(1)) {
    const team = String(row[1] || "").trim();
    if (!team) continue;

    const wins = String(row[2] || "0");
    const losses = String(row[3] || "0");
    const ties = String(row[4] || "0");
    const record = ties && ties !== "0" ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    records.set(normalizeTeamName(team), record);
  }

  return records;
}

function getRecord(team: string, records: Map<string, string>): string {
  return records.get(normalizeTeamName(team)) || "0-0";
}

function findOpponent(games: LeagueGame[], team: string): string | null {
  const teamKey = normalizeTeamName(team);

  for (const game of games) {
    if (normalizeTeamName(game.away) === teamKey) return game.home;
    if (normalizeTeamName(game.home) === teamKey) return game.away;
  }

  return null;
}

function getTeamsPlaying(games: LeagueGame[]): string[] {
  const teams = games.flatMap((game) => [game.away, game.home]);
  return [...new Map(teams.map((team) => [normalizeTeamName(team), team])).values()];
}

async function getSentReminderKeys(): Promise<Set<string>> {
  const spreadsheetId = String(process.env.GOOGLE_SPREADSHEET_ID || "").trim();
  await ensureSheetExists(spreadsheetId, REMINDER_LOG_SHEET, REMINDER_LOG_HEADERS);
  const rows = await readSheet(spreadsheetId, `'${REMINDER_LOG_SHEET}'!A:E`);

  return new Set(
    rows.slice(1).map((row) =>
      `${String(row[0] || "").trim()}|${normalizeTeamName(String(row[1] || ""))}|${String(row[2] || "").trim()}`
    )
  );
}

async function markReminderSent(
  date: string,
  team: string,
  type: ReminderType,
  channelId: string
): Promise<void> {
  const spreadsheetId = String(process.env.GOOGLE_SPREADSHEET_ID || "").trim();
  await appendSheetRows(spreadsheetId, `'${REMINDER_LOG_SHEET}'!A:E`, [[
    date,
    team,
    type,
    new Date().toISOString(),
    channelId,
  ]]);
}

function reminderKey(date: string, team: string, type: ReminderType): string {
  return `${date}|${normalizeTeamName(team)}|${type}`;
}

async function sendNinePmMessages(
  client: RealClient,
  now: EasternNow,
  records: Map<string, string>,
  sentKeys: Set<string>
): Promise<void> {
  if (now.hour !== 21) return;

  const tomorrow = addEasternDays(now.isoDate, 1);
  const games = (await getScheduleForDate(tomorrow.monthDay)) as LeagueGame[];
  if (!games.length) return;

  const lock = extractLockRecord(
    await callLineupApi("getLineupLockTime", { date: tomorrow.isoDate })
  );

  if (!lock) {
    console.log(`No lineup lock is saved yet for ${tomorrow.isoDate}.`);
    return;
  }

  const dueTime = formatLockTime(lock);

  for (const team of getTeamsPlaying(games)) {
    const key = reminderKey(tomorrow.isoDate, team, "9pm");
    if (sentKeys.has(key)) continue;

    const channelId = getGmChannelId(team);
    const opponent = findOpponent(games, team);
    if (!channelId || !opponent) continue;

    const message =
      `👋 Hi! Just wanted to let you know your lineup for ` +
      `${getTeamEmoji(team)} ${team} (${getRecord(team, records)}) vs ` +
      `${getTeamEmoji(opponent)} ${opponent} (${getRecord(opponent, records)}) ` +
      `on ${formatDisplayDate(tomorrow.isoDate)} is due at ${dueTime}.\n\n` +
      `🍀 Wishing you the best of luck in your game!`;

    await client.sendChannelMessage(message, channelId);
    await markReminderSent(tomorrow.isoDate, team, "9pm", channelId);
    sentKeys.add(key);
    console.log(`Sent the 9 PM lineup notice to ${team}.`);
  }
}

function getReminderType(now: EasternNow, lock: LockRecord): ReminderType | null {
  const lockHour = Number(lock.hour);
  const lockMinute = Number(lock.minute);

  if (!Number.isInteger(lockHour) || !Number.isInteger(lockMinute)) return null;

  const minutesUntilLock = lockHour * 60 + lockMinute - (now.hour * 60 + now.minute);

  if (minutesUntilLock <= 120 && minutesUntilLock > 115) return "2hour";
  if (minutesUntilLock <= 60 && minutesUntilLock > 55) return "1hour";
  return null;
}

async function sendUnsubmittedReminderMessages(
  client: RealClient,
  now: EasternNow,
  records: Map<string, string>,
  sentKeys: Set<string>
): Promise<void> {
  const games = (await getScheduleForDate(now.monthDay)) as LeagueGame[];
  if (!games.length) return;

  const lock = extractLockRecord(
    await callLineupApi("getLineupLockTime", { date: now.isoDate })
  );
  if (!lock) return;

  const type = getReminderType(now, lock);
  if (!type) return;

  const submittedTeams = await getSubmittedTeamKeys(now.isoDate);
  const hours = type === "2hour" ? 2 : 1;

  for (const team of getTeamsPlaying(games)) {
    const teamKey = normalizeTeamName(team);
    if (submittedTeams.has(teamKey)) continue;

    const key = reminderKey(now.isoDate, team, type);
    if (sentKeys.has(key)) continue;

    const channelId = getGmChannelId(team);
    const opponent = findOpponent(games, team);
    if (!channelId || !opponent) continue;

    const message =
      `⏰ Reminder: Lineups are due in ${hours} ${hours === 1 ? "hour" : "hours"}! ` +
      `📝\n\n${getTeamEmoji(team)} ${team} (${getRecord(team, records)}) vs ` +
      `${getTeamEmoji(opponent)} ${opponent} (${getRecord(opponent, records)})`;

    await client.sendChannelMessage(message, channelId);
    await markReminderSent(now.isoDate, team, type, channelId);
    sentKeys.add(key);
    console.log(`Sent the ${hours}-hour unsubmitted-lineup reminder to ${team}.`);
  }
}

export async function runGmLineupReminders(): Promise<void> {
  const now = getEasternNow();
  const client = new RealClient();
  client.loadSession();

  const [records, sentKeys] = await Promise.all([
    getTeamRecords(),
    getSentReminderKeys(),
  ]);

  await sendNinePmMessages(client, now, records, sentKeys);
  await sendUnsubmittedReminderMessages(client, now, records, sentKeys);
}
