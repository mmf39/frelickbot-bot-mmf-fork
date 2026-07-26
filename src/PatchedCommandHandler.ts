import { handleCommand as handleOriginalCommand } from "./CommandHandler";
import { getSchedule } from "./google/ScheduleService";
import { getContracts } from "./google/SalaryCapService";

const CAP_LIMIT = 5000;

function normalizeTeamName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/^@rsklbot\s*/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(score) ? score : null;
}

function parseScheduleDate(value: string): Date | null {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);

  if (!match) return null;

  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;

  const parsed = new Date(year, Number(match[1]) - 1, Number(match[2]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEasternToday(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const part = (type: string): number =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);

  return new Date(part("year"), part("month") - 1, part("day"));
}

function isFinalizedStatus(status: unknown): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "complete" || normalized === "completed";
}

function findMatchingTeam(searchText: string, teams: string[]): string | null {
  const search = normalizeTeamName(searchText);
  if (!search) return null;

  const exact = teams.find((team) => normalizeTeamName(team) === search);
  if (exact) return exact;

  const partial = teams.filter((team) => {
    const normalized = normalizeTeamName(team);
    return normalized.includes(search) || search.includes(normalized);
  });

  return partial.length === 1 ? partial[0] : null;
}

function getTeamEmoji(team: string): string {
  const emojis: Record<string, string> = {
    turkeys: "🦃",
    gusnem: "💪",
    thephantoms: "👻",
    illegals: "🕶️",
    thepandas: "🐼",
    superkings: "👑",
    dreamteam: "💭",
    badbois: "😈",
    scorpions: "🦂",
    storm: "⛈️",
  };

  return emojis[normalizeTeamName(team)] || "🛡️";
}

function formatScore(score: number): string {
  return score.toLocaleString("en-US");
}

function getCommandText(activity: any): string {
  return String(
    activity.additionalInfo?.comment?.plainText ??
      activity.comment?.plainText ??
      ""
  ).trim();
}

export async function handleCommand(client: any, activity: any): Promise<void> {
  const fullText = getCommandText(activity).replace(/\s+/g, " ").trim();
  const commandMatch = fullText.match(/\$[a-z0-9_-]+/i);

  if (!commandMatch) {
    await handleOriginalCommand(client, activity);
    return;
  }

  const command = commandMatch[0].toLowerCase();
  const argumentsText = fullText
    .slice((commandMatch.index ?? 0) + commandMatch[0].length)
    .trim();

  const reservedCommands = new Set([
    "$help",
    "$ping",
    "$lineup",
    "$transaction",
    "$roster",
    "$cap",
    "$live",
    "$standing",
    "$standings",
    "$schedule",
    "$status",
    "$mensah",
  ]);

  if (reservedCommands.has(command)) {
    await handleOriginalCommand(client, activity);
    return;
  }

  const teamSearchText = [command.replace(/^\$/, ""), argumentsText]
    .filter(Boolean)
    .join(" ")
    .trim();

  const schedule = await getSchedule();
  const availableTeams = Array.from(
    new Set(schedule.flatMap((game) => [game.away, game.home]))
  );
  const matchedTeam = findMatchingTeam(teamSearchText, availableTeams);

  if (!matchedTeam) {
    await handleOriginalCommand(client, activity);
    return;
  }

  const teamGames = schedule
    .filter(
      (game) =>
        normalizeTeamName(game.away) === normalizeTeamName(matchedTeam) ||
        normalizeTeamName(game.home) === normalizeTeamName(matchedTeam)
    )
    .map((game) => ({
      ...game,
      parsedDate: parseScheduleDate(game.date),
      parsedAwayScore: parseScore(game.awayScore),
      parsedHomeScore: parseScore(game.homeScore),
    }))
    .filter((game) => game.parsedDate !== null)
    .sort((a, b) => a.parsedDate!.getTime() - b.parsedDate!.getTime());

  const completedGames = teamGames.filter(
    (game) =>
      isFinalizedStatus(game.status) &&
      game.parsedAwayScore !== null &&
      game.parsedHomeScore !== null
  );

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  const results: Array<"W" | "L" | "T"> = [];

  for (const game of completedGames) {
    const isAway = normalizeTeamName(game.away) === normalizeTeamName(matchedTeam);
    const teamScore = isAway ? game.parsedAwayScore! : game.parsedHomeScore!;
    const opponentScore = isAway ? game.parsedHomeScore! : game.parsedAwayScore!;

    pointsFor += teamScore;
    pointsAgainst += opponentScore;

    if (teamScore > opponentScore) {
      wins++;
      results.push("W");
    } else if (teamScore < opponentScore) {
      losses++;
      results.push("L");
    } else {
      ties++;
      results.push("T");
    }
  }

  let currentStreak = "—";
  if (results.length) {
    const latest = results[results.length - 1];
    let length = 0;
    for (let index = results.length - 1; index >= 0; index--) {
      if (results[index] !== latest) break;
      length++;
    }
    currentStreak = `${latest}${length}`;
  }

  const today = getEasternToday();
  const nextGame = teamGames.find(
    (game) =>
      game.parsedDate!.getTime() >= today.getTime() &&
      !isFinalizedStatus(game.status)
  );
  const lastGame = completedGames.length
    ? completedGames[completedGames.length - 1]
    : null;

  let nextGameText = "No upcoming game";
  if (nextGame) {
    const isAway = normalizeTeamName(nextGame.away) === normalizeTeamName(matchedTeam);
    const opponent = isAway ? nextGame.home : nextGame.away;
    nextGameText = `${nextGame.date} ${isAway ? "at" : "vs"} ${getTeamEmoji(opponent)} ${opponent}`;
  }

  let lastGameText = "No completed games";
  if (lastGame) {
    const isAway = normalizeTeamName(lastGame.away) === normalizeTeamName(matchedTeam);
    const opponent = isAway ? lastGame.home : lastGame.away;
    const teamScore = isAway ? lastGame.parsedAwayScore! : lastGame.parsedHomeScore!;
    const opponentScore = isAway ? lastGame.parsedHomeScore! : lastGame.parsedAwayScore!;
    const result = teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T";
    lastGameText = `${lastGame.date}: ${result} vs ${getTeamEmoji(opponent)} ${opponent}, ${formatScore(teamScore)}-${formatScore(opponentScore)}`;
  }

  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const contracts = await getContracts();
  const teamContracts = contracts.filter(
    (contract) => normalizeTeamName(contract.team) === normalizeTeamName(matchedTeam)
  );
  const totalCapUsed = teamContracts.reduce(
    (total, contract) => total + contract.currentCapHit,
    0
  );
  const capRemaining = CAP_LIMIT - totalCapUsed;

  await client.replyToComment(
    activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam}

Record: ${record}
Next Game: ${nextGameText}
Last Game: ${lastGameText}
Current Streak: ${currentStreak}
Points For: ${formatScore(pointsFor)}
Points Against: ${formatScore(pointsAgainst)}
Cap Used: ${formatScore(totalCapUsed)} / ${formatScore(CAP_LIMIT)}
Cap Remaining: ${formatScore(capRemaining)}`
  );
}
