import puppeteer, { Browser, Frame, Page } from "puppeteer";

const profileDir =
  process.env.PUPPETEER_PROFILE_DIR || "/app/chrome-profile";

const webAppUrl = String(
  process.env.REAL_WEB_APP_URL || "https://www.real.vg"
).trim();

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

async function hasSavedLogin(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    try {
      const loggedIn = await frame.evaluate(() => {
        const raw = localStorage.getItem("e-accounts");
        if (!raw) return false;

        try {
          const accounts = JSON.parse(raw);
          return (
            Array.isArray(accounts) &&
            accounts.some(
              (account) =>
                account?.authInfo?.userId &&
                account?.authInfo?.token
            )
          );
        } catch {
          return false;
        }
      });

      if (loggedIn) return true;
    } catch {
      // Ignore cross-origin or detached frames.
    }
  }

  return false;
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
  if (sharedPage && !sharedPage.isClosed()) return sharedPage;

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

async function findFrameWithSelector(
  page: Page,
  selector: string,
  timeoutMs = 30000
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.$(selector)) return frame;
      } catch {
        // Ignore frames that changed while checking.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Could not find selector in any frame: ${selector}`);
}

async function clearAndType(
  frame: Frame,
  selector: string,
  value: string
): Promise<void> {
  const input = await frame.$(selector);
  if (!input) throw new Error(`Input disappeared: ${selector}`);

  await input.click();
  await frame.evaluate(
    (element) => {
      const inputElement = element as HTMLInputElement;
      inputElement.value = "";
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    },
    input
  );
  await input.type(value, { delay: 25 });
}

async function logLoginDebug(page: Page, label: string): Promise<void> {
  console.log("====================================");
  console.log(`REAL LOGIN DEBUG: ${label}`);
  console.log("====================================");
  console.log("Current URL:", page.url());
  console.log("Page Title:", await page.title());
  console.log(
    "Frames:",
    page.frames().map((frame) => frame.url())
  );

  const bodyText = await page.evaluate(
    () => document.body?.innerText || ""
  );
  console.log(bodyText.substring(0, 5000));

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

  let loginFrame: Frame;
  try {
    loginFrame = await findFrameWithSelector(page, loginSelector, 30000);
  } catch (error) {
    await logLoginDebug(page, "login-field-timeout");
    throw error;
  }

  await clearAndType(loginFrame, loginSelector, login);

  let passwordFrame: Frame;
  try {
    passwordFrame = await findFrameWithSelector(
      page,
      passwordSelector,
      30000
    );
  } catch (error) {
    await logLoginDebug(page, "password-field-timeout");
    throw error;
  }

  await clearAndType(passwordFrame, passwordSelector, password);

  const submitted = await passwordFrame.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"]'
      )
    ) as HTMLElement[];

    const submit = candidates.find((element) => {
      const text = String(
        element.innerText ||
          element.getAttribute("value") ||
          element.getAttribute("aria-label") ||
          ""
      ).trim();

      const disabled =
        element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true";

      return (
        !disabled &&
        (element.getAttribute("type") === "submit" ||
          /^(log in|login|sign in|continue)$/i.test(text))
      );
    });

    if (!submit) return false;
    submit.click();
    return true;
  });

  if (!submitted) {
    throw new Error("Could not find the Real login submit button.");
  }

  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (await hasSavedLogin(page)) {
      console.log(
        "Real browser login successful. Session saved in the Railway volume."
      );
      return;
    }

    const pageText = await page.evaluate(
      () => document.body?.innerText || ""
    );

    if (
      /verify you are human|checking your browser|captcha|turnstile/i.test(
        pageText
      )
    ) {
      throw new Error(
        "Real showed an interactive verification challenge during login."
      );
    }
  }

  await logLoginDebug(page, "login-failed");
  throw new Error("Real browser login did not complete within 60 seconds.");
}

export async function openRealBrowser(): Promise<{
  browser: Browser;
  page: Page;
}> {
  const browser = await getBrowser();
  const page = await getPage(browser);

  await page.goto(webAppUrl, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  if (!(await hasSavedLogin(page))) {
    await loginToReal(page);
  } else {
    console.log("Existing Real browser session found in Railway volume.");
  }

  return { browser, page };
}
