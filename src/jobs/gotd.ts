import "dotenv/config";

import { RealClient } from "../core/RealClient";
import { getSchedule } from "../google/ScheduleService";

function getEasternDateParts(): {
  isoDate: string;
  monthDay: string;
} {
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
    if (found) {
      return found;
    }
  }

  return null;
}

async function saveGotdPost(date: string, parentCommentId: string): Promise<void> {
  const apiUrl = String(process.env.LINEUP_API_URL || "").trim();

  if (!apiUrl) {
    throw new Error("LINEUP_API_URL is missing in Railway.");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "saveGotdPost",
      date,
      parentCommentId,
      postedAt: new Date().toISOString(),
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Could not save the GOTD post: ${response.status} ${response.statusText}. ${text.slice(0, 300)}`
    );
  }

  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`The lineup API returned invalid JSON: ${text.slice(0, 300)}`);
  }

  if (!data?.ok) {
    throw new Error(data?.message || "The lineup API did not save the GOTD post.");
  }
}

async function main() {
  const client = new RealClient();
  client.loadSession();

  const today = getEasternDateParts();
  const games = (await getSchedule()).filter(
    (game) => game.date === today.monthDay
  );

  if (games.length === 0) {
    console.log("No games today.");
    return;
  }

  const post = await client.postToGroup(
    "🏆 Vote for Game of the Day!\n\nUpvote the matchup reply you want to win."
  );

  const postId = extractCommentId(post);

  if (!postId) {
    throw new Error(
      `Real created the GOTD post, but its comment ID could not be found. Response: ${JSON.stringify(post)}`
    );
  }

  await saveGotdPost(today.isoDate, postId);

  for (const game of games) {
    await client.replyToComment(
      postId,
      `${game.away} vs ${game.home}`
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`Finished posting GOTD and saved parent comment ${postId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
