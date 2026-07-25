import { RealClient } from "./core/RealClient";

const JOB_DM_CHANNEL_ID = String(
  process.env.JOB_DM_CHANNEL_ID ||
    process.env.TRANSACTION_DM_CHANNEL_ID ||
    "2205570"
).trim();

const originalFetch = globalThis.fetch.bind(globalThis);
const pendingLineupDmDates: string[] = [];
const sentLineupDmDates = new Set<string>();

function makeSyntheticCommentId(): string {
  return `dm-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRequestActionAndDate(init?: RequestInit): {
  action: string;
  date: string;
} {
  if (typeof init?.body !== "string") {
    return { action: "", date: "" };
  }

  try {
    const body = JSON.parse(init.body);
    return {
      action: String(body?.action || "").trim(),
      date: String(body?.date || "").trim(),
    };
  } catch {
    return { action: "", date: "" };
  }
}

function markLockResponseAsSent(data: any, date: string): any {
  const candidates = [
    data?.lock,
    data?.lineupLock,
    data?.result,
    data?.data,
    data,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }

    if (
      candidate.hour !== undefined ||
      candidate.minute !== undefined ||
      candidate.display !== undefined
    ) {
      candidate.lineupDmSent = true;
      candidate.lineupDmSentAt = new Date().toISOString();
      candidate.date = candidate.date || date;
      break;
    }
  }

  return data;
}

globalThis.fetch = async function patchedFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const { action, date } = getRequestActionAndDate(init);
  const response = await originalFetch(input, init);

  if (action === "markLineupDmSent") {
    const text = await response.clone().text();
    let parsed: any = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      return response;
    }

    const message = String(parsed?.message || "").toLowerCase();
    const unsupported =
      parsed?.ok === false &&
      message.includes("unknown action") &&
      message.includes("marklineupdmsent");

    if (!unsupported) {
      return response;
    }

    if (date && !pendingLineupDmDates.includes(date)) {
      pendingLineupDmDates.push(date);
    }

    console.warn(
      `Lineup API does not support markLineupDmSent. Allowing the DM for ${date || "today"} and tracking it in memory.`
    );

    return new Response(JSON.stringify({ ok: true, fallback: "memory" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (action === "getLineupLockTime" && date && sentLineupDmDates.has(date)) {
    const text = await response.clone().text();

    try {
      const parsed = markLockResponseAsSent(JSON.parse(text), date);
      return new Response(JSON.stringify(parsed), {
        status: response.status,
        statusText: response.statusText,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return response;
    }
  }

  return response;
};

async function sendJobDm(
  client: RealClient,
  text: string
): Promise<any> {
  const message = String(text || "").trim();

  if (!message) {
    throw new Error("Cannot send an empty automated-job DM.");
  }

  console.log(
    `Automated job is DM-only. Sending response in channel ${JOB_DM_CHANNEL_ID}.`
  );

  const result = await client.sendChannelMessage(
    message,
    JOB_DM_CHANNEL_ID
  );

  const pendingDate = pendingLineupDmDates.shift();
  if (pendingDate) {
    sentLineupDmDates.add(pendingDate);
    console.log(
      `Lineup DM for ${pendingDate} was tracked as sent in memory because the API mark action is unavailable.`
    );
  }

  console.log(
    `Automated job DM sent successfully in channel ${JOB_DM_CHANNEL_ID}.`
  );

  return {
    ok: true,
    id: makeSyntheticCommentId(),
    commentId: makeSyntheticCommentId(),
    dmChannelId: JOB_DM_CHANNEL_ID,
    result,
  };
}

RealClient.prototype.postToGroup = async function (
  text: string,
  _groupId?: string | number,
  _parentCommentId: string | null = null
): Promise<any> {
  return sendJobDm(this, text);
};

RealClient.prototype.replyToComment = async function (
  _parentCommentId: string,
  text: string,
  _groupId?: string | number
): Promise<any> {
  return sendJobDm(this, text);
};

console.log(
  `Automated jobs are configured for DM-only delivery in channel ${JOB_DM_CHANNEL_ID}.`
);