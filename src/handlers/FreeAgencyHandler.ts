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
    return false;
  }

  const parentCommentId = String(
    activity.parentCommentId ??
    activity.additionalInfo?.comment?.parentCommentId ??
    activity.comment?.parentCommentId ??
    activity.additionalInfo?.parentCommentId ??
    ""
  ).trim();

  if (parentCommentId !== freeAgencyCommentId) {
    return false;
  }

  // Only replies to the exact FA comment reach this point.
  // Get the username and user ID, then add them to the sheet.

  return true;
}
