import "dotenv/config";

import { RealClient } from "../core/RealClient";
import { getSchedule } from "../google/ScheduleService";

type GotdPost = {
  date?: string;
  parentCommentId?: string | number;
  commentId?: string | number;
  lockPostStatus?: string;
  status?: string;
};

type SubmittedLineup = {
  team?: string;
  captain?: string;
  lineup?: string[];
  players?: string[];
  submittedAt?: string;
};

type CommentReply = {
  plainText?: string;
  text?: string;
  karma?: number | string;
};

type DateParts = {
  isoDate: string;
  monthDay: string;
};

function getEasternDateParts(): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not determine today's Eastern date.");
  }

  return {
    isoDate: `${year}-${month}-${day}`,
    monthDay: `${Number(month)}/${Number(day)}`,
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

function findGotdPost(data: any): GotdPost | null {
  const candidates = [data?.gotdPost, data?.post, data?.result, data?.data, data];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    const parentCommentId = candidate.parentCommentId ?? candidate.commentId;

    if (parentCommentId) {
      return {
        ...candidate,
        parentCommentId,
      };
    }
  }

  return null;
}

function extractCommentId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const candidates = [record.id, record.commentId, record.commentID];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  for (const nested of [record.comment, record.data, record.result, record.response]) {
    const found = extractCommentId(nested);
    if (found) return found;
  }

  return null;
}

function extractReplies(data: any): CommentReply[] {
  const candidates = [
    data,
    data?.comments,
    data?.replies,
    data?.results,
    data?.data,
    data?.data?.comments,
    data?.data?.replies,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
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

function normalizePlayer(value: unknown): string {
  const player = String(value || "").trim();

  if (!player) return "";

  return player.startsWith("@") ? player : `@${player}`;
}

function normalizeMatchupText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*(?:vs\.?|v\.)\s*/g, " vs ")
    .trim();
}

function chooseWinner(replies: CommentReply[]): CommentReply | null {
  return (
    replies
      .filter((reply) => String(reply.plainText ?? reply.text ?? "").trim())
      .sort((a, b) => Number(b.karma || 0) - Number(a.karma || 0))[0] ?? null
  );
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

  return [...new Set(orderedPlayers.map((player) => player.toLowerCase()))]
    .map((key) => orderedPlayers.find((player) => player.toLowerCase() === key) || "")
    .filter(Boolean)
    .slice(0, 6);
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
  const today = getEasternDateParts();
  const gotdResponse = await callLineupApi("getGotdPost", {
    date: today.isoDate,
  });
  const gotdPost = findGotdPost(gotdResponse);

  if (!gotdPost?.parentCommentId) {
    console.log(`No saved GOTD post found for ${today.isoDate}.`);
    return;
  }

  const lockStatus = String(
    gotdPost.lockPostStatus || gotdPost.status || ""
  )
    .trim()
    .toLowerCase();

  if (["posted", "complete", "completed", "sent"].includes(lockStatus)) {
    console.log(`The lineup-lock post was already sent for ${today.isoDate}.`);
    return;
  }

  const groupId = Number(process.env.REAL_GROUP_ID);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error("REAL_GROUP_ID is missing or invalid in Railway.");
  }

  const client = new RealClient();
  client.loadSession();

  const repliesResponse = await client.getFromReal(
    `/comments/groups/${groupId}/replies/${encodeURIComponent(
      String(gotdPost.parentCommentId)
    )}`,
    { limit: 100 }
  );

  const winner = chooseWinner(extractReplies(repliesResponse));
  const winnerText = String(
    winner?.plainText ?? winner?.text ?? ""
  ).trim();
  const winnerKarma = Number(winner?.karma || 0);

  const games = (await getSchedule()).filter(
    (game) => game.date === today.monthDay
  );

  if (!games.length) {
    console.log(`No scheduled matchups found for ${today.monthDay}.`);
    return;
  }

  const normalizedWinner = normalizeMatchupText(winnerText);
  const gotdGame =
    games.find(
      (game) =>
        normalizeMatchupText(`${game.away} vs ${game.home}`) === normalizedWinner
    ) || games[0];

  const lineupResponse = await callLineupApi("getSubmittedLineups", {
    date: today.isoDate,
  });
  const lineups = getLatestLineups(extractLineups(lineupResponse));

  const allMatchupsMessage = [
    `Lineups for ${today.monthDay}`,
    "",
    formatAllMatchups(games, lineups),
  ].join("\n");

  const lineupThreadPost = await client.postToGroup(allMatchupsMessage, groupId);
  const lineupThreadId = extractCommentId(lineupThreadPost);

  if (!lineupThreadId) {
    throw new Error(
      `Real sent the lineup DM, but its message ID could not be found. Response: ${JSON.stringify(
        lineupThreadPost
      )}`
    );
  }

  await callLineupApi("markLineupLockPosted", {
    date: today.isoDate,
    winner: winnerText,
    winnerKarma,
    lineupThreadCommentId: lineupThreadId,
    postedAt: new Date().toISOString(),
  });

  console.log(
    `Sent ${games.length} active matchup${games.length === 1 ? "" : "s"} by DM for ${today.isoDate}. GOTD: ${gotdGame.away} vs ${gotdGame.home}.`
  );
}

if (require.main === module) {
  runLineupLock().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
