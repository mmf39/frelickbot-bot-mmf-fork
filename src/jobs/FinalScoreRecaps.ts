import "dotenv/config";

import { RealClient } from "../core/RealClient";
import {
  CompletedGame,
  CompletedPlayer,
  getCompletedGamesForLeagueDay,
} from "../google/CompletedGamesService";

const EASTERN_TIME_ZONE = "America/New_York";

function getEasternYesterdayMonthDay(): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "numeric",
    day: "numeric",
  });

  const easternTodayText = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [year, month, day] = easternTodayText
    .split("-")
    .map((value) => Number(value));

  const yesterday = new Date(Date.UTC(year, month - 1, day - 1, 12));

  return formatter.format(yesterday);
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatRank(rank: number): string {
  const lastTwo = rank % 100;

  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${rank}th`;
  }

  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

function normalizeUsername(username: string): string {
  const cleaned = String(username || "").trim();

  if (!cleaned) {
    return "@unknown";
  }

  return cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
}

function captainLabel(player: CompletedPlayer): string {
  return player.isCaptain ? `captain ${normalizeUsername(player.username)}` : normalizeUsername(player.username);
}

function sortByRank(players: CompletedPlayer[]): CompletedPlayer[] {
  return [...players]
    .filter((player) => Number.isFinite(player.rank) && player.rank > 0)
    .sort((a, b) => a.rank - b.rank);
}

function getTop100(players: CompletedPlayer[]): CompletedPlayer[] {
  return sortByRank(players).filter((player) => player.rank <= 100);
}

function getInsideRank(
  players: CompletedPlayer[],
  maximumRank: number
): CompletedPlayer[] {
  return players.filter(
    (player) =>
      Number.isFinite(player.rank) &&
      player.rank > 0 &&
      player.rank <= maximumRank
  );
}

function getCaptain(players: CompletedPlayer[]): CompletedPlayer | undefined {
  return players.find((player) => player.isCaptain);
}

function getPlayerOfGame(game: CompletedGame): CompletedPlayer {
  const allPlayers = [...game.away.players, ...game.home.players];

  if (allPlayers.length === 0) {
    throw new Error(
      `No players were found for ${game.away.team} vs ${game.home.team}.`
    );
  }

  return [...allPlayers].sort((a, b) => {
    const rankA = a.rank > 0 ? a.rank : Number.MAX_SAFE_INTEGER;
    const rankB = b.rank > 0 ? b.rank : Number.MAX_SAFE_INTEGER;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    return b.karma - a.karma;
  })[0];
}

function describeTop100Players(
  teamName: string,
  players: CompletedPlayer[]
): string {
  const top100 = getTop100(players);

  if (top100.length === 0) {
    return `${teamName} did not produce a Top 100 finish.`;
  }

  const descriptions = top100.map(
    (player) =>
      `${captainLabel(player)} (${formatRank(player.rank)})`
  );

  if (descriptions.length === 1) {
    return `${teamName} was led by ${descriptions[0]}, its only Top 100 finisher.`;
  }

  if (descriptions.length === 2) {
    return `${descriptions[0]} and ${descriptions[1]} both finished inside the Top 100 for ${teamName}.`;
  }

  const finalPlayer = descriptions.pop();

  return `${descriptions.join(", ")}, and ${finalPlayer} all finished inside the Top 100 for ${teamName}.`;
}

function describeDepth(teamName: string, players: CompletedPlayer[]): string {
  if (players.length === 0) {
    return "";
  }

  const top350Count = getInsideRank(players, 350).length;
  const top500Count = getInsideRank(players, 500).length;

  if (top350Count === players.length) {
    return `Every ${teamName} starter finished inside the Top 350.`;
  }

  if (top350Count >= players.length - 1) {
    return `${teamName} showed strong depth, with all but one starter finishing inside the Top 350.`;
  }

  if (top500Count === players.length) {
    return `The entire ${teamName} lineup avoided a major collapse, with every starter finishing inside the Top 500.`;
  }

  if (top350Count >= Math.ceil(players.length / 2)) {
    return `${teamName} received steady production through most of the lineup, with ${top350Count} starters inside the Top 350.`;
  }

  return `${teamName} struggled to find consistent production throughout the lineup.`;
}

function describeCaptain(
  teamName: string,
  players: CompletedPlayer[]
): string {
  const captain = getCaptain(players);

  if (!captain || captain.rank <= 0) {
    return "";
  }

  const username = normalizeUsername(captain.username);
  const rank = formatRank(captain.rank);

  if (captain.rank <= 25) {
    return `Captain ${username} delivered a major performance for ${teamName}, finishing ${rank} overall.`;
  }

  if (captain.rank <= 100) {
    return `Captain ${username} gave ${teamName} a valuable boost with a ${rank}-place finish.`;
  }

  if (captain.rank <= 350) {
    return `Captain ${username} remained competitive for ${teamName}, finishing ${rank} overall.`;
  }

  return `${teamName} did not receive the captain performance it needed, as ${username} finished ${rank} overall.`;
}

function determineWinner(game: CompletedGame) {
  if (game.away.score > game.home.score) {
    return {
      winner: game.away,
      loser: game.home,
    };
  }

  return {
    winner: game.home,
    loser: game.away,
  };
}

function describeOpening(game: CompletedGame): string {
  const { winner, loser } = determineWinner(game);
  const margin = Math.abs(winner.score - loser.score);
  const losingScore = Math.max(loser.score, 1);
  const marginPercent = margin / losingScore;

  if (margin <= 250) {
    return `${winner.team} survived a tight finish and held off ${loser.team} in one of the closest games of the day.`;
  }

  if (margin <= 750) {
    return `${winner.team} held the advantage in a competitive matchup and did enough to keep ${loser.team} from taking control.`;
  }

  if (marginPercent >= 0.35) {
    return `${winner.team} controlled this matchup and pulled away from ${loser.team} for a convincing victory.`;
  }

  if (marginPercent >= 0.15) {
    return `${winner.team} established the stronger lineup and kept ${loser.team} at arm's length.`;
  }

  return `${winner.team} controlled most of the matchup and never allowed ${loser.team} to completely erase the gap.`;
}

function describeDifference(game: CompletedGame): string {
  const { winner, loser } = determineWinner(game);

  const winnerTop100 = getTop100(winner.players).length;
  const loserTop100 = getTop100(loser.players).length;

  const winnerTop350 = getInsideRank(winner.players, 350).length;
  const loserTop350 = getInsideRank(loser.players, 350).length;

  const winnerCaptain = getCaptain(winner.players);
  const loserCaptain = getCaptain(loser.players);

  if (winnerTop100 >= loserTop100 + 2) {
    return `When both teams avoid a complete collapse, ${winnerTop100} Top 100 performances usually provide enough separation to win.`;
  }

  if (
    winnerCaptain &&
    loserCaptain &&
    winnerCaptain.rank > 0 &&
    loserCaptain.rank > 0 &&
    winnerCaptain.rank + 100 < loserCaptain.rank
  ) {
    return `The stronger captain performance ultimately became the difference between the two teams.`;
  }

  if (winnerTop350 === winner.players.length && loserTop350 < loser.players.length) {
    return `${winner.team}'s lineup depth proved decisive, as every starter stayed inside the Top 350.`;
  }

  if (winnerTop100 > loserTop100) {
    return `${winner.team}'s additional Top 100 production gave it the advantage in an otherwise competitive game.`;
  }

  if (winnerTop350 > loserTop350) {
    return `The matchup was decided by depth, with ${winner.team} receiving steadier production throughout its lineup.`;
  }

  return `${winner.team} found just enough extra production across the lineup to secure the victory.`;
}

function recordText(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

function describeRecordEnding(game: CompletedGame): string {
  const { winner, loser } = determineWinner(game);

  const winnerRecord = recordText(winner.wins, winner.losses);
  const loserRecord = recordText(loser.wins, loser.losses);

  const winnerStreak =
    winner.winStreak && winner.winStreak >= 2
      ? ` and has now won ${winner.winStreak} straight`
      : "";

  const loserStreak =
    loser.lossStreak && loser.lossStreak >= 2
      ? ` and has now lost ${loser.lossStreak} straight`
      : "";

  return `🔥 ${winner.team} improves to ${winnerRecord}${winnerStreak}, while ${loser.team} falls to ${loserRecord}${loserStreak}.`;
}

function buildTeamParagraph(
  teamName: string,
  players: CompletedPlayer[]
): string {
  const parts = [
    describeTop100Players(teamName, players),
    describeDepth(teamName, players),
    describeCaptain(teamName, players),
  ].filter(Boolean);

  return parts.join(" ");
}

function buildRecap(game: CompletedGame): string {
  const playerOfGame = getPlayerOfGame(game);

  const awayLine = `${game.away.emoji || "🏒"} ${game.away.team} ${formatNumber(
    game.away.score
  )} (${recordText(game.away.wins, game.away.losses)})`;

  const homeLine = `${game.home.emoji || "🏒"} ${game.home.team} ${formatNumber(
    game.home.score
  )} (${recordText(game.home.wins, game.home.losses)})`;

  return [
    "🏁 Final",
    "",
    awayLine,
    homeLine,
    "",
    "━━━━━━━━━━━━━━",
    "",
    describeOpening(game),
    "",
    buildTeamParagraph(game.away.team, game.away.players),
    "",
    buildTeamParagraph(game.home.team, game.home.players),
    "",
    describeDifference(game),
    "",
    "⭐ Player of the Game",
    normalizeUsername(playerOfGame.username),
    `#${playerOfGame.rank} Overall • ${formatNumber(
      playerOfGame.karma
    )} Karma`,
    "",
    describeRecordEnding(game),
  ]
    .filter((line, index, array) => {
      if (line !== "") {
        return true;
      }

      return index > 0 && array[index - 1] !== "";
    })
    .join("\n")
    .trim();
}

function getGameKey(game: CompletedGame): string {
  return [
    game.leagueDay,
    game.away.team.toLowerCase(),
    game.home.team.toLowerCase(),
  ].join("|");
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const client = new RealClient();
  client.loadSession();

  const leagueDay = getEasternYesterdayMonthDay();

  console.log(`Looking for completed games under League Day: ${leagueDay}`);

  const games = await getCompletedGamesForLeagueDay(leagueDay);

  if (games.length === 0) {
    console.log(`No completed games found for League Day: ${leagueDay}`);
    return;
  }

  console.log(`Found ${games.length} completed game(s).`);

  for (const game of games) {
    try {
      const gameKey = getGameKey(game);
      const recap = buildRecap(game);

      console.log(`Posting recap for ${gameKey}`);

      await client.postToGroup(recap);

      console.log(
        `Posted final score recap: ${game.away.team} vs ${game.home.team}`
      );

      await pause(1500);
    } catch (error) {
      console.error(
        `Could not post ${game.away.team} vs ${game.home.team}:`,
        error
      );
    }
  }

  console.log("Finished posting final score recaps.");
}

main().catch((error) => {
  console.error("Final-score recap job failed:", error);
  process.exitCode = 1;
});
