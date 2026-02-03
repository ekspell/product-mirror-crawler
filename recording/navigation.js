const { captureScreenshot } = require('./screenshot');
const { supabase } = require('../lib/supabase');

// Per-session navigation watchers
// sessionId -> { interval, cleanup }
const watchers = new Map();

async function startWatching(sessionId, page, { productId, getActiveFlow }) {
  let lastUrl = page.url();
  let lastCapturedUrl = null;
  let captureInProgress = false;

  async function tryCapture(reason) {
    const currentUrl = page.url();

    // Skip if we already captured this exact URL
    if (currentUrl === lastCapturedUrl) {
      return;
    }

    // Skip if a capture is already in progress
    if (captureInProgress) {
      console.log(`[${reason}] Skipping — capture already in progress`);
      return;
    }

    const flow = getActiveFlow();
    if (!flow) {
      console.log(`[${reason}] Skipping capture — no active flow`);
      return;
    }

    captureInProgress = true;
    lastCapturedUrl = currentUrl;

    // Get current step count for this flow
    const { data: existing } = await supabase
      .from('routes')
      .select('id')
      .eq('flow_id', flow.id);

    const stepNumber = (existing?.length || 0) + 1;

    try {
      const result = await captureScreenshot(page, {
        sessionId,
        flowId: flow.id,
        flowName: flow.name,
        productId,
        stepNumber,
      });

      // Update flow step_count
      await supabase
        .from('flows')
        .update({ step_count: stepNumber })
        .eq('id', flow.id);

      console.log(`[${reason}] Captured step ${stepNumber} for flow "${flow.name}" — ${result.path}`);
    } catch (err) {
      console.error(`[${reason}] Screenshot capture failed:`, err.message);
      // Reset lastCapturedUrl so we can retry this page
      lastCapturedUrl = null;
    } finally {
      captureInProgress = false;
    }
  }

  // Strategy 1: Poll for URL changes
  const urlPollInterval = setInterval(async () => {
    try {
      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        // Wait a moment for the page to settle
        await new Promise(r => setTimeout(r, 500));
        await tryCapture('url-change');
      }
    } catch (_) {
      // page may be closed
    }
  }, 500);

  // Strategy 2: Frame navigation events (named handler for proper cleanup)
  const frameHandler = async (frame) => {
    if (frame === page.mainFrame()) {
      lastUrl = page.url();
      await new Promise(r => setTimeout(r, 500));
      await tryCapture('frame-navigated');
    }
  };

  page.on('framenavigated', frameHandler);

  // Strategy 3: Click + settle detection via injected listener
  try {
    await page.exposeFunction('__pmCapture', () => {
      tryCapture('click-settle');
    });
  } catch (_) {
    // Function may already be exposed from a previous session
  }

  const clickInitScript = `
    document.addEventListener('click', (e) => {
      if (e.isTrusted && window.__pmCapture) {
        setTimeout(() => window.__pmCapture(), 1200);
      }
    }, true);
  `;

  await page.addInitScript({ content: clickInitScript });
  // Also inject into the current page immediately
  await page.evaluate(clickInitScript).catch(() => {});

  // Listen for popups and capture them too
  page.on('popup', async (popup) => {
    console.log('Popup opened:', popup.url());

    try {
      // Wait for popup to load
      await popup.waitForLoadState('domcontentloaded');
      await new Promise(r => setTimeout(r, 500));

      const flow = getActiveFlow();
      if (!flow) {
        console.log('[popup] Skipping capture — no active flow');
        return;
      }

      // Get current step count for this flow
      const { data: existing } = await supabase
        .from('routes')
        .select('id')
        .eq('flow_id', flow.id);

      const stepNumber = (existing?.length || 0) + 1;

      const result = await captureScreenshot(popup, {
        sessionId,
        flowId: flow.id,
        flowName: flow.name,
        productId,
        stepNumber,
      });

      // Update flow step_count
      await supabase
        .from('flows')
        .update({ step_count: stepNumber })
        .eq('id', flow.id);

      console.log(`[popup] Captured step ${stepNumber} for flow "${flow.name}" — ${result.path}`);
    } catch (err) {
      console.error('[popup] Screenshot capture failed:', err.message);
    }
  });

  watchers.set(sessionId, {
    interval: urlPollInterval,
    cleanup: () => {
      clearInterval(urlPollInterval);
      page.removeListener('framenavigated', frameHandler);
    },
  });
}

function stopWatching(sessionId) {
  const watcher = watchers.get(sessionId);
  if (watcher) {
    watcher.cleanup();
    watchers.delete(sessionId);
  }
}

module.exports = { startWatching, stopWatching };
