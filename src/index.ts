import "dotenv/config";
import { RealClient } from "./core/RealClient";
import handleActivity from "./CommandHandler";
import { startDailyLineupAnnouncement } from "./jobs/lineupAnnouncement";

async function main() {
  const client = new RealClient();

  client.loadSession();
  startDailyLineupAnnouncement(client);

  console.log("==========================");
  console.log("FrelickBot Started");
  console.log("==========================");

  const seen = new Set<string>();

  // Ignore existing activities when the bot starts
  try {
    const initial = await client.getActivity();

    for (const activity of initial.activities ?? []) {
      seen.add(activity.id);
    }

    console.log(`Loaded ${seen.size} existing activities.`);
  } catch (err) {
    console.error("Failed to load initial activity:", err);
  }

  while (true) {
    try {
      console.log("Checking activity...");

      const data = await client.getActivity();

      console.log(`Activities: ${data.activities?.length ?? 0}`);

      for (const activity of data.activities ?? []) {
        if (seen.has(activity.id)) continue;

        seen.add(activity.id);

        await handleActivity(client, activity);
      }
    } catch (err) {
      console.error(err);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch(console.error);
