import "dotenv/config";

import { RealClient } from "../core/RealClient";
import {
  getGameLock,
  getSubmittedLineups,
  markGameLockDmSent,
  SheetLineup,
} from "../google/LineupSheetService";
import { getSchedule } from "../google/ScheduleService";

type EasternNow = {
  isoDate: string;
  monthDay: string;
};

function getEasternNow(date = new Date()): EasternNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not determine the current Eastern date.");
  }

  return {
    isoDate: `${year}-${month}-${day}`,
    monthDay: `${Number(month)}/${Number(day)}`,
  };
}

function normalizeTeam(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePlayer(value: unknown): string {
  const player = String(value ?? "").trim();
  if (!player) return "";
  return player.startsWith("@") ? player : `@${player}`;
}

function getLatestLineups(lineups: SheetLineup[]): SheetLineup[] {
  const latest = new Map<string, SheetLineup>();

  for (const lineup of lineups) {
    const key = normalizeTeam(lineup.team);
    if (!key) continue;

    const existing = latest.get(key);
    if (!existing) {
      latest.set(key, lineup);
      continue;
    }

    const currentTime = Date.parse(lineup.submittedAt) || 0;
    const existingTime = Date.parse(existing.submittedAt) || 0;
    if (currentTime >= existingTime) latest.set(key, lineup);
  }

  return [...latest.values()];
}

function findLineup(lineups: SheetLineup[], team: string): SheetLineup | null {
  const target = normalizeTeam(team);
  return lineups.find((lineup) => normalizeTeam(lineup.team) === target) ?? null;
}

function formatLineup(team: string, lineup: SheetLineup | null): string {
  if (!lineup) return `${team}\nNo lineup submitted.`;

  const captain = normalizePlayer(lineup.captain);
  const players = lineup.players.map(normalizePlayer).filter(Boolean);
  const ordered = [
    ...(captain ? [captain] : []),
    ...players.filter(
      (player) => !captain || player.toLowerCase() !== captain.toLowerCase()
    ),
  ];

  const unique = [...new Map(ordered.map((player) => [player.toLowerCase(), player])).values()]
    .slice(0, 6);

  return [team, ...(unique.length ? unique : ["No lineup submitted."])].join("\n");
}

function formatMatchups(
  games: Array<{ away: string; home: string }>,
  lineups: SheetLineup[]
): string {
  return games
    .map((game) =>
      [
        formatLineup(game.away, findLineup(lineups, game.away)),
        "-----",
        formatLineup(game.home, findLineup(lineups, game.home)),
      ].join("\n")
    )
    .join("\n\n==========\n\n");
}

export async function runLineupLock(): Promise<void> {
  const now = getEasternNow();
  const lock = await getGameLock(now.isoDate);

  if (!lock) {
    console.log(`No saved lineup lock time found for ${now.isoDate}.`);
    return;
  }

  if (lock.lineupDmSent) {
    console.log(`The lineup DM was already sent for ${now.isoDate}.`);
    return;
  }

  const lockTimestamp = Date.parse(lock.lockAt);
  if (!Number.isFinite(lockTimestamp)) {
    throw new Error(
      `Invalid Game Locks value for ${now.isoDate}: ${JSON.stringify(lock)}`
    );
  }

  if (Date.now() < lockTimestamp) {
    console.log(
      `Lineups do not lock until ${new Date(lockTimestamp).toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })}.`
    );
    return;
  }

  const games = (await getSchedule()).filter(
    (game) => game.date === now.monthDay &&
      !["complete", "completed", "cancelled", "canceled"].includes(
        String(game.status ?? "").trim().toLowerCase()
      )
  );

  if (!games.length) {
    console.log(`No active scheduled matchups found for ${now.monthDay}.`);
    return;
  }

  const lineups = getLatestLineups(await getSubmittedLineups());
  const message = [
    `Lineups for ${now.monthDay}`,
    "",
    formatMatchups(games, lineups),
  ].join("\n");

  const client = new RealClient();
  client.loadSession();
  await client.postToGroup(message, Number(process.env.REAL_GROUP_ID || 0));
  await markGameLockDmSent(lock);

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
