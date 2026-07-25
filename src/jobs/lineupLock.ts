import "dotenv/config";

import { RealClient } from "../core/RealClient";
import { getSchedule } from "../google/ScheduleService";

type SubmittedLineup = {
  team?: string;
  captain?: string;
  lineup?: string[];
  players?: string[];
  submittedAt?: string;
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

  if (
    !year ||
    !month ||
    !day ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error("Could not determine the current Eastern date and time.");
  }

  return {
    isoDate: `${year}-${month}-${day}`,
    monthDay: `${Number(month)}/${Number(day)}`,
    hour,
    minute,
  };
}

function getApiUrl(): string {
  const url = String(process.env.LINEUP_API_URL || "").trim();

  if (!url) {
    throw new Error("LINEUP_API_URL is missing in Railway.");
  }

  return url;
}

async function callLineupApi(
  action: string,
  body: Record<string, unknown> = {}
): Promise<any> {
  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
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

function extractLineups(data: any): SubmittedLineup[] {
  const candidates = [
    data?.lineups,
    data?.submittedLineups,
    data?.results,
    data?.data,
    data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function extractLockRecord(data: any): LineupLockRecord | null {
  const candidates = [
    data?.lock,
    data?.lineupLock,
    data?.result,
    data?.data,
    data,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }

    const hasTime =
      candidate.hour !== undefined ||
      candidate.minute !== undefined ||
      candidate.display !== undefined;

    if (hasTime) {
      return candidate as LineupLockRecord;
    }
  }

  return null;
}

function isTruthy(value: unknown): boolean {
  if (value === true) return true;

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return ["true", "yes", "1", "sent", "posted", "complete", "completed"].includes(
    normalized
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
  const text = String(display || "").trim();
  const match = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);

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
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return { hour, minute };
}

function getLockHourMinute(lock: LineupLockRecord): {
  hour: number;
  minute: number;
} | null {
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

function hasReachedLockTime(
  now: DateParts,
  lock: { hour: number; minute: number }
): boolean {
  return now.hour * 60 + now.minute >= lock.hour * 60 + lock.minute;
}

function normalizePlayer(value: unknown): string {
  const player = String(value || "").trim();

  if (!player) return "";

  return player.startsWith("@") ? player : `@${player}`;
}

function getLatestLineups(lineups: SubmittedLineup[]): SubmittedLineup[] {
  const latestByTeam = new Map<string, SubmittedLineup>();

  for (const lineup of lineups) {
    const team = String(lineup.team || "").trim();
    if (!team) continue;

    const key = team.toLowerCase();
    const existing = latestByTeam.get(key);

    if (!existing) {
      latestByTeam.set(key, lineup);
      continue;
    }

    const currentTime = Date.parse(String(lineup.submittedAt || "")) || 0;
    const existingTime = Date.parse(String(existing.submittedAt || "")) || 0;

    if (currentTime >= existingTime) {
      latestByTeam.set(key, lineup);
    }
  }

  return [...latestByTeam.values()];
}

function findLineupForTeam(
  lineups: SubmittedLineup[],
  teamName: string
): SubmittedLineup {
  const target = teamName.trim().toLowerCase();

  return (
    lineups.find(
      (lineup) => String(lineup.team || "").trim().toLowerCase() === target
    ) || { team: teamName }
  );
}

function getOrderedPlayers(lineup: SubmittedLineup): string[] {
  const captain = normalizePlayer(lineup.captain);
  const players = (
    Array.isArray(lineup.lineup)
      ? lineup.lineup
      : Array.isArray(lineup.players)
        ? lineup.players
        : []
  )
    .map(normalizePlayer)
    .filter(Boolean);

  const orderedPlayers = [
    ...(captain ? [captain] : []),
    ...players.filter(
      (player) => !captain || player.toLowerCase() !== captain.toLowerCase()
    ),
  ];

  const uniquePlayers: string[] = [];
  const seen = new Set<string>();

  for (const player of orderedPlayers) {
    const key = player.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePlayers.push(player);
  }

  return uniquePlayers.slice(0, 6);
}

function formatLineup(lineup: SubmittedLineup): string {
  const team = String(lineup.team || "Unknown Team").trim();
  const players = getOrderedPlayers(lineup);
  const lines = [team];

  if (!players.length) {
    lines.push("No lineup submitted.");
    return lines.join("\n");
  }

  lines.push(...players);

  return lines.join("\n");
}

function formatMatchup(
  awayTeam: string,
  homeTeam: string,
  lineups: SubmittedLineup[]
): string {
  return [
    formatLineup(findLineupForTeam(lineups, awayTeam)),
    "-----",
    formatLineup(findLineupForTeam(lineups, homeTeam)),
  ].join("\n");
}

function formatAllMatchups(
  games: Array<{ away: string; home: string }>,
  lineups: SubmittedLineup[]
): string {
  return games
    .map((game) => formatMatchup(game.away, game.home, lineups))
    .join("\n\n==========\n\n");
}

export async function runLineupLock(): Promise<void> {
  const now = getEasternDateParts();

  const lockResponse = await callLineupApi("getLineupLockTime", {
    date: now.isoDate,
  });
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
    throw new Error(
      `The saved lineup lock time for ${now.isoDate} is invalid: ${JSON.stringify(lockRecord)}`
    );
  }

  if (!hasReachedLockTime(now, lockTime)) {
    console.log(
      `Lineups do not lock until ${String(lockTime.hour).padStart(2, "0")}:${String(
        lockTime.minute
      ).padStart(2, "0")} Eastern. Current time is ${String(now.hour).padStart(
        2,
        "0"
      )}:${String(now.minute).padStart(2, "0")}.`
    );
    return;
  }

  const games = (await getSchedule()).filter(
    (game) => game.date === now.monthDay
  );

  if (!games.length) {
    console.log(`No scheduled matchups found for ${now.monthDay}.`);
    return;
  }

  const lineupResponse = await callLineupApi("getSubmittedLineups", {
    date: now.isoDate,
  });
  const lineups = getLatestLineups(extractLineups(lineupResponse));

  const message = [
    `Lineups for ${now.monthDay}`,
    "",
    formatAllMatchups(games, lineups),
  ].join("\n");

  const client = new RealClient();
  client.loadSession();
  await client.postToGroup(message, Number(process.env.REAL_GROUP_ID || 0));

  await callLineupApi("markLineupDmSent", {
    date: now.isoDate,
    sentAt: new Date().toISOString(),
  });

  console.log(
    `Sent ${games.length} active matchup${games.length === 1 ? "" : "s"} by DM for ${now.isoDate}.`
  );
}

if (require.main === module) {
  runLineupLock().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
