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

  if (!browser.isConnected()) {
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

  await page.waitForSelector(loginSelector, {
    timeout: 30000,
  });

  await page.click(loginSelector, {
    clickCount: 3,
  });
  await page.type(loginSelector, login, {
    delay: 25,
  });

  await page.waitForSelector(passwordSelector, {
    timeout: 30000,
  });

  await page.click(passwordSelector, {
    clickCount: 3,
  });
  await page.type(passwordSelector, password, {
    delay: 25,
  });

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
