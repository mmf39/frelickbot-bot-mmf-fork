import "dotenv/config";

import { RealClient } from "../core/RealClient";

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

function getEasternIsoDate(): string {
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

  return `${year}-${month}-${day}`;
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

  return [...latestByTeam.values()].sort((a, b) =>
    String(a.team || "").localeCompare(String(b.team || ""))
  );
}

function formatLineup(lineup: SubmittedLineup): string {
  const team = String(lineup.team || "Unknown Team").trim();
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
    ...players.filter((player) => player.toLowerCase() !== captain.toLowerCase()),
  ];

  const lines = [`**${team}**`];

  if (!orderedPlayers.length) {
    lines.push("No lineup submitted.");
    return lines.join("\n");
  }

  orderedPlayers.forEach((player, index) => {
    lines.push(index === 0 && captain ? `⭐ ${player} (C)` : `• ${player}`);
  });

  return lines.join("\n");
}

async function main(): Promise<void> {
  const date = getEasternIsoDate();
  const gotdResponse = await callLineupApi("getGotdPost", { date });
  const gotdPost = findGotdPost(gotdResponse);

  if (!gotdPost?.parentCommentId) {
    console.log(`No saved GOTD post found for ${date}.`);
    return;
  }

  const lockStatus = String(
    gotdPost.lockPostStatus || gotdPost.status || ""
  )
    .trim()
    .toLowerCase();

  if (["posted", "complete", "completed", "sent"].includes(lockStatus)) {
    console.log(`The lineup-lock post was already sent for ${date}.`);
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
    winner?.plainText ?? winner?.text ?? "No GOTD winner"
  ).trim();
  const winnerKarma = Number(winner?.karma || 0);

  const lineupResponse = await callLineupApi("getSubmittedLineups", { date });
  const lineups = getLatestLineups(extractLineups(lineupResponse));

  const messageParts = [
    "🔒 Lineups are locked!",
    "",
    "🏆 **Game of the Day**",
    `${winnerText} (${winnerKarma} vote${winnerKarma === 1 ? "" : "s"})`,
  ];

  if (lineups.length) {
    messageParts.push("", ...lineups.map(formatLineup));
  } else {
    messageParts.push("", "No submitted lineups were found.");
  }

  await client.postToGroup(messageParts.join("\n\n"), groupId);

  await callLineupApi("markLineupLockPosted", {
    date,
    winner: winnerText,
    winnerKarma,
    postedAt: new Date().toISOString(),
  });

  console.log(
    `Posted lineup lock for ${date}. GOTD winner: ${winnerText} (${winnerKarma}).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
