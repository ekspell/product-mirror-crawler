require('dotenv').config();
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Go to Todoist and log in
  await page.goto('https://todoist.com/');
  await page.getByRole('link', { name: 'Log in' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(process.env.TODOIST_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.TODOIST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/app/**');

  const routes = [
    { name: 'inbox', url: 'https://app.todoist.com/app/inbox' },
    { name: 'today', url: 'https://app.todoist.com/app/today' },
    { name: 'upcoming', url: 'https://app.todoist.com/app/upcoming' },
    { name: 'settings', url: 'https://app.todoist.com/app/settings' },
  ];

  for (const route of routes) {
    await page.goto(route.url);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${route.name}.png`, fullPage: true });
    console.log(`Captured: ${route.name}`);
  }

  console.log('All screenshots saved!');
  await browser.close();
}

run();