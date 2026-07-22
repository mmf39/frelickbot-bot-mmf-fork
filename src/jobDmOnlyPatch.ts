import { RealClient } from "./core/RealClient";

const JOB_DM_CHANNEL_ID = String(
  process.env.JOB_DM_CHANNEL_ID ||
    process.env.TRANSACTION_DM_CHANNEL_ID ||
    "2205570"
).trim();

function makeSyntheticCommentId(): string {
  return `dm-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
