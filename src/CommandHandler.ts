import { getSchedule } from "./google/ScheduleService";
import { getRosters } from "./google/RostersService";
import { getContracts } from "./google/SalaryCapService";

const CAP_LIMIT = 5000;

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@_shrek\s*/i, "")
    .replace(/[^a-z0-9]/g, "");
}
function displayPlayerName(name: string): string {
  return name.replace(/^@/, "");
}
function parseScore(value: string): number | null {
  if (!value) {
    return null;
  }

  const cleaned = String(value)
    .replace(/,/g, "")
    .trim();

  const score = Number(cleaned);

  return Number.isFinite(score) ? score : null;
}

function getEasternYear(): number {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());

  return Number(year);
}

function getEasternToday(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type: string): number =>
    Number(
      parts.find((part) => part.type === type)?.value ?? 0
    );

  return new Date(
    getPart("year"),
    getPart("month") - 1,
    getPart("day")
  );
}

function parseScheduleDate(value: string): Date | null {
  const match = value
    .trim()
    .match(
      /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/
    );

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);

  let year = match[3]
    ? Number(match[3])
    : getEasternYear();

  if (year < 100) {
    year += 2000;
  }

  return new Date(year, month - 1, day);
}

function formatScore(score: number): string {
  return score.toLocaleString("en-US");
}

function findMatchingTeam(
  searchText: string,
  availableTeams: string[]
): string | null {
  const search = normalizeTeamName(searchText);

  const exactMatch = availableTeams.find(
    (team) => normalizeTeamName(team) === search
  );

  if (exactMatch) {
    return exactMatch;
  }

  const partialMatches = availableTeams.filter((team) => {
    const normalizedTeam = normalizeTeamName(team);

    return (
      normalizedTeam.includes(search) ||
      search.includes(normalizedTeam)
    );
  });

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  return null;
}

export async function handleCommand(
  client: any,
  activity: any
): Promise<void> {
  const children =
    activity.additionalInfo?.comment?.content?.nodes?.[0]
      ?.children ?? [];

  const fullText = children
    .map((child: any) => String(child.text ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!fullText) {
    return;
  }

  console.log("Full message:", fullText);

  const commandMatch = fullText.match(
    /\$[a-z0-9_-]+/i
  );

  if (!commandMatch) {
    console.log("No command found.");
    return;
  }

  const command = commandMatch[0].toLowerCase();
  const commandIndex = commandMatch.index ?? 0;

  const argumentsText = fullText
    .slice(commandIndex + commandMatch[0].length)
    .trim();

  console.log("Command received:", command);
  console.log("Arguments:", argumentsText);

  switch (command) {
    case "$help": {
      await client.replyToComment(
        activity.commentId,
`📖 Shrek Help

$help - Show this menu
$ping - Test the bot
$schedule [team] - Show a team's full schedule
$roster [team] - Show a team's roster
$cap [team] - Show a team's salary-cap information
$[team] - Show a team's information


Examples:
@_shrek $schedule Gus N Em
@_shrek $roster Gus N Em
@_shrek $cap Gus N Em
@_shrek $Gus N Em`

      );

      return;
    }

    case "$ping": {
      await client.replyToComment(
        activity.commentId,
        "🏓 Pong!"
      );

      return;
    }

    case "$roster": {
      if (!argumentsText) {
        await client.replyToComment(
          activity.commentId,
`Please enter a team name.

Example:
@_shrek $roster Gus N Em`
        );

        return;
      }

      const rosters = await getRosters();

      const availableTeams = rosters.map(
        (roster) => roster.team
      );

      const matchedTeam = findMatchingTeam(
        argumentsText,
        availableTeams
      );

      if (!matchedTeam) {
        await client.replyToComment(
          activity.commentId,
          `I could not find the team "${argumentsText}".`
        );

        return;
      }

      const roster = rosters.find(
        (teamRoster) =>
          normalizeTeamName(teamRoster.team) ===
          normalizeTeamName(matchedTeam)
      );

      if (!roster || roster.players.length === 0) {
        await client.replyToComment(
          activity.commentId,
          `No roster was found for ${matchedTeam}.`
        );

        return;
      }

     const rosterLines = roster.players.map(
  (player) => `• ${displayPlayerName(player)}`
);

await client.replyToComment(
  activity.commentId,
`👥 ${matchedTeam} Roster

${rosterLines.join("\n")}`
);

      return;
    }
case "$cap": {
  if (!argumentsText) {
    await client.replyToComment(
      activity.commentId,
`Please enter a team name or "all".

Examples:
@_shrek $cap Gus N Em
@_shrek $cap all`
    );

    return;
  }

  const contracts = await getContracts();

  if (argumentsText.trim().toLowerCase() === "all") {
    const teamTotals = new Map<string, number>();

    for (const contract of contracts) {
      const currentTotal =
        teamTotals.get(contract.team) ?? 0;

      teamTotals.set(
        contract.team,
        currentTotal + contract.currentCapHit
      );
    }

    const capLines = Array.from(teamTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([team, capUsed]) => {
        const capRemaining = CAP_LIMIT - capUsed;

        return (
          `• ${team} | ` +
          `${formatScore(capUsed)} used | ` +
          `${formatScore(capRemaining)} remaining`
        );
      })
      .join("\n");

    const leagueTotal = Array.from(
      teamTotals.values()
    ).reduce(
      (total, capHit) => total + capHit,
      0
    );

    await client.replyToComment(
      activity.commentId,
`💰 League Salary Cap

Team | Cap Used | Cap Remaining
${capLines}

League Total Used: ${formatScore(leagueTotal)} Rax`
    );

    return;
  }

  const availableTeams = Array.from(
    new Set(
      contracts.map((contract) => contract.team)
    )
  );

  const matchedTeam = findMatchingTeam(
    argumentsText,
    availableTeams
  );

  if (!matchedTeam) {
    await client.replyToComment(
      activity.commentId,
      `I could not find the team "${argumentsText}".`
    );

    return;
  }

  const teamContracts = contracts.filter(
    (contract) =>
      normalizeTeamName(contract.team) ===
      normalizeTeamName(matchedTeam)
  );

  if (teamContracts.length === 0) {
    await client.replyToComment(
      activity.commentId,
      `No salary-cap information was found for ${matchedTeam}.`
    );

    return;
  }

  const totalCapUsed = teamContracts.reduce(
    (total, contract) =>
      total + contract.currentCapHit,
    0
  );

  const capRemaining =
    CAP_LIMIT - totalCapUsed;

  const contractText = teamContracts
    .map((contract) => {
      return (
        `• ${displayPlayerName(contract.player)} | ` +
        `${formatScore(contract.totalRax)} total Rax | ` +
        `${contract.yearsLeft} year${
          contract.yearsLeft === 1 ? "" : "s"
        } left | ` +
        `${formatScore(contract.currentCapHit)} cap hit`
      );
    })
    .join("\n");

  await client.replyToComment(
    activity.commentId,
`💰 ${matchedTeam} Salary Cap

Player | Total Rax | Years Left | Cap Hit
${contractText}

Cap Used: ${formatScore(totalCapUsed)} / ${formatScore(CAP_LIMIT)}
Cap Remaining: ${formatScore(capRemaining)}`
  );

  return;
}
    case "$schedule": {
      if (!argumentsText) {
        await client.replyToComment(
          activity.commentId,
`Please enter a team name.

Example:
@_shrek $schedule Gus N Em`
        );

        return;
      }

      const schedule = await getSchedule();

      const availableTeams = Array.from(
        new Set(
          schedule.flatMap((game) => [
            game.away,
            game.home,
          ])
        )
      );

      const matchedTeam = findMatchingTeam(
        argumentsText,
        availableTeams
      );

      if (!matchedTeam) {
        await client.replyToComment(
          activity.commentId,
          `I could not find the team "${argumentsText}".`
        );

        return;
      }

      const teamSchedule = schedule.filter(
        (game) =>
          normalizeTeamName(game.away) ===
            normalizeTeamName(matchedTeam) ||
          normalizeTeamName(game.home) ===
            normalizeTeamName(matchedTeam)
      );

      const lines = teamSchedule.map(
        (game) =>
          `• ${game.date}: ${game.away} vs ${game.home}`
      );

      await client.replyToComment(
        activity.commentId,
`📅 ${matchedTeam} Schedule

${lines.join("\n")}`
      );

      return;
    }
  }

  const teamSearchText = [
    command.replace(/^\$/, ""),
    argumentsText,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const schedule = await getSchedule();

  const availableTeams = Array.from(
    new Set(
      schedule.flatMap((game) => [
        game.away,
        game.home,
      ])
    )
  );

  const matchedTeam = findMatchingTeam(
    teamSearchText,
    availableTeams
  );

  if (!matchedTeam) {
    await client.replyToComment(
      activity.commentId,
`I could not find the team "${teamSearchText}".

Use $help to see the available commands.`
    );

    return;
  }

  const teamGames = schedule
    .filter(
      (game) =>
        normalizeTeamName(game.away) ===
          normalizeTeamName(matchedTeam) ||
        normalizeTeamName(game.home) ===
          normalizeTeamName(matchedTeam)
    )
    .map((game) => ({
      ...game,
      parsedDate: parseScheduleDate(game.date),
      parsedAwayScore: parseScore(game.awayScore),
      parsedHomeScore: parseScore(game.homeScore),
    }))
    .filter((game) => game.parsedDate !== null)
    .sort(
      (a, b) =>
        a.parsedDate!.getTime() -
        b.parsedDate!.getTime()
    );

  const completedGames = teamGames.filter(
    (game) =>
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
    const isAway =
      normalizeTeamName(game.away) ===
      normalizeTeamName(matchedTeam);

    const teamScore = isAway
      ? game.parsedAwayScore!
      : game.parsedHomeScore!;

    const opponentScore = isAway
      ? game.parsedHomeScore!
      : game.parsedAwayScore!;

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

  if (results.length > 0) {
    const latestResult =
      results[results.length - 1];

    let streakLength = 0;

    for (
      let index = results.length - 1;
      index >= 0;
      index--
    ) {
      if (results[index] !== latestResult) {
        break;
      }

      streakLength++;
    }

    currentStreak =
      `${latestResult}${streakLength}`;
  }

  const today = getEasternToday();

  const nextGame = teamGames.find(
    (game) =>
      game.parsedDate!.getTime() >= today.getTime() &&
      !(
        game.parsedAwayScore !== null &&
        game.parsedHomeScore !== null
      )
  );

  const lastGame =
    completedGames.length > 0
      ? completedGames[
          completedGames.length - 1
        ]
      : null;

  let nextGameText = "No upcoming game";

  if (nextGame) {
    const isAway =
      normalizeTeamName(nextGame.away) ===
      normalizeTeamName(matchedTeam);

    const opponent = isAway
      ? nextGame.home
      : nextGame.away;

    nextGameText =
      `${nextGame.date} ` +
      `${isAway ? "at" : "vs"} ${opponent}`;
  }

  let lastGameText = "No completed games";

  if (lastGame) {
    const isAway =
      normalizeTeamName(lastGame.away) ===
      normalizeTeamName(matchedTeam);

    const opponent = isAway
      ? lastGame.home
      : lastGame.away;

    const teamScore = isAway
      ? lastGame.parsedAwayScore!
      : lastGame.parsedHomeScore!;

    const opponentScore = isAway
      ? lastGame.parsedHomeScore!
      : lastGame.parsedAwayScore!;

    const result =
      teamScore > opponentScore
        ? "W"
        : teamScore < opponentScore
          ? "L"
          : "T";

    lastGameText =
      `${lastGame.date}: ${result} vs ${opponent}, ` +
      `${formatScore(teamScore)}-${formatScore(
        opponentScore
      )}`;
  }

  const record =
  ties > 0
    ? `${wins}-${losses}-${ties}`
    : `${wins}-${losses}`;

const contracts = await getContracts();

const teamContracts = contracts.filter(
  (contract) =>
    normalizeTeamName(contract.team) ===
    normalizeTeamName(matchedTeam)
);

const totalCapUsed = teamContracts.reduce(
  (total, contract) =>
    total + contract.currentCapHit,
  0
);

const capRemaining =
  CAP_LIMIT - totalCapUsed;

await client.replyToComment(
    activity.commentId,
`🏆 ${matchedTeam}

Record: ${record}
Next Game: ${nextGameText}
Last Game: ${lastGameText}
Current Streak: ${currentStreak}
Points For: ${formatScore(pointsFor)}
Points Against: ${formatScore(pointsAgainst)}`
  );
}
