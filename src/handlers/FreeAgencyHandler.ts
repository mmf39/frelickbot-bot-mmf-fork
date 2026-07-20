function getReplyAuthorUsername(activity: any): string {
  const rawUsername =
    activity.additionalInfo?.comment?.createdBy?.username ??
    activity.additionalInfo?.comment?.createdByUser?.username ??
    activity.additionalInfo?.comment?.author?.username ??
    activity.additionalInfo?.comment?.user?.username ??
    activity.additionalInfo?.comment?.username ??
    activity.additionalInfo?.user?.username ??
    activity.additionalInfo?.createdBy?.username ??
    activity.additionalInfo?.author?.username ??
    activity.comment?.createdBy?.username ??
    activity.comment?.createdByUser?.username ??
    activity.comment?.author?.username ??
    activity.comment?.user?.username ??
    activity.comment?.username ??
    activity.createdBy?.username ??
    activity.createdByUser?.username ??
    activity.author?.username ??
    activity.actor?.username ??
    activity.user?.username ??
    activity.username ??
    activity.authorUsername ??
    "";

  const username = String(rawUsername)
    .trim()
    .replace(/^@+/, "");

  return username ? `@${username}` : "";
}

function getReplyAuthorUsername(activity: any): string {
  const username = String(
    activity.additionalInfo?.comment?.username ??
    activity.additionalInfo?.comment?.authorUsername ??
    activity.additionalInfo?.comment?.commenterUsername ??
    activity.additionalInfo?.comment?.author?.username ??
    activity.additionalInfo?.comment?.user?.username ??
    activity.comment?.username ??
    activity.comment?.authorUsername ??
    activity.comment?.commenterUsername ??
    activity.comment?.author?.username ??
    activity.comment?.user?.username ??
    activity.username ??
    activity.authorUsername ??
    activity.createdBy?.username ??
    activity.author?.username ??
    activity.actor?.username ??
    ""
  ).trim();

  if (!username) {
    return "";
  }

  return username.startsWith("@")
    ? username
    : `@${username}`;
}

function getReplyText(activity: any): string {
  return String(
    activity.additionalInfo?.comment?.content ??
    activity.additionalInfo?.comment?.text ??
    activity.additionalInfo?.comment?.body ??
    activity.comment?.content ??
    activity.comment?.text ??
    activity.comment?.body ??
    activity.content ??
    activity.text ??
    activity.body ??
    ""
  ).trim();
}

function getReplyId(activity: any): string {
  return String(
    activity.additionalInfo?.comment?.id ??
    activity.additionalInfo?.comment?.commentId ??
    activity.comment?.id ??
    activity.comment?.commentId ??
    activity.commentId ??
    activity.id ??
    activity.activityId ??
    ""
  ).trim();
}

function getParentCommentId(activity: any): string {
  return String(
    activity.parentCommentId ??
    activity.additionalInfo?.comment?.parentCommentId ??
    activity.additionalInfo?.comment?.parentId ??
    activity.comment?.parentCommentId ??
    activity.comment?.parentId ??
    activity.additionalInfo?.parentCommentId ??
    ""
  ).trim();
}

export async function handleFreeAgencyReply(
  client: any,
  activity: any
): Promise<boolean> {
  if (activity.type !== "reply") {
    return false;
  }

  const freeAgencyCommentId = String(
    process.env.FREE_AGENCY_COMMENT_ID ?? ""
  ).trim();

  if (!freeAgencyCommentId) {
    console.warn(
      "FREE_AGENCY_COMMENT_ID is not set."
    );

    return false;
  }

  const parentCommentId =
    getParentCommentId(activity);

  if (parentCommentId !== freeAgencyCommentId) {
    return false;
  }

  const apiUrl = String(
    process.env.FREE_AGENCY_API_URL ?? ""
  ).trim();

  if (!apiUrl) {
    console.error(
      "FREE_AGENCY_API_URL is not set."
    );

    return true;
  }

  const userId =
    getReplyAuthorUserId(activity);

  const username =
    getReplyAuthorUsername(activity);

  const replyText =
    getReplyText(activity);

  const replyId =
    getReplyId(activity);

  if (!userId) {
    console.error(
      "Could not find the replying user's Real user ID:",
      JSON.stringify(activity)
    );

    return true;
  }
console.log(
  "FREE AGENCY REPLY ACTIVITY:",
  JSON.stringify(activity, null, 2)
);

console.log("Detected username:", username);
console.log("Detected userId:", userId);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "addFreeAgent",
      username,
      userId,
      replyText,
      replyId,
      parentCommentId,
    }),
  });

  const responseText =
    await response.text();

  if (!response.ok) {
    console.error(
      `Free Agency sheet request failed (${response.status}):`,
      responseText
    );

    return true;
  }

  console.log(
    `Free agent processed: ${username || userId}`,
    responseText
  );

  return true;
}
