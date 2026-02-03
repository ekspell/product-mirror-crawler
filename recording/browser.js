const { chromium } = require('playwright');

// In-memory store of active browser sessions
// sessionId -> { browser, context, page }
const activeSessions = new Map();

async function launchBrowser(sessionId, url) {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  activeSessions.set(sessionId, { browser, context, page });

  return { browser, context, page };
}

function getSession(sessionId) {
  return activeSessions.get(sessionId) || null;
}

async function closeBrowser(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  try {
    await session.browser.close();
  } catch (err) {
    // Browser may already be closed (user closed it manually)
    console.error('Error closing browser:', err.message);
  }

  activeSessions.delete(sessionId);
}

function isSessionActive(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  return session.browser.isConnected();
}

module.exports = { launchBrowser, getSession, closeBrowser, isSessionActive, activeSessions };
