import puppeteer, { Browser, Page } from "puppeteer";

const profileDir =
  process.env.PUPPETEER_PROFILE_DIR || "/app/chrome-profile";

export async function openRealBrowser(): Promise<{
  browser: Browser;
  page: Page;
}> {
  const login = process.env.REAL_LOGIN_EMAIL;
  const password = process.env.REAL_LOGIN_PASSWORD;

  if (!login || !password) {
    throw new Error(
      "Missing REAL_LOGIN_EMAIL or REAL_LOGIN_PASSWORD."
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  await page.goto("https://www.realapp.com", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  const alreadyLoggedIn = await page.evaluate(() => {
    return Boolean(localStorage.getItem("e-accounts"));
  });

  if (alreadyLoggedIn) {
    console.log("Existing Real browser session found.");
    return { browser, page };
  }

  console.log("No saved Real session. Attempting login.");

  const loginSelector =
    'input[type="email"], input[name="email"], input[name="username"], input[type="text"]';

  const passwordSelector =
    'input[type="password"], input[name="password"]';

  await page.waitForSelector(loginSelector, {
    timeout: 30000,
  });

  await page.click(loginSelector);
  await page.type(loginSelector, login, {
    delay: 30,
  });

  await page.waitForSelector(passwordSelector, {
    timeout: 30000,
  });

  await page.click(passwordSelector);
  await page.type(passwordSelector, password, {
    delay: 30,
  });

  await Promise.all([
    page
      .waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 60000,
      })
      .catch(() => null),

    page.click('button[type="submit"]'),
  ]);

  await new Promise((resolve) =>
    setTimeout(resolve, 5000)
  );

  const loggedIn = await page.evaluate(() => {
    return Boolean(localStorage.getItem("e-accounts"));
  });

  if (!loggedIn) {
    await page.screenshot({
      path: "/tmp/real-login-failed.png",
      fullPage: true,
    });

    await browser.close();

    throw new Error(
      "Real browser login failed. The login page or verification step needs adjustment."
    );
  }

  console.log("Real browser login successful.");

  return { browser, page };
}
