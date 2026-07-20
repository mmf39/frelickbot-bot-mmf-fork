import fs from "fs";
import path from "path";
import { http } from "./http";
import { Session } from "./Session";
import { RequestToken } from "./RequestToken";

export class RealClient {
  private session: Session | null = null;

  constructor() {
    console.log("✓ RealClient initialized");
  }

  loadSession(): void {
    const railwaySession =
      process.env.REAL_SESSION_JSON;

    if (railwaySession) {
      try {
        this.session = JSON.parse(
          railwaySession
        );

        console.log(
          "✓ Session loaded from Railway variable"
        );

        return;
      } catch {
        throw new Error(
          "REAL_SESSION_JSON contains invalid JSON"
        );
      }
    }

    const sessionPath = path.join(
      process.cwd(),
      "session.json"
    );

    if (fs.existsSync(sessionPath)) {
      const file = fs.readFileSync(
        sessionPath,
        "utf8"
      );

      this.session = JSON.parse(file);

      console.log(
        "✓ Session loaded from local file"
      );

      return;
    }

    throw new Error(
      "No session found. Add REAL_SESSION_JSON in Railway or keep session.json locally."
    );
  }

  getSession(): Session | null {
    return this.session;
  }

  async postToGroup(
    text: string,
    parentCommentId: string | null = null
  ): Promise<any> {
    if (!this.session) {
      throw new Error(
        "No session has been loaded"
      );
    }

    const groupId = Number(
      process.env.REAL_GROUP_ID
    );

    const turnstileToken =
      process.env.REAL_TURNSTILE_TOKEN;

    if (
      !Number.isInteger(groupId) ||
      groupId <= 0
    ) {
      throw new Error(
        "REAL_GROUP_ID is missing or invalid"
      );
    }

    if (!turnstileToken) {
      throw new Error(
        "REAL_TURNSTILE_TOKEN is missing"
      );
    }

    const response = await http.post(
      `/comments/groups/${groupId}`,
      {
        groupId,
        text,
        parentCommentId,
      },
      {
        headers: {
          "real-auth-info":
            this.session.authInfo,
          "real-device-uuid":
            this.session.deviceUuid,
          "real-request-token":
            RequestToken.generate(),
          "real-turnstile-token":
            turnstileToken,
          origin:
            "https://www.realapp.com",
          referer:
            "https://www.realapp.com/",
        },
      }
    );

    return response.data;
  }

  async replyToComment(
    parentCommentId: string,
    text: string
  ): Promise<any> {
    return this.postToGroup(
      text,
      parentCommentId
    );
  }

  async sendChannelMessage(
    text: string,
    channelId?: string | number
  ): Promise<any> {
    if (!this.session) {
      throw new Error(
        "No session has been loaded"
      );
    }

    const resolvedChannelId = String(
      channelId ??
      process.env.TRANSACTION_DM_CHANNEL_ID ??
      ""
    ).trim();

    if (!resolvedChannelId) {
      throw new Error(
        "TRANSACTION_DM_CHANNEL_ID is missing."
      );
    }

    const message = String(
      text || ""
    ).trim();

    if (!message) {
      throw new Error(
        "Cannot send an empty channel message."
      );
    }

    const response = await http.post(
  `/messages/channels/${resolvedChannelId}/messages`,
  {
    message: {
      content: {
        nodes: [
          {
            type: "Paragraph",
            children: [
              {
                text: message,
                type: "Text",
              },
            ],
          },
        ],
      },
    },
  },
  {
    headers: {
      "real-auth-info":
        this.session.authInfo,
      "real-device-uuid":
        this.session.deviceUuid,
      "real-request-token":
        RequestToken.generate(),
      origin:
        "https://www.realapp.com",
      referer:
        "https://www.realapp.com/",
    },
  }
);

    return response.data;
  }

  async getActivity(): Promise<any> {
    if (!this.session) {
      throw new Error(
        "No session has been loaded"
      );
    }

    const response = await http.get(
      "/activity",
      {
        headers: {
          "real-auth-info":
            this.session.authInfo,
          "real-device-uuid":
            this.session.deviceUuid,
          "real-request-token":
            RequestToken.generate(),
        },
      }
    );

    return response.data;
  }
}
