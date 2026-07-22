import puppeteer, { Browser, Page } from "puppeteer";
import { RealClient } from "./core/RealClient";

const DEFAULT_GROUP_URL_TEMPLATE = "https://www.realapp.com/groups/{groupId}";

type BrowserStorage = Record<string, string>;

function parseStorage(): BrowserStorage {
  const raw = String(process.env.REAL_BROWSER_STORAGE_JSON || "").trim();

  if (!raw) {
    throw new Error(
      "REAL_BROWSER_STORAGE_JSON is missing. Copy your logged-in Real localStorage JSON from Chrome and add it to Railway."
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("REAL_BROWSER_STORAGE_JSON contains invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("REAL_BROWSER_STORAGE_JSON must be a JSON object.");
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
      key,
      String(value),
    ])
  );
}

function getGroupUrl(groupId: number): string {
  const template = String(
    process.env.REAL_GROUP_URL_TEMPLATE || DEFAULT_GROUP_URL_TEMPLATE
  ).trim();

  return template.replace("{groupId}", String(groupId));
}

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,900",
    ],
  });
}

async function findComposer(page: Page) {
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

  for (const selector of selectors) {
    const element = await page.$(selector);
    if (element) return element;
  }

  throw new Error(
    "Could not find the Real comment box. Set REAL_COMMENT_INPUT_SELECTOR in Railway."
  );
}

async function clickReplyForParent(page: Page, parentCommentId: string): Promise<void> {
  const result = await page.evaluate((commentId) => {
    const target = Array.from(document.querySelectorAll("*")).find((node) =>
      node.getAttributeNames().some((name) =>
        String(node.getAttribute(name) || "").includes(commentId)
      )
    );

    if (!target) return "parent-not-found";

    const container =
      target.closest("article") ||
      target.closest('[role="article"]') ||
      target.parentElement;

    if (!container) return "container-not-found";

    const buttons = Array.from(
      container.querySelectorAll("button, [role=button]")
    ) as HTMLElement[];

    const replyButton = buttons.find((element) =>
      /reply/i.test(
        String(element.innerText || element.getAttribute("aria-label") || "")
      )
    );

    if (!replyButton) return "reply-button-not-found";
    replyButton.click();
    return "clicked";
  }, parentCommentId);

  if (result !== "clicked") {
    throw new Error(
      `Could not open the reply box for parent comment ${parentCommentId}: ${result}`
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function enterText(page: Page, message: string): Promise<void> {
  const composer = await findComposer(page);
  await composer.click();

  await page.evaluate(
    (element, text) => {
      const target = element as HTMLElement;

      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const prototype =
          target instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
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

async function clickSubmit(page: Page): Promise<void> {
  const customSelector = String(
    process.env.REAL_COMMENT_SUBMIT_SELECTOR || ""
  ).trim();

  if (customSelector) {
    const button = await page.$(customSelector);
    if (!button) {
      throw new Error(
        `REAL_COMMENT_SUBMIT_SELECTOR did not match anything: ${customSelector}`
      );
    }
    await button.click();
    return;
  }

  const clicked = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll("button, [role=button]")
    ) as HTMLElement[];

    const button = buttons.find((element) => {
      const text = String(
        element.innerText || element.getAttribute("aria-label") || ""
      ).trim();
      const disabled =
        element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true";

      return !disabled && /^(post|send|reply)$/i.test(text);
    });

    if (!button) return false;
    button.click();
    return true;
  });

  if (!clicked) {
    throw new Error(
      "Could not find the Real Post/Send/Reply button. Set REAL_COMMENT_SUBMIT_SELECTOR in Railway."
    );
  }
}

async function postThroughBrowser(
  text: string,
  groupId: number,
  parentCommentId: string | null
): Promise<any> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      process.env.REAL_BROWSER_USER_AGENT ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    );

    const storage = parseStorage();

    await page.evaluateOnNewDocument((entries: [string, string][]) => {
      for (const [key, value] of entries) {
        localStorage.setItem(key, value);
      }
    }, Object.entries(storage));

    const groupUrl = getGroupUrl(groupId);
    await page.goto(groupUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    const pageText = await page.evaluate(() => document.body.innerText || "");

    if (/log in|sign in/i.test(pageText) && !/log out|profile/i.test(pageText)) {
      throw new Error(
        "The copied Real browser storage did not restore the login. Refresh REAL_BROWSER_STORAGE_JSON from a currently logged-in browser."
      );
    }

    if (/verify you are human|checking your browser/i.test(pageText)) {
      throw new Error(
        "Real displayed an interactive browser verification challenge that requires manual completion."
      );
    }

    if (parentCommentId) {
      await clickReplyForParent(page, parentCommentId);
    }

    await enterText(page, text);
    await clickSubmit(page);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    return {
      ok: true,
      postedWith: "puppeteer-ui-local-storage",
      groupId,
      parentCommentId,
    };
  } finally {
    await browser.close();
  }
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

  return postThroughBrowser(message, resolvedGroupId, parentCommentId);
};

console.log("Puppeteer local-storage group-post patch loaded.");
