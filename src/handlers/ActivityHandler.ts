import { handleCommand } from "../CommandHandler";

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

  await handleCommand(client, activity);
}
