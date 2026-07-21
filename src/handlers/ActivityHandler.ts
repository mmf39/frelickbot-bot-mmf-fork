import { handleCommand } from "../CommandHandler";
import { handleFreeAgencyReply } from "./FreeAgencyHandler";

type CommandError = Error & {
  status?: number;
  method?: string;
  url?: string;
};

function logCommandError(error: unknown): void {
  const commandError = error as CommandError;

  if (commandError?.status === 403) {
    console.error(
      `Command reply blocked by Real: 403 Forbidden ${commandError.method ?? "POST"} ${commandError.url ?? ""}`.trim()
    );
    return;
  }

  console.error(
    "Command handling failed:",
    commandError?.message ?? String(error)
  );
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
  );

  if (
    activityUserId &&
    activityUserId === session?.userId
  ) {
    return;
  }

  try {
    if (activity.type === "reply") {
      const handled = await handleFreeAgencyReply(
        client,
        activity
      );

      if (handled) {
        return;
      }
    }

    await handleCommand(client, activity);
  } catch (error) {
    logCommandError(error);
  }
}
