import puppeteer, { Browser, CookieData, Page } from "puppeteer";
import { RealClient } from "./core/RealClient";

const DEFAULT_GROUP_URL_TEMPLATE =
  "https://www.realapp.com/groups/{groupId}";

function parseCookies(): CookieData[] {
  const raw = String(process.env.REAL_BROWSER_COOKIES_JSON || "").trim();

  if (!raw) {
    throw new Error(
      "REAL_BROWSER_COOKIES_JSON is missing. Export the cookies from your logged-in Real browser session and add them to Railway."
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("REAL_BROWSER_COOKIES_JSON contains invalid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("REAL_BROWSER_COOKIES_JSON must be a JSON array.");
  }

  return parsed.map((cookie: any) => ({
    ...cookie,
    domain: cookie.domain || ".realapp.com",
    path: cookie.path || "/",
  })) as CookieData[];
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
    "Could not find the Real comment box. Set REAL_COMMENT_INPUT_SELECTOR in Railway to the comment input CSS selector."
  );
}

async function clickReplyForParent(
  page: Page,
  parentCommentId: string
): Promise<void> {
  const result = await page.evaluate((commentId) => {
    const escaped = CSS.escape(commentId);
    const target =
      document.querySelector(`[data-comment-id="${escaped}"]`) ||
      document.querySelector(`[data-id="${escaped}"]`) ||
      document.getElementById(commentId) ||
      Array.from(document.querySelectorAll("*")).find((node) =>
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

    const candidates = Array.from(
      container.querySelectorAll("button, [role=button]")
    ) as HTMLElement[];

    const replyButton = candidates.find((element) =>
      /reply/i.test(String(element.innerText || element.getAttribute("aria-label") || ""))
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
        target.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }));
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
    const customButton = await page.$(customSelector);
    if (!customButton) {
      throw new Error(
        `REAL_COMMENT_SUBMIT_SELECTOR did not match anything: ${customSelector}`
      );
    }
    await customButton.click();
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

    const cookies = parseCookies();
    await page.setCookie(...cookies);

    const groupUrl = getGroupUrl(groupId);
    await page.goto(groupUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    const pageText = await page.evaluate(() => document.body.innerText || "");

    if (/log in|sign in/i.test(pageText) && !/log out|profile/i.test(pageText)) {
      throw new Error(
        "The saved Real browser cookies are not logged in. Export fresh cookies from your logged-in browser."
      );
    }

    if (/verify you are human|checking your browser|turnstile/i.test(pageText)) {
      throw new Error(
        "Real displayed an interactive browser verification challenge. Complete it manually in a normal browser and export fresh cookies before retrying."
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
      postedWith: "puppeteer-ui",
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

console.log("Puppeteer group-post patch loaded.");
