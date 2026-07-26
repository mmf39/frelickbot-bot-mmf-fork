import { handleCommand } from "../PatchedCommandHandler";
import {
  buildStatusMessage,
  isStatusCommand,
} from "../commands/StatusCommand";
import {
  buildWhoHasMessage,
  parseWhoHasCommand,
} from "../commands/WhoHasCommand";
import { handleFreeAgencyReply } from "./FreeAgencyHandler";

const COMMISSIONER_USER_ID = "Y3KdBmLn";

function getDmChannelIdForUser(userId: string): string {
  const cleanedUserId = String(userId || "").trim();

  if (!cleanedUserId) {
    return "";
  }

  const configuredMap = process.env.REAL_DM_CHANNELS_JSON;

  if (configuredMap) {
    try {
      const parsed = JSON.parse(configuredMap) as Record<string, unknown>;
      const mappedChannelId = String(parsed[cleanedUserId] ?? "").trim();

      if (mappedChannelId) {
        return mappedChannelId;
      }
    } catch (error) {
      console.error(
        "REAL_DM_CHANNELS_JSON contains invalid JSON:",
        error
      );
    }
  }

  if (cleanedUserId === COMMISSIONER_USER_ID) {
    return String(
      process.env.TRANSACTION_DM_CHANNEL_ID ?? "2205570"
    ).trim();
  }

  return "";
}

function extractText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item))
      .filter(Boolean)
      .join("\n");
  }

  const type = String(value.type ?? value.nodeType ?? "").toLowerCase();
  const username = String(
    value.username ??
      value.userName ??
      value.handle ??
      value.user?.username ??
      value.user?.userName ??
      ""
  ).trim();

  if (
    username &&
    (type.includes("mention") ||
      value.userId ||
      value.user?.id)
  ) {
    return username.startsWith("@") ? username : `@${username}`;
  }

  if (typeof value.plainText === "string" && value.plainText.trim()) {
    return value.plainText;
  }

  if (typeof value.text === "string" && value.text.trim()) {
    return value.text;
  }

  return extractText(
    value.children ?? value.content ?? value.nodes ?? []
  );
}

function cleanActivityCandidate(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getActivityText(activity: any): string {
  const candidates = [
    activity.additionalInfo?.comment?.plainText,
    activity.comment?.plainText,
    activity.message?.plainText,
    activity.additionalInfo?.message?.plainText,
    extractText(activity.additionalInfo?.comment?.content),
    extractText(activity.comment?.content),
    extractText(activity.message?.content),
    extractText(activity.additionalInfo?.message?.content),
    extractText(activity.content),
  ]
    .map(cleanActivityCandidate)
    .filter(Boolean);

  if (candidates.length === 0) {
    return "";
  }

  return candidates.reduce((best, candidate) =>
    candidate.length > best.length ? candidate : best
  );
}

function getActivityUserId(activity: any): string {
  return String(
    activity.createdBy?.id ??
      activity.createdByUserId ??
      activity.authorUserId ??
      activity.userId ??
      activity.message?.userId ??
      activity.additionalInfo?.message?.userId ??
      ""
  ).trim();
}

function getActivityChannelId(activity: any): string {
  return String(
    activity.channelId ??
      activity.message?.channelId ??
      activity.additionalInfo?.message?.channelId ??
      activity.additionalInfo?.channelId ??
      ""
  ).trim();
}

function isDirectMessageActivity(activity: any): boolean {
  const type = String(activity.type || "").toLowerCase();

  return (
    type === "message" ||
    type === "directmessage" ||
    type === "direct_message" ||
    type === "dm" ||
    Boolean(getActivityChannelId(activity))
  );
}

export async function handleActivity(
  client: any,
  activity: any
): Promise<void> {
  const allowedActivityTypes = [
    "mention",
    "reply",
    "message",
    "directmessage",
    "direct_message",
    "dm",
  ];

  const activityType = String(activity.type || "").toLowerCase();

  if (
    !allowedActivityTypes.includes(activityType) &&
    !isDirectMessageActivity(activity)
  ) {
    return;
  }

  const session = client.getSession();
  const activityUserId = getActivityUserId(activity);
  const sessionAuthInfo = String(session?.authInfo ?? "");
  const botUserId = sessionAuthInfo.split("!")[0]?.trim() || "";

  if (
    activityUserId &&
    botUserId &&
    activityUserId === botUserId
  ) {
    return;
  }

  if (activityType === "reply") {
    const handled = await handleFreeAgencyReply(
      client,
      activity
    );

    if (handled) {
      return;
    }
  }

  const directChannelId = getActivityChannelId(activity);
  const dmChannelId =
    directChannelId || getDmChannelIdForUser(activityUserId);

  if (!dmChannelId) {
    console.error(
      `No DM channel is configured for command caller ${activityUserId || "unknown"}. Add it to REAL_DM_CHANNELS_JSON.`
    );
    return;
  }

  const commandText = getActivityText(activity);

  if (!/[$@][a-z0-9_-]+/i.test(commandText)) {
    return;
  }

  const originalReplyToComment = client.replyToComment.bind(client);

  client.replyToComment = async (
    _parentCommentId: string,
    text: string
  ): Promise<any> => {
    console.log(
      `Sending private command response to ${activityUserId} in channel ${dmChannelId}.`
    );

    return client.sendChannelMessage(
      text,
      dmChannelId
    );
  };

  try {
    if (isStatusCommand(commandText)) {
      const statusMessage = await buildStatusMessage(activityUserId);
      await client.sendChannelMessage(statusMessage, dmChannelId);
      return;
    }

    const whoHasPlayer = parseWhoHasCommand(commandText);

    if (whoHasPlayer !== null) {
      const whoHasMessage = await buildWhoHasMessage(whoHasPlayer);
      await client.sendChannelMessage(whoHasMessage, dmChannelId);
      return;
    }

    const normalizedActivity = {
      ...activity,
      commentId:
        activity.commentId ??
        activity.message?.id ??
        activity.id ??
        "dm-command",
      authorUserId: activityUserId,
      additionalInfo: {
        ...(activity.additionalInfo ?? {}),
        comment: {
          ...(activity.additionalInfo?.comment ?? {}),
          plainText: commandText,
          authorUserId: activityUserId,
        },
      },
      comment: {
        ...(activity.comment ?? {}),
        plainText: commandText,
        authorUserId: activityUserId,
      },
    };

    await handleCommand(client, normalizedActivity);
  } catch (error) {
    console.error("Command handling failed:", error);

    await client.sendChannelMessage(
      error instanceof Error
        ? `Command failed: ${error.message}`
        : "Command failed.",
      dmChannelId
    );
  } finally {
    client.replyToComment = originalReplyToComment;
  }
}
