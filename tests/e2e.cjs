const { chromium } = require("playwright");
const fs = require("fs");
const nodePath = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const ROOT = nodePath.resolve(__dirname, "..");
const QA = nodePath.join(ROOT, ".qa");
fs.mkdirSync(QA, { recursive: true });
const BROWSER =
  process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
(async () => {
  const browser = await chromium.launch({
    executablePath: BROWSER,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [],
    network = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  const path = pathToFileURL(nodePath.join(ROOT, "index.html")).href;
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const checks = [];
  function ok(condition, label) {
    if (!condition) throw new Error(label);
    checks.push(label);
  }
  async function snap(name) {
    await page.screenshot({
      path: nodePath.join(QA, name + ".png"),
      fullPage: !name.includes("dialog"),
    });
    ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "No page overflow: " + name,
    );
  }
  async function nav(route) {
    await page.evaluate((r) => {
      location.hash = r;
    }, route);
    await page.waitForFunction((r) => location.hash === "#" + r, route);
    await page.waitForTimeout(80);
  }
  ok(
    (await page.locator(".metric-value").first().textContent()).replace(/\s/g, "") === "12480",
    "Initial fixture total reconciles",
  );
  await page.selectOption("#period", "7");
  ok(
    (await page.locator(".metric-value").first().textContent()).replace(/\s/g, "") === "3120",
    "Seven-day fixture switch",
  );
  await page.selectOption("#period", "30");
  for (const route of ["traffic", "sources", "audit", "plan", "projects", "login"]) {
    await nav(route);
    await snap(route + "-desktop");
  }
  await page.fill("#email", "demo@example.com");
  await page.click("#login-form button");
  await snap("login-code-desktop");
  await page.fill("#code", "000000");
  await page.click("#login-form button");
  ok(
    (await page.locator("#auth-error").textContent()).includes("123456"),
    "Invalid demo code rejected",
  );
  await snap("login-error-desktop");
  await page.fill("#code", "123456");
  await page.click("#login-form button");
  await page.waitForSelector(".kpis");
  ok(page.url().endsWith("#overview"), "Demo code opens workspace");
  await nav("sources");
  await page.click('[data-action="connect"][data-id="metrika"]');
  await snap("source-dialog-desktop");
  await page.click('[data-action="toggle-source"]');
  await nav("traffic");
  ok(
    (await page.locator("main").textContent()).includes("Нет данных о трафике"),
    "Disconnected metrics show empty state",
  );
  await snap("traffic-empty-desktop");
  await nav("sources");
  await page.click('[data-action="connect"][data-id="metrika"]');
  await page.click('[data-action="toggle-source"]');
  await nav("audit");
  await page.click('[data-audit-filter="P1"]');
  ok((await page.locator(".issue").count()) === 2, "Audit priority filter");
  await page.click('[data-action="issue"][data-id="404"]');
  await snap("issue-dialog-desktop");
  await page.click('[data-action="add-task"]');
  await nav("plan");
  ok((await page.locator(".issue").count()) === 1, "Issue becomes plan task");
  await page.selectOption('[data-task-status="404"]', "doing");
  await page.reload();
  ok(
    (await page.locator('[data-task-status="404"]').inputValue()) === "doing",
    "Plan status persists after reload",
  );
  await snap("plan-filled-desktop");
  await page.selectOption('[data-task-status="404"]', "done");
  ok(
    (await page.locator('[role="progressbar"]').getAttribute("aria-valuenow")) === "1",
    "Completion progress updates",
  );
  await page.click('[data-task-filter="todo"]');
  ok(
    (await page.locator("main").textContent()).includes("Здесь пока нет задач"),
    "Task filter empty state",
  );
  await page.click('[data-task-filter="all"]');
  const dlPromise = page.waitForEvent("download");
  await page.click('[data-action="export"]');
  const dl = await dlPromise;
  await dl.saveAs(nodePath.join(QA, "export.txt"));
  ok(
    fs.readFileSync(nodePath.join(QA, "export.txt"), "utf8").includes("Нет внутренних ссылок"),
    "Plan exports acceptance criteria",
  );
  await nav("projects");
  await page.click('[data-action="add-project"]');
  await snap("add-project-dialog-desktop");
  await page.fill("#project-name", "Тестовый проект");
  await page.fill("#project-domain", "invalid");
  await page.click('#project-form button[type="submit"]');
  ok((await page.locator("#project-error").textContent()).length > 0, "Invalid domain rejected");
  await page.fill("#project-domain", "atelier.example");
  await page.click('#project-form button[type="submit"]');
  ok(
    (await page.locator("#project-error").textContent()).includes("уже существует"),
    "Duplicate domain rejected",
  );
  await page.fill("#project-domain", "new.example");
  await page.click('#project-form button[type="submit"]');
  ok(page.url().endsWith("#sources"), "New project opens connections");
  ok(
    (await page.locator(".connection .badge.green").count()) === 0,
    "New project starts disconnected",
  );
  await nav("audit");
  ok((await page.locator(".issue").count()) === 0, "New project has no audit result");
  await page.click('[data-action="scan"]');
  await snap("scan-dialog-desktop");
  await page.click('[data-action="confirm-scan"]');
  ok((await page.locator(".issue").count()) === 6, "Demo audit provides six findings");
  await page.selectOption("#project-select", "atelier");
  await nav("overview");
  await page.setViewportSize({ width: 390, height: 844 });
  await snap("overview-mobile");
  await page.click('[data-action="menu"]');
  await snap("menu-mobile");
  await page.click('[data-nav="sources"]');
  await snap("sources-mobile");
  await page.click('[data-action="connect"][data-id="metrika"]');
  await snap("source-dialog-mobile");
  await page.keyboard.press("Escape");
  ok(!(await page.locator("dialog").evaluate((d) => d.open)), "Escape closes dialog");
  for (const route of ["traffic", "audit", "plan", "projects", "login"]) {
    await nav(route);
    await snap(route + "-mobile");
  }
  await page.fill("#email", "demo@example.com");
  await page.click("#login-form button");
  await snap("login-code-mobile");
  await nav("audit");
  await page.click('[data-action="issue"][data-id="404"]');
  await snap("issue-dialog-mobile");
  await page.locator("dialog").evaluate((d) => (d.scrollTop = d.scrollHeight));
  await snap("issue-dialog-bottom-mobile");
  await page.keyboard.press("Escape");
  await page.click('.footer [data-action="scope"]');
  await snap("scope-dialog-mobile");
  await page.locator("dialog").evaluate((d) => (d.scrollTop = d.scrollHeight));
  await snap("scope-dialog-bottom-mobile");
  await page.click('dialog [data-action="reset"]');
  await snap("reset-dialog-mobile");
  await page.click('[data-action="confirm-reset"]');
  ok((await page.locator("#project-select option").count()) === 2, "Reset restores seed projects");
  await nav("plan");
  ok((await page.locator(".issue").count()) === 0, "Reset removes tasks");
  ok(errors.length === 0, "No JavaScript errors");
  ok(network.length === 0, "Zero external network requests");
  fs.writeFileSync(
    nodePath.join(QA, "results.json"),
    JSON.stringify({ checks, errors, network }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, errors, network }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
