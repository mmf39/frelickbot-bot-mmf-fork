import puppeteer, { Browser, ElementHandle, Frame, Page } from "puppeteer";

const profileDir =
  process.env.PUPPETEER_PROFILE_DIR || "/app/chrome-profile";

const webAppUrl = String(
  process.env.REAL_WEB_APP_URL || "https://www.realsports.io"
)
  .trim()
  .replace(/\/$/, "");

let browserPromise: Promise<Browser> | null = null;
let sharedPage: Page | null = null;

function getLogin(): string {
  return String(
    process.env.REAL_LOGIN_EMAIL ||
      process.env.REAL_LOGIN_USERNAME ||
      process.env.REAL_EMAIL ||
      process.env.REAL_USERNAME ||
      ""
  ).trim();
}

function getPassword(): string {
  return String(
    process.env.REAL_LOGIN_PASSWORD ||
      process.env.REAL_PASSWORD ||
      ""
  ).trim();
}

async function launchBrowser(): Promise<Browser> {
  console.log(`Launching persistent Real browser at ${profileDir}`);

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,900",
    ],
  });

  browser.on("disconnected", () => {
    browserPromise = null;
    sharedPage = null;
  });

  return browser;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }

  const browser = await browserPromise;

  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }

  return browser;
}

async function getPage(browser: Browser): Promise<Page> {
  if (sharedPage && !sharedPage.isClosed()) {
    return sharedPage;
  }

  const pages = await browser.pages();
  sharedPage =
    pages.find((page) => !page.isClosed()) ||
    (await browser.newPage());

  await sharedPage.setViewport({ width: 1280, height: 900 });
  await sharedPage.setUserAgent(
    process.env.REAL_BROWSER_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
  );

  return sharedPage;
}

async function findInput(
  page: Page,
  selector: string,
  timeoutMs = 30000
): Promise<{ frame: Frame; input: ElementHandle<Element> }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const input = await frame.$(selector);
        if (input) {
          return { frame, input };
        }
      } catch {
        // Frame changed while checking.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Could not find selector in any frame: ${selector}`);
}

async function setInputValue(
  frame: Frame,
  input: ElementHandle<Element>,
  value: string
): Promise<void> {
  await input.click();

  await frame.evaluate(
    (element, nextValue) => {
      const target = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;

      target.focus();
      setter?.call(target, nextValue);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    },
    input,
    value
  );
}

async function clickLoginControl(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], [data-testid*="login" i], [data-testid*="submit" i]'
      )
    ) as HTMLElement[];

    const candidate = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const disabled =
        element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true";
      const text = String(
        element.innerText ||
          element.getAttribute("value") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          ""
      ).trim();

      return (
        !disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        (element.getAttribute("type") === "submit" ||
          /log\s*in|login|sign\s*in|continue|submit|next/i.test(text))
      );
    });

    if (candidate) {
      candidate.click();
      return "clicked-button";
    }

    const passwordInput = document.querySelector(
      'input[type="password"], input[name="password"], input[autocomplete="current-password"]'
    ) as HTMLInputElement | null;
    const form = passwordInput?.form || passwordInput?.closest("form");

    if (form) {
      const htmlForm = form as HTMLFormElement;
      if (typeof htmlForm.requestSubmit === "function") {
        htmlForm.requestSubmit();
      } else {
        htmlForm.submit();
      }
      return "submitted-form";
    }

    return "not-found";
  });
}

async function isAuthenticated(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate(() => {
        const passwordVisible = Boolean(
          document.querySelector(
            'input[type="password"], input[name="password"], input[autocomplete="current-password"]'
          )
        );

        let storedAuth = false;

        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index) || "";
          const value = localStorage.getItem(key) || "";

          if (
            /account|auth|session|token|user/i.test(key) &&
            /userId|authInfo|token|accessToken|refreshToken/i.test(value)
          ) {
            storedAuth = true;
            break;
          }
        }

        const bodyText = document.body?.innerText || "";
        const loggedInUi =
          /groups|activity|profile|messages|notifications|log out|sign out/i.test(
            bodyText
          );

        return {
          storedAuth,
          passwordVisible,
          loggedInUi,
        };
      });

      if (
        result.storedAuth ||
        (!result.passwordVisible && result.loggedInUi)
      ) {
        return true;
      }
    } catch {
      // Ignore inaccessible or detached frames.
    }
  }

  return false;
}

async function logLoginDebug(page: Page, label: string): Promise<void> {
  console.log("====================================");
  console.log(`REAL LOGIN DEBUG: ${label}`);
  console.log("====================================");
  console.log("Current URL:", page.url());
  console.log("Page Title:", await page.title());

  for (const frame of page.frames()) {
    try {
      const info = await frame.evaluate(() => ({
        url: location.href,
        text: (document.body?.innerText || "").substring(0, 3000),
        inputs: Array.from(document.querySelectorAll("input")).map(
          (input) => ({
            type: input.getAttribute("type"),
            name: input.getAttribute("name"),
            placeholder: input.getAttribute("placeholder"),
          })
        ),
        buttons: Array.from(
          document.querySelectorAll(
            'button, [role="button"], input[type="submit"]'
          )
        ).map((element) =>
          String(
            (element as HTMLElement).innerText ||
              element.getAttribute("value") ||
              element.getAttribute("aria-label") ||
              ""
          ).trim()
        ),
      }));

      console.log("Frame debug:", JSON.stringify(info, null, 2));
    } catch {
      // Ignore inaccessible or detached frames.
    }
  }

  await page
    .screenshot({
      path: `/tmp/real-login-${label}.png`,
      fullPage: true,
    })
    .catch(() => undefined);
}

async function loginToReal(page: Page): Promise<void> {
  const login = getLogin();
  const password = getPassword();

  if (!login || !password) {
    throw new Error(
      "Missing REAL_LOGIN_EMAIL (or REAL_LOGIN_USERNAME) and REAL_LOGIN_PASSWORD."
    );
  }

  console.log("No saved Real browser session. Attempting automatic login.");

  const loginSelector =
    'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[placeholder*="email" i], input[placeholder*="username" i], input[placeholder*="phone" i], input[type="text"]';
  const passwordSelector =
    'input[type="password"], input[name="password"], input[autocomplete="current-password"]';

  await logLoginDebug(page, "before-form");

  const loginField = await findInput(page, loginSelector);
  await setInputValue(loginField.frame, loginField.input, login);

  const passwordField = await findInput(page, passwordSelector);
  await setInputValue(passwordField.frame, passwordField.input, password);

  let submitMethod = await clickLoginControl(passwordField.frame);

  if (submitMethod === "not-found") {
    await passwordField.input.focus();
    await page.keyboard.press("Enter");
    submitMethod = "pressed-enter";
  }

  console.log(`Real login submit method: ${submitMethod}`);

  const deadline = Date.now() + 90000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (await isAuthenticated(page)) {
      console.log(
        "Real browser login successful. Session saved in the Railway volume."
      );
      return;
    }

    const pageText = await page
      .evaluate(() => document.body?.innerText || "")
      .catch(() => "");

    if (
      /verify you are human|checking your browser|captcha|turnstile/i.test(
        pageText
      )
    ) {
      throw new Error(
        "Real showed an interactive verification challenge during login."
      );
    }

    if (
      /incorrect|invalid|wrong password|could not sign in|login failed/i.test(
        pageText
      )
    ) {
      await logLoginDebug(page, "credentials-rejected");
      throw new Error("Real rejected the configured login credentials.");
    }
  }

  await logLoginDebug(page, "login-failed");
  throw new Error(
    "Real browser login did not complete within 90 seconds. Check the REAL LOGIN DEBUG output for the visible page text and controls."
  );
}

export async function openRealBrowser(): Promise<{
  browser: Browser;
  page: Page;
}> {
  const browser = await getBrowser();
  const page = await getPage(browser);

  console.log(`Opening Real web app: ${webAppUrl}`);

  await page.goto(webAppUrl, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  if (!(await isAuthenticated(page))) {
    await loginToReal(page);
  } else {
    console.log("Existing Real browser session found in Railway volume.");
  }

  return { browser, page };
}
