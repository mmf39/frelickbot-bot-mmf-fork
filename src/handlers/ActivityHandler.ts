import { handleCommand } from "../CommandHandler";
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

export async function handleActivity(
  client: any,
  activity: any
): Promise<void> {
  const allowedActivityTypes = [
    "mention",
    "reply",
  ];

  if (!allowedActivityTypes.includes(activity.type)) {
    return;
  }

  const session = client.getSession();

  const activityUserId = String(
    activity.createdBy?.id ??
    activity.createdByUserId ??
    activity.authorUserId ??
    ""
  ).trim();

  if (
    activityUserId &&
    activityUserId === session?.userId
  ) {
    return;
  }

  if (activity.type === "reply") {
    const handled = await handleFreeAgencyReply(
      client,
      activity
    );

    if (handled) {
      return;
    }
  }

  const dmChannelId = getDmChannelIdForUser(activityUserId);

  if (!dmChannelId) {
    console.error(
      `No DM channel is configured for command caller ${activityUserId || "unknown"}. Add it to REAL_DM_CHANNELS_JSON.`
    );
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
    await handleCommand(client, activity);
  } finally {
    client.replyToComment = originalReplyToComment;
  }
}
