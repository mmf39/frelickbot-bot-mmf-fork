import "dotenv/config";

import { RealClient } from "./core/RealClient";
import { handleActivity } from "./handlers/ActivityHandler";

const POLL_INTERVAL_MS = 2_000;

function extractText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value.plainText === "string") return value.plainText;
  if (typeof value.text === "string") return value.text;

  return extractText(
    value.children ?? value.content ?? value.nodes ?? []
  );
}

function getConfiguredChannelIds(): Set<string> {
  const channelIds = new Set<string>();

  const transactionChannel = String(
    process.env.TRANSACTION_DM_CHANNEL_ID ?? "2205570"
  ).trim();

  if (transactionChannel) channelIds.add(transactionChannel);

  const configuredMap = process.env.REAL_DM_CHANNELS_JSON;

  if (configuredMap) {
    try {
      const parsed = JSON.parse(configuredMap) as Record<string, unknown>;

      for (const channelId of Object.values(parsed)) {
        const cleaned = String(channelId ?? "").trim();
        if (cleaned) channelIds.add(cleaned);
      }
    } catch (error) {
      console.error("REAL_DM_CHANNELS_JSON contains invalid JSON:", error);
    }
  }

  return channelIds;
}

function collectChannelIds(value: any, output: Set<string>): void {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) collectChannelIds(item, output);
    return;
  }

  if (typeof value !== "object") return;

  const candidate = String(
    value.channelId ??
      value.channel?.id ??
      value.id ??
      ""
  ).trim();

  if (/^\d+$/.test(candidate)) {
    output.add(candidate);
  }

  const nestedCandidates = [
    value.channels,
    value.messageChannels,
    value.results,
    value.data,
  ];

  for (const nested of nestedCandidates) {
    if (nested && nested !== value) collectChannelIds(nested, output);
  }
}

async function getAllChannelIds(client: RealClient): Promise<Set<string>> {
  const channelIds = getConfiguredChannelIds();

  try {
    const response = await client.getFromReal("/messages/channels");
    collectChannelIds(response, channelIds);
  } catch (error) {
    console.error(
      "Could not load the full DM channel list; using configured channels only:",
      error
    );
  }

  return channelIds;
}

function getMessages(value: any): any[] {
  const candidates = [
    value?.messages,
    value?.results,
    value?.data?.messages,
    value?.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function getMessageUserId(message: any): string {
  return String(
    message.userId ??
      message.createdByUserId ??
      message.authorUserId ??
      message.user?.id ??
      message.author?.id ??
      ""
  ).trim();
}

async function startDmCommandListener(): Promise<void> {
  const client = new RealClient();
  client.loadSession();

  const botUserId = String(client.getSession()?.userId ?? "").trim();
  const seenMessageIdsByChannel = new Map<string, Set<string>>();

  console.log("Starting direct-message command listener.");

  while (true) {
    try {
      const channelIds = await getAllChannelIds(client);

      for (const channelId of channelIds) {
        try {
          const response = await client.getChannelMessages(channelId);
          const messages = getMessages(response);
          let seenIds = seenMessageIdsByChannel.get(channelId);

          if (!seenIds) {
            seenIds = new Set(
              messages.map((message) => String(message.id ?? "")).filter(Boolean)
            );
            seenMessageIdsByChannel.set(channelId, seenIds);
            continue;
          }

          for (const message of [...messages].reverse()) {
            const messageId = String(message.id ?? "").trim();

            if (!messageId || seenIds.has(messageId)) continue;
            seenIds.add(messageId);

            const userId = getMessageUserId(message);
            if (userId && userId === botUserId) continue;

            const text = extractText(
              message.content ?? message.plainText ?? message.text
            ).trim();

            if (!/\$[a-z0-9_-]+/i.test(text)) continue;

            console.log(`New DM command from ${userId || "unknown"}: ${text}`);

            await handleActivity(client, {
              id: messageId,
              type: "message",
              channelId,
              userId,
              authorUserId: userId,
              message: {
                ...message,
                id: messageId,
                channelId,
                userId,
                plainText: text,
              },
              additionalInfo: {
                message: {
                  ...message,
                  id: messageId,
                  channelId,
                  userId,
                  plainText: text,
                },
              },
            });
          }
        } catch (channelError) {
          console.error(
            `DM command polling failed for channel ${channelId}:`,
            channelError
          );
        }
      }
    } catch (error) {
      console.error("DM command listener error:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

void startDmCommandListener();
