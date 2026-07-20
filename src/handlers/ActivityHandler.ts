import { handleCommand } from "../CommandHandler";
import { handleFreeAgencyReply } from "./FreeAgencyHandler";

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
  );

  if (
    activityUserId &&
    activityUserId === session?.userId
  ) {
    return;
  }

  // Handle Free Agency replies first
  if (activity.type === "reply") {
    const handled = await handleFreeAgencyReply(
      client,
      activity
    );

    if (handled) {
      return;
    }
  }

  // Continue with normal command handling
  await handleCommand(client, activity);
}
