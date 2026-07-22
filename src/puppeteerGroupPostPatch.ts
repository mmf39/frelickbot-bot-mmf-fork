import { ElementHandle, Page } from "puppeteer";
import { RealClient } from "./core/RealClient";
import { openRealBrowser } from "./realBrowser";

const DEFAULT_GROUP_URL_TEMPLATE =
  "https://www.realsports.io/groups/{groupId}";

let postQueue: Promise<unknown> = Promise.resolve();

function getGroupUrl(groupId: number): string {
  const configured = String(
    process.env.REAL_GROUP_URL_TEMPLATE || DEFAULT_GROUP_URL_TEMPLATE
  ).trim();

  const template =
    !configured || /real\.vg|web\.realapp\.com/i.test(configured)
      ? DEFAULT_GROUP_URL_TEMPLATE
      : configured;

  return template.replace("{groupId}", String(groupId));
}

async function findComposer(page: Page): Promise<ElementHandle<Element>> {
  const customSelector = String(
    process.env.REAL_COMMENT_INPUT_SELECTOR || ""
  ).trim();

  const selectors = [
    customSelector,
    'textarea[placeholder*="comment" i]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="reply" i]',
    "textarea",
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ].filter(Boolean);

  for (const frame of page.frames()) {
    for (const selector of selectors) {
      try {
        const element = await frame.$(selector);
        if (element) return element;
      } catch {
        // Ignore frames that changed while searching.
      }
    }
  }

  throw new Error(
    "Could not find the Real comment box. Set REAL_COMMENT_INPUT_SELECTOR in Railway if the site changed."
  );
}

async function clickReplyForParent(
  page: Page,
  parentCommentId: string
): Promise<void> {
  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate((commentId) => {
        const target = Array.from(document.querySelectorAll("*")).find(
          (node) =>
            node
              .getAttributeNames()
              .some((name) =>
                String(node.getAttribute(name) || "").includes(commentId)
              )
        );

        if (!target) return false;

        const container =
          target.closest("article") ||
          target.closest('[role="article"]') ||
          target.parentElement;

        if (!container) return false;

        const buttons = Array.from(
          container.querySelectorAll('button, [role="button"]')
        ) as HTMLElement[];

        const replyButton = buttons.find((element) =>
          /reply/i.test(
            String(
              element.innerText ||
                element.getAttribute("aria-label") ||
                element.getAttribute("title") ||
                ""
            )
          )
        );

        if (!replyButton) return false;
        replyButton.click();
        return true;
      }, parentCommentId);

      if (result) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        return;
      }
    } catch {
      // Keep looking in other frames.
    }
  }

  throw new Error(
    `Could not open the reply box for parent comment ${parentCommentId}.`
  );
}

async function enterText(page: Page, message: string): Promise<void> {
  const composer = await findComposer(page);
  await composer.click();

  await page.evaluate(
    (element, text) => {
      const target = element as HTMLElement;

      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement
      ) {
        const prototype =
          target instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;

        const setter = Object.getOwnPropertyDescriptor(
          prototype,
          "value"
        )?.set;

        setter?.call(target, text);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        target.focus();
        target.textContent = text;
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
          })
        );
      }
    },
    composer,
    message
  );
}

async function clickSubmit(page: Page): Promise<string> {
  const customSelector = String(
    process.env.REAL_COMMENT_SUBMIT_SELECTOR || ""
  ).trim();

  if (customSelector) {
    for (const frame of page.frames()) {
      const button = await frame.$(customSelector).catch(() => null);
      if (button) {
        await button.click();
        return "custom-selector";
      }
    }
  }

  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate(() => {
        const elements = Array.from(
          document.querySelectorAll(
            'button, [role="button"], input[type="submit"], [data-testid*="post" i], [data-testid*="send" i], [data-testid*="reply" i]'
          )
        ) as HTMLElement[];

        const button = elements.find((element) => {
          const disabled =
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true";
          if (disabled) return false;

          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) return false;

          const text = String(
            element.innerText ||
              element.getAttribute("value") ||
              element.getAttribute("aria-label") ||
              element.getAttribute("title") ||
              ""
          ).trim();

          return (
            element.getAttribute("type") === "submit" ||
            /^(post|send|reply|comment)$/i.test(text)
          );
        });

        if (!button) return false;
        button.click();
        return true;
      });

      if (result) return "clicked-button";
    } catch {
      // Keep checking other frames.
    }
  }

  await page.keyboard.press("Enter");
  return "pressed-enter";
}

async function postThroughBrowser(
  text: string,
  groupId: number,
  parentCommentId: string | null
): Promise<any> {
  const { page } = await openRealBrowser();
  const groupUrl = getGroupUrl(groupId);

  console.log(`Opening Real group page: ${groupUrl}`);

  await page.goto(groupUrl, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  const pageText = await page.evaluate(
    () => document.body?.innerText || ""
  );

  if (
    /verify you are human|checking your browser|captcha|turnstile/i.test(
      pageText
    )
  ) {
    throw new Error(
      "Real displayed an interactive browser verification challenge."
    );
  }

  if (parentCommentId) {
    await clickReplyForParent(page, parentCommentId);
  }

  await enterText(page, text);
  const submitMethod = await clickSubmit(page);
  console.log(`Real comment submit method: ${submitMethod}`);
  await new Promise((resolve) => setTimeout(resolve, 2500));

  return {
    ok: true,
    postedWith: "puppeteer-persistent-profile",
    groupId,
    parentCommentId,
  };
}

function queuePost<T>(operation: () => Promise<T>): Promise<T> {
  const next = postQueue.then(operation, operation);
  postQueue = next.catch(() => undefined);
  return next;
}

RealClient.prototype.postToGroup = async function (
  text: string,
  groupId?: string | number,
  parentCommentId: string | null = null
): Promise<any> {
  const resolvedGroupId = Number(groupId ?? process.env.REAL_GROUP_ID);

  if (!Number.isInteger(resolvedGroupId) || resolvedGroupId <= 0) {
    throw new Error("Group ID is missing or invalid.");
  }

  const message = String(text || "").trim();
  if (!message) {
    throw new Error("Cannot post an empty group message.");
  }

  return queuePost(() =>
    postThroughBrowser(
      message,
      resolvedGroupId,
      parentCommentId
    )
  );
};

console.log(
  "Persistent-profile Puppeteer group-post patch loaded."
);
