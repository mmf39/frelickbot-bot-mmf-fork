import puppeteer, { Browser, Page } from "puppeteer";

const profileDir =
  process.env.PUPPETEER_PROFILE_DIR ||
  "/app/chrome-profile";

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
  return page.evaluate(() => {
    const raw = localStorage.getItem("e-accounts");

    if (!raw) {
      return false;
    }

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
}

async function launchBrowser(): Promise<Browser> {
  console.log(
    `Launching persistent Real browser at ${profileDir}`
  );

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

  await sharedPage.setViewport({
    width: 1280,
    height: 900,
  });

  await sharedPage.setUserAgent(
    process.env.REAL_BROWSER_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
  );

  return sharedPage;
}

async function clickLoginLink(page: Page): Promise<void> {
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        "a, button, [role=button]"
      )
    ) as HTMLElement[];

    const loginButton = candidates.find((element) =>
      /^(log in|login|sign in)$/i.test(
        String(
          element.innerText ||
            element.getAttribute("aria-label") ||
            ""
        ).trim()
      )
    );

    loginButton?.click();
  });
}

async function clearAndType(
  page: Page,
  selector: string,
  value: string
): Promise<void> {
  await page.focus(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(selector, value, { delay: 25 });
}

async function logLoginDebug(page: Page): Promise<void> {
  console.log("====================================");
  console.log("REAL LOGIN DEBUG");
  console.log("====================================");
  console.log("Current URL:", page.url());
  console.log("Page Title:", await page.title());

  const bodyText = await page.evaluate(() => {
    return document.body?.innerText || "";
  });

  console.log("----- PAGE TEXT START -----");
  console.log(bodyText.substring(0, 5000));
  console.log("----- PAGE TEXT END -----");

  try {
    await page.screenshot({
      path: "/tmp/real-before-login.png",
      fullPage: true,
    });
    console.log(
      "Saved screenshot: /tmp/real-before-login.png"
    );
  } catch (error) {
    console.error(
      "Could not save login debug screenshot:",
      error
    );
  }
}

async function loginToReal(page: Page): Promise<void> {
  const login = getLogin();
  const password = getPassword();

  if (!login || !password) {
    throw new Error(
      "Missing Real login variables. Add REAL_LOGIN_EMAIL (or REAL_LOGIN_USERNAME) and REAL_LOGIN_PASSWORD in Railway."
    );
  }

  console.log(
    "No saved Real browser session. Attempting automatic login."
  );

  await clickLoginLink(page);

  const loginSelector =
    'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[type="text"]';
  const passwordSelector =
    'input[type="password"], input[name="password"], input[autocomplete="current-password"]';

  await logLoginDebug(page);

  try {
    await page.waitForSelector(loginSelector, {
      timeout: 30000,
    });
  } catch (error) {
    console.error("Could not find login selector.");
    console.error("Current URL:", page.url());
    console.error("Page Title:", await page.title());

    const bodyText = await page.evaluate(
      () => document.body?.innerText || ""
    );

    console.error("----- LOGIN TIMEOUT PAGE TEXT START -----");
    console.error(bodyText.substring(0, 5000));
    console.error("----- LOGIN TIMEOUT PAGE TEXT END -----");

    try {
      await page.screenshot({
        path: "/tmp/real-login-timeout.png",
        fullPage: true,
      });
      console.error(
        "Saved screenshot: /tmp/real-login-timeout.png"
      );
    } catch (screenshotError) {
      console.error(
        "Could not save login-timeout screenshot:",
        screenshotError
      );
    }

    throw error;
  }

  await clearAndType(page, loginSelector, login);

  try {
    await page.waitForSelector(passwordSelector, {
      timeout: 30000,
    });
  } catch (error) {
    console.error("Could not find password selector.");
    console.error("Current URL:", page.url());
    console.error("Page Title:", await page.title());

    const bodyText = await page.evaluate(
      () => document.body?.innerText || ""
    );

    console.error("----- PASSWORD TIMEOUT PAGE TEXT START -----");
    console.error(bodyText.substring(0, 5000));
    console.error("----- PASSWORD TIMEOUT PAGE TEXT END -----");

    try {
      await page.screenshot({
        path: "/tmp/real-password-timeout.png",
        fullPage: true,
      });
      console.error(
        "Saved screenshot: /tmp/real-password-timeout.png"
      );
    } catch (screenshotError) {
      console.error(
        "Could not save password-timeout screenshot:",
        screenshotError
      );
    }

    throw error;
  }

  await clearAndType(page, passwordSelector, password);

  const submitted = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"]'
      )
    ) as HTMLElement[];

    const submit = buttons.find((element) => {
      const text = String(
        element.innerText ||
          element.getAttribute("value") ||
          element.getAttribute("aria-label") ||
          ""
      ).trim();

      return (
        element.getAttribute("type") === "submit" ||
        /^(log in|login|sign in|continue)$/i.test(text)
      );
    });

    if (!submit) {
      return false;
    }

    submit.click();
    return true;
  });

  if (!submitted) {
    throw new Error(
      "Could not find the Real login submit button."
    );
  }

  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, 1500)
    );

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

  await page.screenshot({
    path: "/tmp/real-login-failed.png",
    fullPage: true,
  });

  throw new Error(
    "Real browser login did not complete within 60 seconds."
  );
}

export async function openRealBrowser(): Promise<{
  browser: Browser;
  page: Page;
}> {
  const browser = await getBrowser();
  const page = await getPage(browser);

  await page.goto("https://www.realapp.com", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  if (!(await hasSavedLogin(page))) {
    await loginToReal(page);
  } else {
    console.log(
      "Existing Real browser session found in Railway volume."
    );
  }

  return {
    browser,
    page,
  };
}
