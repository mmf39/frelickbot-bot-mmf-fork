import fs from "fs";
import path from "path";
import { http } from "./http";
import { Session } from "./Session";
import { RequestToken } from "./RequestToken";
import { launch } from 'cloakbrowser';

const browser = await launch();
const page = await browser.newPage();
await page.goto('https://example.com');
await browser.close();

type RealRequestHeaders = {
  "real-auth-info": string;
  "real-device-uuid": string;
  "real-request-token": string;
  origin: string;
  referer: string;
  "real-turnstile-token"?: string;
};

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

  private requireSession(): Session {
    if (!this.session) {
      throw new Error(
        "No session has been loaded"
      );
    }

    return this.session;
  }

  private createHeaders(
    includeTurnstile = false
  ): RealRequestHeaders {
    const session = this.requireSession();

    const headers: RealRequestHeaders = {
      "real-auth-info":
        session.authInfo,
      "real-device-uuid":
        session.deviceUuid,
      "real-request-token":
        RequestToken.generate(),
      origin:
        "https://www.realapp.com",
      referer:
        "https://www.realapp.com/",
    };

    if (includeTurnstile) {
      const turnstileToken =
        process.env.REAL_TURNSTILE_TOKEN;

      if (!turnstileToken) {
        throw new Error(
          "REAL_TURNSTILE_TOKEN is missing"
        );
      }

      headers["real-turnstile-token"] =
        turnstileToken;
    }

    return headers;
  }

  async getFromReal(
    requestPath: string,
    params?: Record<
      string,
      string | number | boolean | undefined
    >
  ): Promise<any> {
    const cleanedPath =
      String(requestPath || "").trim();

    if (!cleanedPath) {
      throw new Error(
        "A Real API path is required."
      );
    }

    const response = await http.get(
      cleanedPath.startsWith("/")
        ? cleanedPath
        : `/${cleanedPath}`,
      {
        headers: this.createHeaders(),
        params,
      }
    );

    return response.data;
  }

  async postToReal(
    requestPath: string,
    body: unknown,
    includeTurnstile = false
  ): Promise<any> {
    const cleanedPath =
      String(requestPath || "").trim();

    if (!cleanedPath) {
      throw new Error(
        "A Real API path is required."
      );
    }

    const response = await http.post(
      cleanedPath.startsWith("/")
        ? cleanedPath
        : `/${cleanedPath}`,
      body,
      {
        headers: this.createHeaders(
          includeTurnstile
        ),
      }
    );

    return response.data;
  }

  async getUserByUsername(
    username: string
  ): Promise<any> {
    const cleanedUsername =
      String(username || "")
        .trim()
        .replace(/^@/, "");

    if (!cleanedUsername) {
      throw new Error(
        "Username is required."
      );
    }

    return this.getFromReal(
      `/user/${encodeURIComponent(
        cleanedUsername
      )}`
    );
  }

  async getPlayerSport(
    playerId: string | number,
    sport: string,
    season: string | number
  ): Promise<any> {
    const cleanedPlayerId =
      String(playerId || "").trim();

    const cleanedSport =
      String(sport || "")
        .trim()
        .toLowerCase();

    if (
      !cleanedPlayerId ||
      !cleanedSport
    ) {
      throw new Error(
        "Player ID and sport are required."
      );
    }

    return this.getFromReal(
      `/players/${encodeURIComponent(
        cleanedPlayerId
      )}/sport/${encodeURIComponent(
        cleanedSport
      )}`,
      {
        season,
      }
    );
  }

  async getPlayerSeasonFeed(
    playerId: string | number,
    sport: string,
    season: string | number,
    limit = 10
  ): Promise<any> {
    const cleanedPlayerId =
      String(playerId || "").trim();

    const cleanedSport =
      String(sport || "")
        .trim()
        .toLowerCase();

    if (
      !cleanedPlayerId ||
      !cleanedSport
    ) {
      throw new Error(
        "Player ID and sport are required."
      );
    }

    return this.getFromReal(
      `/players/${encodeURIComponent(
        cleanedPlayerId
      )}/sport/${encodeURIComponent(
        cleanedSport
      )}/seasonfeed`,
      {
        limit,
        season,
        view: "recent",
        viewFrame: "default",
      }
    );
  }

  async getPlayerBoxScore(
    boxScoreId: string | number
  ): Promise<any> {
    const cleanedBoxScoreId =
      String(boxScoreId || "").trim();

    if (!cleanedBoxScoreId) {
      throw new Error(
        "Box score ID is required."
      );
    }

    return this.getFromReal(
      `/playerboxscores/${encodeURIComponent(
        cleanedBoxScoreId
      )}`,
      {
        version: 2,
      }
    );
  }

  async getUserPassEarnings(
    sport: string,
    season: string | number,
    playerId: string | number,
    playerBoxScoreId: string | number
  ): Promise<any> {
    const cleanedSport =
      String(sport || "")
        .trim()
        .toLowerCase();

    const cleanedPlayerId =
      String(playerId || "").trim();

    const cleanedBoxScoreId =
      String(playerBoxScoreId || "").trim();

    if (
      !cleanedSport ||
      !cleanedPlayerId ||
      !cleanedBoxScoreId
    ) {
      throw new Error(
        "Sport, player ID, and box score ID are required."
      );
    }

    return this.getFromReal(
      `/userpassearnings/${encodeURIComponent(
        cleanedSport
      )}/season/${encodeURIComponent(
        String(season)
      )}/entity/player/${encodeURIComponent(
        cleanedPlayerId
      )}`,
      {
        playerBoxScoreId:
          cleanedBoxScoreId,
      }
    );
  }

  async getUserPasses(
    userId: string,
    sport: string,
    season: string | number
  ): Promise<any> {
    const cleanedUserId =
      String(userId || "").trim();

    const cleanedSport =
      String(sport || "")
        .trim()
        .toLowerCase();

    if (
      !cleanedUserId ||
      !cleanedSport
    ) {
      throw new Error(
        "User ID and sport are required."
      );
    }

    return this.getFromReal(
      `/userpasses/${encodeURIComponent(
        cleanedUserId
      )}/passes`,
      {
        entityType: "player",
        season,
        sport: cleanedSport,
      }
    );
  }

  async postToGroup(
    text: string,
    groupId?: string | number,
    parentCommentId: string | null = null
  ): Promise<any> {
    const resolvedGroupId = Number(
      groupId ??
      process.env.REAL_GROUP_ID
    );

    if (
      !Number.isInteger(resolvedGroupId) ||
      resolvedGroupId <= 0
    ) {
      throw new Error(
        "Group ID is missing or invalid"
      );
    }

    const message =
      String(text || "").trim();

    if (!message) {
      throw new Error(
        "Cannot post an empty group message."
      );
    }

    const requestPath =
      `/comments/groups/${resolvedGroupId}`;

    const body = {
      groupId: resolvedGroupId,
      text: message,
      parentCommentId,
    };

    try {
      return await this.postToReal(
        requestPath,
        body,
        false
      );
    } catch (error: any) {
      const status =
        error?.response?.status ??
        error?.status;

      const hasTurnstileToken = Boolean(
        process.env.REAL_TURNSTILE_TOKEN
      );

      if (
        (status === 401 || status === 403) &&
        hasTurnstileToken
      ) {
        console.log(
          "Group post without Turnstile was rejected; retrying once with the configured token."
        );

        return this.postToReal(
          requestPath,
          body,
          true
        );
      }

      throw error;
    }
  }

  async replyToComment(
    parentCommentId: string,
    text: string,
    groupId?: string | number
  ): Promise<any> {
    return this.postToGroup(
      text,
      groupId,
      parentCommentId
    );
  }

  async sendChannelMessage(
    text: string,
    channelId?: string | number
  ): Promise<any> {
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

    const message =
      String(text || "").trim();

    if (!message) {
      throw new Error(
        "Cannot send an empty channel message."
      );
    }

    return this.postToReal(
      `/messages/channels/${encodeURIComponent(
        resolvedChannelId
      )}/messages`,
      {
        text: message,
        parentMessageId: null,
      }
    );
  }

  async getChannelMessages(
    channelId?: string | number
  ): Promise<any> {
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

    return this.getFromReal(
      `/messages/channels/${encodeURIComponent(
        resolvedChannelId
      )}/messages`
    );
  }

  async getActivity(): Promise<any> {
    return this.getFromReal(
      "/activity"
    );
  }

  async getKarmaFeed(
  userId: string
): Promise<{
  val: number;
  rank: number;
}> {
  const cleanedUserId =
    String(userId || "").trim();

  if (!cleanedUserId) {
    return {
      val: 0,
      rank: 0,
    };
  }

  try {
    const response = await http.get(
      `https://web.realsports.io/user/${encodeURIComponent(
        cleanedUserId
      )}/karmafeed`,
      {
        headers: {
          ...this.createHeaders(),
          origin:
            "https://realsports.io",
          referer:
            "https://realsports.io/",
          "real-version": "27",
        },
      }
    );

    const stats =
      response.data?.stats ?? {};

    return {
      val: Number(
        stats.karmaDelta || 0
      ),
      rank: Number(
        stats.karmaDayRank || 0
      ),
    };
  } catch (error: any) {
    console.error(
      `Karma fetch failed for ${cleanedUserId}:`,
      error?.response?.status ??
        error?.message ??
        error
    );

    return {
      val: 0,
      rank: 0,
    };
  }
}
}
