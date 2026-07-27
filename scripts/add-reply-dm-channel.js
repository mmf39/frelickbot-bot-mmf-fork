const fs = require("fs");
const path = require("path");

const realClientPath = path.join(process.cwd(), "src", "core", "RealClient.ts");
const commandHandlerPath = path.join(process.cwd(), "src", "CommandHandler.ts");

let realClient = fs.readFileSync(realClientPath, "utf8");
let commandHandler = fs.readFileSync(commandHandlerPath, "utf8");

if (!realClient.includes("private readonly dmChannelByUserId")) {
  realClient = realClient.replace(
    "  private session: Session | null = null;",
    `  private session: Session | null = null;\n  private readonly dmChannelByUserId = new Map<string, string>();`
  );
}

if (!realClient.includes("async getOrCreateDmChannel(")) {
  const marker = "  async getUserByUsername(\n";
  const method = `  async getOrCreateDmChannel(\n    userId: string\n  ): Promise<string> {\n    const cleanedUserId = String(userId || \"\").trim();\n\n    if (!/^[A-Za-z0-9]{8}$/.test(cleanedUserId)) {\n      throw new Error(\"A valid Real user ID is required to open a DM.\");\n    }\n\n    const cachedChannelId = this.dmChannelByUserId.get(cleanedUserId);\n\n    if (cachedChannelId) {\n      return cachedChannelId;\n    }\n\n    const requestBody = {\n      users: [{ id: cleanedUserId }],\n    };\n\n    let result: any;\n\n    try {\n      result = await this.postToReal(\n        \"/messages/channels\",\n        requestBody,\n        false\n      );\n    } catch (error: any) {\n      const status = error?.response?.status ?? error?.status;\n      const hasTurnstileToken = Boolean(\n        process.env.REAL_TURNSTILE_TOKEN\n      );\n\n      if (\n        (status === 401 || status === 403) &&\n        hasTurnstileToken\n      ) {\n        console.log(\n          \`DM channel lookup for \${cleanedUserId} was rejected; retrying once with Turnstile.\`\n        );\n\n        result = await this.postToReal(\n          \"/messages/channels\",\n          requestBody,\n          true\n        );\n      } else {\n        throw error;\n      }\n    }\n\n    const channelId = String(\n      result?.channelId ?? result?.channel?.id ?? \"\"\n    ).trim();\n\n    if (!/^\\d+$/.test(channelId)) {\n      throw new Error(\n        \`Real did not return a valid DM channel ID for \${cleanedUserId}.\`\n      );\n    }\n\n    this.dmChannelByUserId.set(cleanedUserId, channelId);\n\n    console.log(\n      \`Resolved DM channel \${channelId} for Real user \${cleanedUserId}.\`\n    );\n\n    return channelId;\n  }\n\n`;

  if (!realClient.includes(marker)) {
    throw new Error("Could not find the RealClient insertion point.");
  }

  realClient = realClient.replace(marker, method + marker);
}

if (!commandHandler.includes("let submitterDmChannelId: string | null = null;")) {
  const marker = "      try {\n        const result = await callTransactionApi({";
  const replacement = `      try {\n        let submitterDmChannelId: string | null = null;\n\n        try {\n          submitterDmChannelId = await client.getOrCreateDmChannel(\n            submittingUserId\n          );\n        } catch (dmChannelError) {\n          console.error(\n            \"Could not resolve the transaction submitter's DM channel:\",\n            dmChannelError\n          );\n        }\n\n        const result = await callTransactionApi({`;

  if (!commandHandler.includes(marker)) {
    throw new Error("Could not find the transaction submission insertion point.");
  }

  commandHandler = commandHandler.replace(marker, replacement);
}

if (!commandHandler.includes("submitterDmChannelId,")) {
  const marker = "  submittedByUserId: submittingUserId,\n  team: submittingTeam,";
  const replacement = "  submittedByUserId: submittingUserId,\n  submitterDmChannelId,\n  team: submittingTeam,";

  if (!commandHandler.includes(marker)) {
    throw new Error("Could not add the submitter DM channel to the transaction payload.");
  }

  commandHandler = commandHandler.replace(marker, replacement);
}

if (!commandHandler.includes("Submitter DM Channel:")) {
  const marker = "          `Submitted By User ID: ${submittingUserId}`,\n          \"\",";
  const replacement = "          `Submitted By User ID: ${submittingUserId}`,\n          `Submitter DM Channel: ${submitterDmChannelId ?? \"Unavailable\"}`,\n          \"\",";

  if (!commandHandler.includes(marker)) {
    throw new Error("Could not add the submitter DM channel to the notification.");
  }

  commandHandler = commandHandler.replace(marker, replacement);
}

fs.writeFileSync(realClientPath, realClient);
fs.writeFileSync(commandHandlerPath, commandHandler);

console.log("Added automatic Real DM channel resolution for transaction replies.");
