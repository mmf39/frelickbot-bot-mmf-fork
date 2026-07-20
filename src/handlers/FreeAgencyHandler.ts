function getReplyAuthorUserId(activity: any): string {
  return String(
    activity.additionalInfo?.comment?.authorUserId ??
    activity.additionalInfo?.comment?.commenterUserId ??
    activity.additionalInfo?.comment?.createdByUserId ??
    activity.additionalInfo?.comment?.userId ??
    activity.additionalInfo?.comment?.author?.id ??
    activity.additionalInfo?.comment?.user?.id ??
    activity.comment?.authorUserId ??
    activity.comment?.commenterUserId ??
    activity.comment?.createdByUserId ??
    activity.comment?.userId ??
    activity.comment?.author?.id ??
    activity.comment?.user?.id ??
    activity.authorUserId ??
    activity.commenterUserId ??
    activity.createdByUserId ??
    activity.createdBy?.id ??
    activity.createdByUser?.id ??
    activity.author?.id ??
    activity.actor?.id ??
    activity.user?.id ??
    ""
  ).trim();
}

function getReplyAuthorUsername(activity: any): string {
  const rawUsername =
    activity.additionalInfo?.comment?.createdBy?.username ??
    activity.additionalInfo?.comment?.createdByUser?.username ??
    activity.additionalInfo?.comment?.author?.username ??
    activity.additionalInfo?.comment?.user?.username ??
    activity.additionalInfo?.comment?.username ??
    activity.additionalInfo?.comment?.authorUsername ??
    activity.additionalInfo?.comment?.commenterUsername ??
    activity.additionalInfo?.user?.username ??
    activity.additionalInfo?.createdBy?.username ??
    activity.additionalInfo?.createdByUser?.username ??
    activity.additionalInfo?.author?.username ??
    activity.additionalInfo?.actor?.username ??
    activity.comment?.createdBy?.username ??
    activity.comment?.createdByUser?.username ??
    activity.comment?.author?.username ??
    activity.comment?.user?.username ??
    activity.comment?.username ??
    activity.comment?.authorUsername ??
    activity.comment?.commenterUsername ??
    activity.createdBy?.username ??
    activity.createdByUser?.username ??
    activity.author?.username ??
    activity.actor?.username ??
    activity.user?.username ??
    activity.username ??
    activity.authorUsername ??
    activity.commenterUsername ??
    "";

  const username = String(rawUsername)
    .trim()
    .replace(/^@+/, "");

  return username ? `@${username}` : "";
}

function getReplyText(activity: any): string {
  return String(
    activity.additionalInfo?.comment?.plainText ??
    activity.additionalInfo?.comment?.content ??
    activity.additionalInfo?.comment?.text ??
    activity.additionalInfo?.comment?.body ??
    activity.comment?.plainText ??
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
    console.warn("FREE_AGENCY_COMMENT_ID is not set.");
    return false;
  }

  const parentCommentId = getParentCommentId(activity);

  if (parentCommentId !== freeAgencyCommentId) {
    return false;
  }

  const apiUrl = String(
    process.env.FREE_AGENCY_API_URL ?? ""
  ).trim();

  if (!apiUrl) {
    console.error("FREE_AGENCY_API_URL is not set.");
    return true;
  }

  const userId = getReplyAuthorUserId(activity);
  const username = getReplyAuthorUsername(activity);
  const replyText = getReplyText(activity);
  const replyId = getReplyId(activity);

  console.log(
    "FREE AGENCY REPLY ACTIVITY:",
    JSON.stringify(activity, null, 2)
  );

  console.log("Detected username:", username);
  console.log("Detected userId:", userId);
  console.log("Detected reply text:", replyText);
  console.log("Detected reply ID:", replyId);
  console.log("Detected parent comment ID:", parentCommentId);

  if (!userId) {
    console.error(
      "Could not find the replying user's Real user ID."
    );

    return true;
  }

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

  const responseText = await response.text();

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
