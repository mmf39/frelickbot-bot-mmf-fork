import "dotenv/config";

import { RealClient } from "./core/RealClient";
import { handleActivity } from "./handlers/ActivityHandler";

const TRANSACTION_CHANNEL_ID = "2205570";
const COMMISSIONER_USER_ID = "Y3KdBmLn";
const TRANSACTION_GROUP_ID = "30139";

function extractMessageText(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractMessageText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  const children =
    value.children ??
    value.content ??
    value.nodes ??
    [];

  const text = extractMessageText(children);

  if (
    value.type === "paragraph" ||
    value.type === "Paragraph"
  ) {
    return `${text}\n`;
  }

  return text;
}

function findTransactionId(text: string): string {
  const match = text.match(
    /TX-\d{8}-\d{3}/i
  );

  return match ? match[0].toUpperCase() : "";
}

function formatTransactionType(type: string): string {
  const cleaned = String(type || "")
    .trim()
    .toLowerCase();

  if (cleaned === "sign") {
    return "Signing";
  }

  if (cleaned === "cut") {
    return "Cut";
  }

  if (cleaned === "trade") {
    return "Trade";
  }

  if (cleaned === "namechange") {
    return "Name Change";
  }

  return cleaned
    ? cleaned.charAt(0).toUpperCase() +
        cleaned.slice(1)
    : "Transaction";
}

async function approveTransaction(
  transactionId: string
): Promise<any> {
  const url =
    process.env.TRANSACTION_API_URL;

  if (!url) {
    throw new Error(
      "TRANSACTION_API_URL is missing."
    );
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "approveBotTransaction",
      transactionId,
      reviewedBy: COMMISSIONER_USER_ID,
      reviewedAt: new Date().toISOString(),
    }),
  });

  const responseText =
    await response.text();

  let result: any;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Apps Script returned invalid JSON: ${responseText.slice(
        0,
        200
      )}`
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      result.message ||
        `Approval failed with status ${response.status}.`
    );
  }

  return result;
}
type LiveScoreUser = {
  userId: string;
  player?: string;
};

type LiveScoreResult = {
  userId: string;
  val: number;
  rank: number;
};

const LIVE_SCORE_INTERVAL_MS =
  5 * 60 * 1000;

let liveScoreUpdateRunning = false;

async function sendLiveScoreRequest(
  url: string,
  options?: RequestInit
): Promise<any> {
  const response = await fetch(
    url,
    options
  );

  const text =
    await response.text();

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Apps Script returned invalid JSON: ${text.slice(
        0,
        200
      )}`
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      result.message ||
        `Apps Script request failed: ${response.status}`
    );
  }

  return result;
}

async function updateLiveScoresFromRailway(
  client: RealClient
): Promise<void> {
  if (liveScoreUpdateRunning) {
    console.log(
      "Live-score update already running."
    );
    return;
  }

  liveScoreUpdateRunning = true;

  try {
    const appsScriptUrl =
      process.env.LIVE_SCORE_API_URL;

    if (!appsScriptUrl) {
      throw new Error(
        "LIVE_SCORE_API_URL is missing."
      );
    }

    console.log(
      "Fetching active live-score users..."
    );

    const separator =
      appsScriptUrl.includes("?")
        ? "&"
        : "?";

    const input =
      await sendLiveScoreRequest(
        `${appsScriptUrl}${separator}action=getLiveScoreUsers`
      );

    const users: LiveScoreUser[] =
      Array.isArray(input.users)
        ? input.users
        : [];

    console.log(
      `Fetching scores for ${users.length} users.`
    );

    const scores: LiveScoreResult[] =
      [];

    const batchSize = 5;

    for (
      let start = 0;
      start < users.length;
      start += batchSize
    ) {
      const batch = users.slice(
        start,
        start + batchSize
      );

      const batchScores =
        await Promise.all(
          batch.map(async (user) => {
            const karma =
              await client.getKarmaFeed(
                user.userId
              );

            console.log(
              `${user.player || user.userId}: ${karma.val} | Rank ${karma.rank}`
            );

            return {
              userId: user.userId,
              val: karma.val,
              rank: karma.rank,
            };
          })
        );

      scores.push(...batchScores);

      if (
        start + batchSize <
        users.length
      ) {
        await new Promise(
          (resolve) =>
            setTimeout(resolve, 500)
        );
      }
    }

    const saved =
      await sendLiveScoreRequest(
        appsScriptUrl,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            action:
              "saveLiveScoresAndRefresh",
            leagueDate:
              input.leagueDate,
            scores,
          }),
        }
      );

    console.log(
      `✅ Live scores updated. ${saved.saved} scores saved.`
    );
  } catch (error) {
    console.error(
      "Live-score update failed:",
      error
    );
  } finally {
    liveScoreUpdateRunning = false;
  }
}
async function main() {
  const client = new RealClient();

  client.loadSession();
console.log(
  "Starting Railway live-score updater."
);

void updateLiveScoresFromRailway(
  client
);

setInterval(() => {
  void updateLiveScoresFromRailway(
    client
  );
}, LIVE_SCORE_INTERVAL_MS);
  console.log("==========================");
  console.log("FrelickBot Started");
  console.log("==========================");

  const seenActivityIds =
    new Set<string>();

  const seenMessageIds =
    new Set<string>();

  try {
    const initialActivity =
      await client.getActivity();

    for (
      const activity of
      initialActivity.activities ?? []
    ) {
      seenActivityIds.add(
        String(activity.id)
      );
    }

    console.log(
      `Loaded ${seenActivityIds.size} existing activities.`
    );
  } catch (error) {
    console.error(
      "Failed to load initial activity:",
      error
    );
  }

  try {
    const initialMessages =
      await client.getChannelMessages(
        TRANSACTION_CHANNEL_ID
      );

    for (
      const message of
      initialMessages.messages ?? []
    ) {
      seenMessageIds.add(
        String(message.id)
      );
    }

    console.log(
      `Loaded ${seenMessageIds.size} existing DM messages.`
    );
  } catch (error) {
    console.error(
      "Failed to load initial DM messages:",
      error
    );
  }

  while (true) {
    try {
      const activityData =
        await client.getActivity();

      for (
        const activity of
        activityData.activities ?? []
      ) {
        const activityId =
          String(activity.id);

        if (
          seenActivityIds.has(activityId)
        ) {
          continue;
        }

        seenActivityIds.add(activityId);

        await handleActivity(
          client,
          activity
        );
      }
    } catch (error) {
      console.error(
        "Activity polling error:",
        error
      );
    }

    try {
      const messageData =
        await client.getChannelMessages(
          TRANSACTION_CHANNEL_ID
        );

      const messages =
        messageData.messages ?? [];

      for (
        const message of
        [...messages].reverse()
      ) {
        const messageId =
          String(message.id);

        if (
          seenMessageIds.has(messageId)
        ) {
          continue;
        }

        seenMessageIds.add(messageId);

        const messageText =
          extractMessageText(
            message.content
          ).trim();

        console.log(
          `New DM from ${message.userId}: ${messageText}`
        );

        const isCommissioner =
          String(message.userId) ===
          COMMISSIONER_USER_ID;

        const isApproved =
          messageText.toLowerCase() ===
          "approved";

        if (
          !isCommissioner ||
          !isApproved
        ) {
          continue;
        }

        console.log(
          "✅ Commissioner approval detected"
        );

        const repliedText =
          extractMessageText(
            message.replyingToContent
          );

        const transactionId =
          findTransactionId(repliedText);

        if (transactionId) {
          console.log(
            `Approving replied transaction: ${transactionId}`
          );
        } else {
          console.log(
            "No reply transaction ID found. Approving pending transaction."
          );
        }

        try {
          const approved =
            await approveTransaction(
              transactionId
            );

          const team = String(
            approved.team || "Unknown Team"
          ).trim();

          const transactionType =
            formatTransactionType(
              approved.transactionType
            );

          const details = String(
            approved.details || ""
          ).trim();

          const groupPost = [
            `✅ ${team} Transaction`,
            `${team} ${transactionType} ${details}`.trim(),
          ].join("\n");

          await client.postToGroup(
  groupPost,
  TRANSACTION_GROUP_ID
);

          console.log(
            `✅ Posted approved transaction ${approved.transactionId}`
          );
        } catch (approvalError) {
          console.error(
            "Transaction approval failed:",
            approvalError
          );
        }
      }
    } catch (error) {
      console.error(
        "DM polling error:",
        error
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 2000)
    );
  }
}

main().catch(console.error);
