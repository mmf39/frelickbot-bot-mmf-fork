import "dotenv/config";

import { RealClient } from "../core/RealClient";
import {
  CompletedGame,
  getCompletedGamesForLeagueDay,
} from "../google/CompletedGamesService";

const EASTERN_TIME_ZONE = "America/New_York";

interface RankedTeam {
  team: string;
  emoji: string;
  score: number;
  result: "win" | "loss" | "tie";
}

function getEasternYesterdayMonthDay(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(parts.find(p => p.type === "year")?.value);
  const month = Number(parts.find(p => p.type === "month")?.value);
  const day = Number(parts.find(p => p.type === "day")?.value);

  const yesterday = new Date(Date.UTC(year, month - 1, day - 1, 12));

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
  }).format(yesterday);
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatPlacement(place: number): string {
  switch (place) {
    case 1:
      return "🥇";
    case 2:
      return "🥈";
    case 3:
      return "🥉";
    default:
      return `${place}.`;
  }
}

function getResultEmoji(result: RankedTeam["result"]): string {
  switch (result) {
    case "win":
      return "✅";
    case "loss":
      return "❌";
    default:
      return "➖";
  }
}

function collectRankedTeams(games: CompletedGame[]): RankedTeam[] {
  const teams: RankedTeam[] = [];

  for (const game of games) {
    teams.push({
      team: game.away.team,
      emoji: game.away.emoji || "🛡️",
      score: Number(game.away.score) || 0,
      result:
        game.away.score > game.home.score
          ? "win"
          : game.away.score < game.home.score
          ? "loss"
          : "tie",
    });

    teams.push({
      team: game.home.team,
      emoji: game.home.emoji || "🛡️",
      score: Number(game.home.score) || 0,
      result:
        game.home.score > game.away.score
          ? "win"
          : game.home.score < game.away.score
          ? "loss"
          : "tie",
    });
  }

  return teams.sort((a, b) => b.score - a.score);
}

function buildRankingMessage(
  leagueDay: string,
  teams: RankedTeam[]
): string {
  return [
    `📊 Daily Score Rankings — ${leagueDay}`,
    "",
    ...teams.map(
      (team, index) =>
        `${formatPlacement(index + 1)} ${team.emoji} ${team.team} — ${formatNumber(team.score)} ${getResultEmoji(team.result)}`
    ),
  ].join("\n");
}

async function main(): Promise<void> {
  console.log("Starting daily score rankings job...");

  const client = new RealClient();
  client.loadSession();

  const leagueDay = getEasternYesterdayMonthDay();
  const games = await getCompletedGamesForLeagueDay(leagueDay);

  if (games.length === 0) {
    console.log(`No completed games found for ${leagueDay}.`);
    return;
  }

  await client.postToGroup(
    buildRankingMessage(
      leagueDay,
      collectRankedTeams(games)
    )
  );

  console.log("Finished posting score rankings.");
}

main().catch((error: unknown) => {
  console.error("Daily score rankings failed:", error);
  process.exit(1);
});
