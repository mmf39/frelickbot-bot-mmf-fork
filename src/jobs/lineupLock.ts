import "dotenv/config";

import { RealClient } from "../core/RealClient";
import { readSheet } from "../google/SheetsClient";
import { getSchedule } from "../google/ScheduleService";

type InProgressLineup = {
  team: string;
  players: string[];
};

type TeamRecord = {
  wins: string;
  losses: string;
  ties: string;
};

type DateParts = {
  isoDate: string;
  monthDay: string;
  hour: number;
  minute: number;
};

type LineupLockRecord = {
  date?: string;
  hour?: number | string;
  minute?: number | string;
  display?: string;
  lineupDmSent?: boolean | string;
  dmSent?: boolean | string;
  sent?: boolean | string;
  status?: string;
};

const TEAM_EMOJIS: Record<string, string> = {
  turkeys: "🦃",
  gusnem: "💪",
  thephantoms: "👻",
  illegals: "🕶️",
  pandas: "🐼",
  thepandas: "🐼",
  superkings: "👑",
  dreamteam: "💭",
  badbois: "😈",
  scorpions: "🦂",
  storm: "⛈️",
};

function normalizeTeamName(team: string): string {
  return String(team || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getTeamEmoji(team: string): string {
  return TEAM_EMOJIS[normalizeTeamName(team)] || "🛡️";
}

function getEasternDateParts(date = new Date()): DateParts {
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

function getSpreadsheetId(): string {
  const spreadsheetId = String(process.env.GOOGLE_SPREADSHEET_ID || "").trim();
  if (!spreadsheetId) throw new Error("GOOGLE_SPREADSHEET_ID is missing in Railway.");
  return spreadsheetId;
}

function getApiUrl(): string {
  const url = String(process.env.LINEUP_API_URL || "").trim();
  if (!url) throw new Error("LINEUP_API_URL is missing in Railway.");
  return url;
}

async function callLineupApi(
  action: string,
  body: Record<string, unknown> = {}
): Promise<any> {
  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Lineup API request failed: ${response.status} ${response.statusText}. ${text.slice(0, 300)}`
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Lineup API returned invalid JSON: ${text.slice(0, 300)}`);
  }

  if (parsed?.ok === false) {
    throw new Error(parsed.message || `Lineup API action ${action} failed.`);
  }

  return parsed;
}

function extractLockRecord(data: any): LineupLockRecord | null {
  const candidates = [data?.lock, data?.lineupLock, data?.result, data?.data, data];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;

    if (
      candidate.hour !== undefined ||
      candidate.minute !== undefined ||
      candidate.display !== undefined
    ) {
      return candidate as LineupLockRecord;
    }
  }

  return null;
}

function isTruthy(value: unknown): boolean {
  if (value === true) return true;
  return ["true", "yes", "1", "sent", "posted", "complete", "completed"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

function wasLineupDmSent(lock: LineupLockRecord): boolean {
  return (
    isTruthy(lock.lineupDmSent) ||
    isTruthy(lock.dmSent) ||
    isTruthy(lock.sent) ||
    isTruthy(lock.status)
  );
}

function parseDisplayTime(display: unknown): { hour: number; minute: number } | null {
  const match = String(display || "").trim().match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = String(match[3] || "").toUpperCase();

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM" && hour === 12) hour = 0;
    if (meridiem === "PM" && hour !== 12) hour += 12;
  } else {
    if (hour < 0 || hour > 23) return null;
    if (hour >= 1 && hour <= 11) hour += 12;
  }

  return { hour, minute };
}

function getLockHourMinute(lock: LineupLockRecord): { hour: number; minute: number } | null {
  const hour = Number(lock.hour);
  const minute = Number(lock.minute);

  if (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59
  ) {
    return { hour, minute };
  }

  return parseDisplayTime(lock.display);
}

function extractTeamName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

function normalizePlayer(value: unknown): string {
  const raw = String(value || "").replace(/\t/g, " ").trim();
  if (!raw || raw.toLowerCase() === "player") return "";

  const isCaptain = /\s+C\s*$/i.test(raw);
  const withoutCaptain = raw.replace(/\s+C\s*$/i, "").trim();
  const player = withoutCaptain.startsWith("@") ? withoutCaptain : `@${withoutCaptain}`;

  return isCaptain ? `${player} C` : player;
}

function looksLikeTeamHeader(value: unknown): boolean {
  const text = String(value || "").trim();
  return Boolean(text) && /\([^)]*\)\s*$/.test(text) && !text.startsWith("@");
}

function readPlayersBelowHeader(rows: string[][], headerRowIndex: number, columnIndex: number): string[] {
  const players: string[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length && players.length < 6; rowIndex++) {
    const value = String(rows[rowIndex]?.[columnIndex] || "").trim();

    if (looksLikeTeamHeader(value)) break;
    if (!value || value.toLowerCase() === "player") continue;

    const player = normalizePlayer(value);
    if (player) players.push(player);
  }

  return players;
}

function parseInProgressLineups(rows: string[][]): InProgressLineup[] {
  const lineups: InProgressLineup[] = [];
  const teamColumns = [0, 5];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (const columnIndex of teamColumns) {
      const header = rows[rowIndex]?.[columnIndex];
      if (!looksLikeTeamHeader(header)) continue;

      const team = extractTeamName(header);
      if (!team) continue;

      lineups.push({
        team,
        players: readPlayersBelowHeader(rows, rowIndex, columnIndex),
      });
    }
  }

  return lineups;
}

async function getInProgressLineups(): Promise<InProgressLineup[]> {
  const rows = await readSheet(getSpreadsheetId(), "'In Progress'!A:Z");
  return parseInProgressLineups(rows);
}

async function getTeamRecords(): Promise<Map<string, TeamRecord>> {
  const rows = await readSheet(getSpreadsheetId(), "Standings!A:F");
  const records = new Map<string, TeamRecord>();

  for (const row of rows.slice(1)) {
    const team = String(row[1] || "").trim();
    if (!team) continue;

    records.set(normalizeTeamName(team), {
      wins: String(row[2] || "0"),
      losses: String(row[3] || "0"),
      ties: String(row[4] || "0"),
    });
  }

  return records;
}

function formatRecord(team: string, records: Map<string, TeamRecord>): string {
  const record = records.get(normalizeTeamName(team));
  if (!record) return "0-0";
  return record.ties && record.ties !== "0"
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}

function findLineupForTeam(lineups: InProgressLineup[], teamName: string): InProgressLineup {
  const target = normalizeTeamName(teamName);
  return lineups.find((lineup) => normalizeTeamName(lineup.team) === target) || {
    team: teamName,
    players: [],
  };
}

function formatLineup(
  lineup: InProgressLineup,
  teamName: string,
  records: Map<string, TeamRecord>
): string {
  const lines = [
    `${getTeamEmoji(teamName)} ${teamName} (${formatRecord(teamName, records)})`,
  ];

  if (!lineup.players.length) {
    lines.push("No lineup found in In Progress.");
  } else {
    lines.push(...lineup.players);
  }

  return lines.join("\n");
}

function formatAllMatchups(
  games: Array<{ away: string; home: string }>,
  lineups: InProgressLineup[],
  records: Map<string, TeamRecord>
): string {
  return games
    .map((game) =>
      [
        formatLineup(findLineupForTeam(lineups, game.away), game.away, records),
        "----------",
        formatLineup(findLineupForTeam(lineups, game.home), game.home, records),
      ].join("\n")
    )
    .join("\n\n==========\n\n");
}

export async function runLineupLock(): Promise<void> {
  const now = getEasternDateParts();
  const lockResponse = await callLineupApi("getLineupLockTime", { date: now.isoDate });
  const lockRecord = extractLockRecord(lockResponse);

  if (!lockRecord) {
    console.log(`No saved lineup lock time found for ${now.isoDate}.`);
    return;
  }

  if (wasLineupDmSent(lockRecord)) {
    console.log(`The lineup DM was already sent for ${now.isoDate}.`);
    return;
  }

  const lockTime = getLockHourMinute(lockRecord);
  if (!lockTime) {
    throw new Error(`The saved lineup lock time for ${now.isoDate} is invalid.`);
  }

  if (now.hour * 60 + now.minute < lockTime.hour * 60 + lockTime.minute) {
    console.log(
      `Lineup lock time has not been reached yet. Current: ${String(now.hour).padStart(2, "0")}:${String(
        now.minute
      ).padStart(2, "0")} ET. Lock: ${String(lockTime.hour).padStart(2, "0")}:${String(
        lockTime.minute
      ).padStart(2, "0")} ET.`
    );
    return;
  }

  const games = (await getSchedule()).filter((game) => game.date === now.monthDay);
  if (!games.length) {
    console.log(`No scheduled matchups found for ${now.monthDay}.`);
    return;
  }

  const lineups = await getInProgressLineups();
  const records = await getTeamRecords();

  const message = [
    `Lineups for ${now.monthDay}`,
    "",
    formatAllMatchups(games, lineups, records),
  ].join("\n");

  const client = new RealClient();
  client.loadSession();

  await client.postToGroup(message, Number(process.env.REAL_GROUP_ID || 0));

  await callLineupApi("markLineupDmSent", {
    date: now.isoDate,
    sentAt: new Date().toISOString(),
  });

  console.log(
    `Sent ${games.length} active matchup${games.length === 1 ? "" : "s"} one time for ${now.isoDate}.`
  );
}

if (require.main === module) {
  runLineupLock().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
