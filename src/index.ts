import "dotenv/config";

import { RealClient } from "./core/RealClient";
import { handleActivity } from "./handlers/ActivityHandler";

const TRANSACTION_CHANNEL_ID = "2205570";
const COMMISSIONER_USER_ID = "Y3KdBmLn";

function getMessageText(content: any): string {
  const nodes = content?.nodes;

  if (!Array.isArray(nodes)) {
    return "";
  }

  const textParts: string[] = [];

  for (const node of nodes) {
    const children = node?.children;

    if (!Array.isArray(children)) {
      continue;
    }

    for (const child of children) {
      if (
        child?.type === "Text" &&
        typeof child.text === "string"
      ) {
        textParts.push(child.text);
      }

      if (
        child?.type === "Mention" &&
        typeof child.name === "string"
      ) {
        textParts.push(`@${child.name}`);
      }
    }
  }

  return textParts.join(" ").trim();
}

async function main() {
  const client = new RealClient();

  client.loadSession();

  console.log("==========================");
  console.log("FrelickBot Started");
  console.log("==========================");

  const seenActivityIds = new Set<string>();
  const seenMessageIds = new Set<string>();

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

        const text =
          getMessageText(
            message.content
          );

        console.log(
          `New DM from ${message.userId}: ${text}`
        );

        const isCommissioner =
          String(message.userId) ===
          COMMISSIONER_USER_ID;

        const isApproved =
          text.trim().toLowerCase() ===
          "approved";

        if (
          isCommissioner &&
          isApproved
        ) {
          console.log(
            "✅ Commissioner approval detected"
          );

          console.log(
            "Replying to message:",
            message.replyingToMessageId
          );

          console.log(
            "Replied transaction:",
            getMessageText(
              message.replyingToContent
            )
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
