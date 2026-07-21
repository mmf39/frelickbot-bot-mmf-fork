import { RealClient } from "./core/RealClient";

RealClient.prototype.postToGroup = async function (
  text: string,
  groupId?: string | number,
  parentCommentId: string | null = null
): Promise<any> {
  const resolvedGroupId = Number(
    groupId ?? process.env.REAL_GROUP_ID
  );

  if (!Number.isInteger(resolvedGroupId) || resolvedGroupId <= 0) {
    throw new Error("Group ID is missing or invalid");
  }

  const message = String(text || "").trim();

  if (!message) {
    throw new Error("Cannot post an empty group message.");
  }

  return this.postToReal(
    `/comments/groups/${resolvedGroupId}`,
    {
      groupId: resolvedGroupId,
      text: message,
      parentCommentId,
    },
    false
  );
};

console.log("Group-post patch loaded: static Turnstile header disabled.");
