import { getSchedule } from "./google/ScheduleService";
import { getRosters } from "./google/RostersService";
import { getContracts } from "./google/SalaryCapService";

const CAP_LIMIT = 5000;

const LINEUP_ADMIN_USER_IDS = ["Y3KdBmLn"];

const TEAM_LINEUP_SUBMITTER_USER_IDS: Record<string, string[]> = {
  turkeys: [],
  gusnem: [],
  thephantoms: [],
  illegals: [],
  pandas: [],
  superkings: [],
  dreamteam: ["wJ2Q7bLn"],
  badbois: [],
  scorpions: [],
  storm: [],
};

const DIVISIONS: Record<string, string[]> = {
  north: [
    "Turkeys",
    "Gus N Em",
    "The Phantoms",
    "Illegals",
    "Pandas",
  ],
  south: [
    "Super Kings",
    "Dream Team",
    "Bad Bois",
    "Scorpions",
    "Storm",
  ],
};

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@_shrek\s*/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function displayPlayerName(name: string): string {
  return name.replace(/^@/, "");
}



function getSubmittingUserId(activity: any): string {
  const possibleUserIds = [
    activity.userId,
    activity.user?.id,

    activity.additionalInfo?.userId,
    activity.additionalInfo?.user?.id,

    activity.comment?.userId,
    activity.comment?.user?.id,

    activity.additionalInfo?.comment?.userId,
    activity.additionalInfo?.comment?.user?.id,
  ];

  const userId =
    possibleUserIds.find(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0
    ) ?? "";

  const normalizedUserId = String(userId).trim();

  console.log(
    "Lineup submitter user ID:",
    JSON.stringify(normalizedUserId)
  );

  if (!normalizedUserId) {
    console.log(
      "Could not identify lineup submitter. Activity:",
      JSON.stringify(activity)
    );
  }

  return normalizedUserId;
}

function canSubmitLineupForTeam(
  userId: string,
  team: string
): boolean {
  if (!userId) {
    return false;
  }

  if (LINEUP_ADMIN_USER_IDS.includes(userId)) {
    return true;
  }

  const allowedUserIds =
    TEAM_LINEUP_SUBMITTER_USER_IDS[
      normalizeTeamName(team)
    ] ?? [];

  return allowedUserIds.includes(userId);
}

function parseScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
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
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return new Date(
    getPart("year"),
    getPart("month") - 1,
    getPart("day")
  );
}

function parseScheduleDate(value: string): Date | null {
  const match = value
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);

  let year = match[3] ? Number(match[3]) : getEasternYear();

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

  if (!search) {
    return null;
  }

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

function getTeamEmoji(team: string): string {
  switch (normalizeTeamName(team)) {
    case "turkeys":
      return "🦃";
    case "gusnem":
      return "💪";
    case "storm":
      return "⛈️";
    case "yetis":
      return "🏔️";
    case "cheerios":
      return "🥣";
    case "illegals":
      return "🕶️";
    case "thelions":
      return "🦁";
    case "thephantoms":
      return "👻";
    case "thesnipers":
      return "🎯";
    case "thefuture":
      return "🚀";
    case "pandas":
      return "🐼";
    case "superkings":
      return "👑";
    case "badbois":
      return "😈";
    case "dreamteam":
      return "💭";
    case "scorpions":
      return "🦂";
    case "bullets":
      return "💥";
    default:
      return "🛡️";
  }
}


type DivisionStanding = {
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  differential: number;
  gamesPlayed: number;
  winPercentage: number;
  gamesBehind: number;
};

function buildDivisionStandings(
  schedule: Awaited<ReturnType<typeof getSchedule>>,
  divisionTeams: string[]
): DivisionStanding[] {
  const standings = divisionTeams.map((team) => ({
    team,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    differential: 0,
    gamesPlayed: 0,
    winPercentage: 0,
    gamesBehind: 0,
  }));

  const standingByTeam = new Map(
    standings.map((standing) => [
      normalizeTeamName(standing.team),
      standing,
    ])
  );

  for (const game of schedule) {
    const status = String(game.status ?? "")
      .trim()
      .toLowerCase();

    if (status !== "completed" && status !== "complete") {
      continue;
    }

    const awayScore = parseScore(game.awayScore);
    const homeScore = parseScore(game.homeScore);

    if (awayScore === null || homeScore === null) {
      continue;
    }

    const awayStanding = standingByTeam.get(
      normalizeTeamName(game.away)
    );

    const homeStanding = standingByTeam.get(
      normalizeTeamName(game.home)
    );

    if (awayStanding) {
      awayStanding.gamesPlayed++;
      awayStanding.pointsFor += awayScore;
      awayStanding.pointsAgainst += homeScore;

      if (awayScore > homeScore) {
        awayStanding.wins++;
      } else if (awayScore < homeScore) {
        awayStanding.losses++;
      } else {
        awayStanding.ties++;
      }
    }

    if (homeStanding) {
      homeStanding.gamesPlayed++;
      homeStanding.pointsFor += homeScore;
      homeStanding.pointsAgainst += awayScore;

      if (homeScore > awayScore) {
        homeStanding.wins++;
      } else if (homeScore < awayScore) {
        homeStanding.losses++;
      } else {
        homeStanding.ties++;
      }
    }
  }

  for (const standing of standings) {
    standing.differential =
      standing.pointsFor - standing.pointsAgainst;

    standing.winPercentage =
      standing.gamesPlayed > 0
        ? (standing.wins + standing.ties * 0.5) /
          standing.gamesPlayed
        : 0;
  }

  standings.sort(
    (a, b) =>
      b.wins - a.wins ||
      b.winPercentage - a.winPercentage ||
      b.differential - a.differential ||
      b.pointsFor - a.pointsFor ||
      a.team.localeCompare(b.team)
  );

  const leader = standings[0];

  for (const standing of standings) {
    standing.gamesBehind = leader
      ? (
          (leader.wins + leader.ties * 0.5) -
          (standing.wins + standing.ties * 0.5) +
          (standing.losses + standing.ties * 0.5) -
          (leader.losses + leader.ties * 0.5)
        ) / 2
      : 0;
  }

  return standings;
}

function formatDivisionStandings(
  divisionName: string,
  standings: DivisionStanding[]
): string {
  const divisionEmoji =
    divisionName.toLowerCase() === "north" ? "🏔️" : "🌴";

  const rows = standings.map((standing, index) => {
    const record =
      standing.ties > 0
        ? `${standing.wins}-${standing.losses}-${standing.ties}`
        : `${standing.wins}-${standing.losses}`;

    const gamesBehind =
      standing.gamesBehind === 0
        ? "-"
        : Number.isInteger(standing.gamesBehind)
          ? String(standing.gamesBehind)
          : standing.gamesBehind.toFixed(1);

    return (
      `${index + 1}. ${getTeamEmoji(standing.team)} ` +
      `${standing.team}
` +
      `   Record: ${record} | GB: ${gamesBehind} | ` +
      `PF: ${formatScore(standing.pointsFor)} | ` +
      `PA: ${formatScore(standing.pointsAgainst)}`
    );
  });

  return (
    `--------------------\n` +
    `${divisionEmoji} ${divisionName} Division\n` +
    `--------------------\n\n` +
    rows.join("\n\n")
  );
}


function normalizePlayerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\s+/g, "");
}

function parseLineupCommand(
  rawText: string
): {
  teamText: string;
  players: string[];
  captain: string;
} | null {
  const commandMatch = rawText.match(/\$lineup\b/i);

  if (!commandMatch || commandMatch.index === undefined) {
    return null;
  }

  const afterCommand = rawText
    .slice(commandMatch.index + commandMatch[0].length)
    .replace(/\r/g, "");

  const lines = afterCommand
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^[-_=]{3,}$/.test(line)
    );

  if (lines.length < 7) {
    return null;
  }

  const teamText = lines[0];
  const playerLines = lines.slice(1, 7);

  let captain = "";
  const players = playerLines.map((line) => {
    const isCaptain =
      /\s+(?:c|\(c\)|captain)$/i.test(line);

    const player = line
      .replace(/\s+(?:c|\(c\)|captain)$/i, "")
      .trim();

    if (isCaptain) {
      if (captain) {
        throw new Error(
          "Please mark only one player as captain."
        );
      }

      captain = player;
    }

    return player;
  });

  return {
    teamText,
    players,
    captain,
  };
}

async function submitLineupToSheet(
  team: string,
  players: string[],
  captain: string
): Promise<{
  ok: boolean;
  message?: string;
}> {
  const lineupApiUrl = process.env.LINEUP_API_URL;

  if (!lineupApiUrl) {
    throw new Error(
      "LINEUP_API_URL is not configured."
    );
  }

  const response = await fetch(lineupApiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "submitLineup",
      team,
      lineup: players,
      captain,
      submittedAt: new Date().toISOString(),
    }),
  });

  const responseText = await response.text();

  let result: {
    ok: boolean;
    message?: string;
  };

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Lineup API returned an invalid response: ${responseText.slice(0, 200)}`
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      result.message ||
        `Lineup API failed with status ${response.status}.`
    );
  }

  return result;
}

function extractCommentText(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractCommentText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value.text === "string" && value.text.length > 0) {
    return value.text;
  }

  const mentionText =
    value.attrs?.label ??
    value.attrs?.username ??
    value.attrs?.displayName ??
    value.additionalInfo?.username ??
    value.username ??
    value.name;

  if (
    typeof mentionText === "string" &&
    (value.type === "mention" || value.type === "userMention")
  ) {
    return mentionText.startsWith("@")
      ? mentionText
      : `@${mentionText}`;
  }

  if (value.type === "hardBreak" || value.type === "lineBreak") {
    return "\n";
  }

  const nested =
    value.children ??
    value.content ??
    value.nodes ??
    [];

  const nestedText = extractCommentText(nested);

  if (
    value.type === "paragraph" ||
    value.type === "heading" ||
    value.type === "listItem"
  ) {
    return `${nestedText}\n`;
  }

  return nestedText;
}

export async function handleCommand(
  client: any,
  activity: any
): Promise<void> {
  const rawText = String(
  activity.additionalInfo?.comment?.plainText ??
  activity.comment?.plainText ??
  ""
).trim();

console.log("Raw plain text:", JSON.stringify(rawText));

  const fullText = rawText
    .replace(/\s+/g, " ")
    .trim();

  if (!fullText) {
    return;
  }

  console.log("Full message:", fullText);

  const commandMatch = fullText.match(/\$[a-z0-9_-]+/i);

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
$standing [division] - Show division standings
$roster [team] - Show a team's roster
$cap [team/all] - Show salary-cap information
$live [team] - Show live game scores
$lineup - Submit a six-player lineup
$[team] - Show a team's information

Examples:
@_shrek $schedule Gus N Em
@_shrek $standing north
@_shrek $standing south
@_shrek $roster Gus N Em
@_shrek $cap Gus N Em
@_shrek $cap all
@_shrek $live
@_shrek $live Gus N Em
@_shrek $lineup\nGus N Em\nPlayer 1\nPlayer 2 C\nPlayer 3\nPlayer 4\nPlayer 5\nPlayer 6
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

    case "$lineup": {
      let parsedLineup;

      try {
        parsedLineup = parseLineupCommand(rawText);
      } catch (error) {
        await client.replyToComment(
          activity.commentId,
          error instanceof Error
            ? error.message
            : "The lineup could not be read."
        );

        return;
      }

      if (!parsedLineup) {
        await client.replyToComment(
          activity.commentId,
`Use this exact format:

@_shrek $lineup
Gus N Em
Player 1
Player 2 C
Player 3
Player 4
Player 5
Player 6

Mark exactly one player with C.`
        );

        return;
      }

      if (!parsedLineup.captain) {
        await client.replyToComment(
          activity.commentId,
          "Please mark exactly one player with C."
        );

        return;
      }

      const rosters = await getRosters();
      const availableTeams = rosters.map(
        (roster) => roster.team
      );

      const matchedTeam = findMatchingTeam(
        parsedLineup.teamText,
        availableTeams
      );

      if (!matchedTeam) {
        await client.replyToComment(
          activity.commentId,
          `I could not find the team "${parsedLineup.teamText}".`
        );

        return;
      }

      const submittingUserId =
        getSubmittingUserId(activity);

      if (
        !submittingUserId ||
        !canSubmitLineupForTeam(
          submittingUserId,
          matchedTeam
        )
      ) {
        await client.replyToComment(
          activity.commentId,
          submittingUserId
            ? `Sorry, you are not allowed to submit a lineup for ${matchedTeam}.`
            : "I could not identify who submitted this lineup."
        );

        return;
      }

      const roster = rosters.find(
        (teamRoster) =>
          normalizeTeamName(teamRoster.team) ===
          normalizeTeamName(matchedTeam)
      );

      if (!roster) {
        await client.replyToComment(
          activity.commentId,
          `No roster was found for ${matchedTeam}.`
        );

        return;
      }

      const rosterPlayers = new Map(
        roster.players.map((player) => [
          normalizePlayerName(player),
          player,
        ])
      );

      const resolvedPlayers: string[] = [];
      const missingPlayers: string[] = [];

      for (const submittedPlayer of parsedLineup.players) {
        const rosterPlayer = rosterPlayers.get(
          normalizePlayerName(submittedPlayer)
        );

        if (!rosterPlayer) {
          missingPlayers.push(submittedPlayer);
          continue;
        }

        resolvedPlayers.push(rosterPlayer);
      }

      if (missingPlayers.length > 0) {
        await client.replyToComment(
          activity.commentId,
`These players were not found on the ${matchedTeam} roster:

${missingPlayers.map((player) => `• ${player}`).join("\n")}`
        );

        return;
      }

      const uniquePlayers = new Set(
        resolvedPlayers.map(normalizePlayerName)
      );

      if (uniquePlayers.size !== 6) {
        await client.replyToComment(
          activity.commentId,
          "The lineup must contain six different players."
        );

        return;
      }

      const resolvedCaptain = rosterPlayers.get(
        normalizePlayerName(parsedLineup.captain)
      );

      if (!resolvedCaptain) {
        await client.replyToComment(
          activity.commentId,
          `Captain "${parsedLineup.captain}" was not found on the roster.`
        );

        return;
      }

      try {
        await submitLineupToSheet(
          matchedTeam,
          resolvedPlayers,
          resolvedCaptain
        );

        await client.replyToComment(
          activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam} lineup submitted.

${resolvedPlayers
  .map(
    (player) =>
      `• ${displayPlayerName(player)}${
        normalizePlayerName(player) ===
        normalizePlayerName(resolvedCaptain)
          ? " C"
          : ""
      }`
  )
  .join("\n")}`
        );
      } catch (error) {
        console.error("Lineup submission failed:", error);

        await client.replyToComment(
          activity.commentId,
          error instanceof Error
            ? `Lineup submission failed: ${error.message}`
            : "Lineup submission failed."
        );
      }

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
      const availableTeams = rosters.map((roster) => roster.team);

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
`${getTeamEmoji(matchedTeam)} ${matchedTeam} Roster

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
          const currentTotal = teamTotals.get(contract.team) ?? 0;

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
              `${getTeamEmoji(team)} ${team} | ` +
              `${formatScore(capUsed)} used | ` +
              `${formatScore(capRemaining)} remaining`
            );
          })
          .join("\n");

        const leagueTotal = Array.from(teamTotals.values()).reduce(
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
        new Set(contracts.map((contract) => contract.team))
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
        (total, contract) => total + contract.currentCapHit,
        0
      );

      const capRemaining = CAP_LIMIT - totalCapUsed;

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
`${getTeamEmoji(matchedTeam)} ${matchedTeam} Salary Cap

Player | Total Rax | Years Left | Cap Hit
${contractText}

Cap Used: ${formatScore(totalCapUsed)} / ${formatScore(CAP_LIMIT)}
Cap Remaining: ${formatScore(capRemaining)}`
      );

      return;
    }

    case "$live": {
      const schedule = await getSchedule();

      const liveGames = schedule.filter((game) => {
        const status = String(game.status ?? "")
          .trim()
          .toLowerCase();

        return status === "in progress" || status === "live";
      });

      if (liveGames.length === 0) {
        await client.replyToComment(
          activity.commentId,
          "📺 There are no live games right now."
        );

        return;
      }

      let gamesToShow = liveGames;
      let matchedTeam: string | null = null;

      if (argumentsText) {
        const availableTeams = Array.from(
          new Set(
            liveGames.flatMap((game) => [
              game.away,
              game.home,
            ])
          )
        );

        matchedTeam = findMatchingTeam(
          argumentsText,
          availableTeams
        );

        if (!matchedTeam) {
          const allScheduleTeams = Array.from(
            new Set(
              schedule.flatMap((game) => [
                game.away,
                game.home,
              ])
            )
          );

          const existingTeam = findMatchingTeam(
            argumentsText,
            allScheduleTeams
          );

          if (existingTeam) {
            await client.replyToComment(
              activity.commentId,
              `📺 ${getTeamEmoji(existingTeam)} ${existingTeam} does not have a live game right now.`
            );
          } else {
            await client.replyToComment(
              activity.commentId,
              `I could not find the team "${argumentsText}".`
            );
          }

          return;
        }

        gamesToShow = liveGames.filter(
          (game) =>
            normalizeTeamName(game.away) ===
              normalizeTeamName(matchedTeam!) ||
            normalizeTeamName(game.home) ===
              normalizeTeamName(matchedTeam!)
        );

        if (gamesToShow.length === 0) {
          await client.replyToComment(
            activity.commentId,
            `📺 ${getTeamEmoji(matchedTeam)} ${matchedTeam} does not have a live game right now.`
          );

          return;
        }
      }

      const liveGameLines = gamesToShow
        .map((game) => {
          const awayScore = parseScore(game.awayScore) ?? 0;
          const homeScore = parseScore(game.homeScore) ?? 0;

          return (
            `${getTeamEmoji(game.away)} ${game.away} ` +
            `${formatScore(awayScore)} - ${formatScore(homeScore)} ` +
            `${game.home} ${getTeamEmoji(game.home)}`
          );
        })
        .join("\n");

      const title = matchedTeam
        ? `📺 ${getTeamEmoji(matchedTeam)} ${matchedTeam} Live Game`
        : "📺 Live Games";

      await client.replyToComment(
        activity.commentId,
`${title}

${liveGameLines}`
      );

      return;
    }

    case "$standing":
    case "$standings": {
      const requestedDivision = argumentsText
        .trim()
        .toLowerCase();

      if (
        requestedDivision &&
        requestedDivision !== "north" &&
        requestedDivision !== "south"
      ) {
        await client.replyToComment(
          activity.commentId,
`Please enter North or South.

Examples:
@_shrek $standing north
@_shrek $standing south

You can also use:
@_shrek $standing`
        );

        return;
      }

      const schedule = await getSchedule();

      // No division entered: send North and South as two separate replies.
      if (!requestedDivision) {
        const northStandings = formatDivisionStandings(
          "North",
          buildDivisionStandings(
            schedule,
            DIVISIONS.north
          )
        );

        const southStandings = formatDivisionStandings(
          "South",
          buildDivisionStandings(
            schedule,
            DIVISIONS.south
          )
        );

        await client.replyToComment(
          activity.commentId,
          northStandings
        );

        await client.replyToComment(
          activity.commentId,
          southStandings
        );

        return;
      }

      // A division was entered: send only that division.
      const standings = buildDivisionStandings(
        schedule,
        DIVISIONS[requestedDivision]
      );

      const divisionName =
        requestedDivision.charAt(0).toUpperCase() +
        requestedDivision.slice(1);

      await client.replyToComment(
        activity.commentId,
        formatDivisionStandings(
          divisionName,
          standings
        )
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
          `• ${game.date}: ${getTeamEmoji(game.away)} ${game.away} vs ${game.home} ${getTeamEmoji(game.home)}`
      );

      await client.replyToComment(
        activity.commentId,
`${getTeamEmoji(matchedTeam)} ${matchedTeam} Schedule

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
    const latestResult = results[results.length - 1];
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

    currentStreak = `${latestResult}${streakLength}`;
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
      ? completedGames[completedGames.length - 1]
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
      `${isAway ? "at" : "vs"} ` +
      `${getTeamEmoji(opponent)} ${opponent}`;
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
      `${lastGame.date}: ${result} vs ` +
      `${getTeamEmoji(opponent)} ${opponent}, ` +
      `${formatScore(teamScore)}-${formatScore(opponentScore)}`;
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
