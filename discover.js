require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const visited = new Set();
const visitedBasePaths = new Set();
const discovered = [];
const connections = []; // {sourcePath, destPath} pairs for flow mapping

function getFlowName(path) {
  if (path.includes('/admin')) return 'Admin';
  if (path.includes('/settings') || path.includes('/personal')) return 'Settings';
  if (path.includes('/event_types')) return 'Event Setup';
  if (path.includes('/scheduled_events')) return 'Scheduling';
  if (path.includes('/workflows')) return 'Workflows';
  if (path.includes('/routing')) return 'Routing';
  if (path.includes('/analytics')) return 'Analytics';
  if (path.includes('/integrations')) return 'Integrations';
  if (path.includes('/availability')) return 'Availability';
  if (path.includes('/home')) return 'Dashboard';
  return 'Other';
}

function getPageNameFromPath(path) {
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || 'Home';
  return last
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function dismissCookieBanner(page) {
  const buttonLabels = [
    /accept all/i,
    /accept cookies/i,
    /accept$/i,
    /got it/i,
    /i agree/i,
    /allow all/i,
    /ok$/i,
    /okay/i,
    /consent/i,
  ];
  for (const label of buttonLabels) {
    const btn = page.getByRole('button', { name: label });
    try {
      await btn.waitFor({ timeout: 1500 });
      await btn.click();
      console.log('  Dismissed cookie banner');
      return;
    } catch {
      // not found, try next
    }
  }
}

async function discoverLinks(page, baseUrl) {
  const links = await page.evaluate((base) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map(a => a.href)
      .filter(href => href.startsWith(base) && href.includes('/app/'))
      .map(href => {
        try {
          const url = new URL(href);
          return url.pathname + url.search;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }, baseUrl);
  
  return [...new Set(links)];
}

async function crawlPage(page, path, baseUrl, productId) {
  if (visited.has(path)) return;
  visited.add(path);

  // Skip if we already crawled this base path with different query params
  const basePath = path.split('?')[0];
  if (visitedBasePaths.has(basePath)) {
    console.log(`  Skipping duplicate: ${path} (already have ${basePath})`);
    return;
  }
  visitedBasePaths.add(basePath);
  
  const url = baseUrl + path;
  console.log(`Discovering: ${path}`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  } catch {
    await page.goto(url, { timeout: 15000 });
  }
  await page.waitForTimeout(2000);
  await dismissCookieBanner(page);

  const screenshotBuffer = await page.screenshot({ fullPage: false });
  
  const flowName = getFlowName(path);

  let pageName = await page.title();
  // Strip common suffixes like " | Calendly" or " - Calendly"
  pageName = pageName.replace(/\s*[|–—-]\s*Calendly\s*$/i, '').trim();
  // Fall back to URL-based name if title is empty or generic
  if (!pageName || pageName.toLowerCase() === 'calendly') {
    pageName = getPageNameFromPath(path);
  }
  
  const { data: route, error: routeError } = await supabase
    .from('routes')
    .insert({
      name: pageName,
      path: path,
      product_id: productId,
      flow_name: flowName
    })
    .select()
    .single();
  
  if (routeError) {
    console.log(`  Route error: ${routeError.message}`);
    return;
  }
  
  const timestamp = Date.now();
  const filename = `calendly-${pageName.toLowerCase().replace(/\s+/g, '-')}-${timestamp}.png`;
  
  await supabase.storage
    .from('screenshots')
    .upload(filename, screenshotBuffer, { contentType: 'image/png' });
  
  const { data: urlData } = supabase.storage
    .from('screenshots')
    .getPublicUrl(filename);
  
  await supabase
    .from('captures')
    .insert({
      route_id: route.id,
      screenshot_url: urlData.publicUrl
    });
  
  console.log(`  ✓ Captured: ${pageName} (${flowName})`);
  
  const links = await discoverLinks(page, baseUrl);
  for (const link of links) {
    connections.push({ sourcePath: path, destPath: link });
    if (!visited.has(link)) {
      discovered.push(link);
    }
  }
}

async function saveConnections(productId) {
  console.log(`\nSaving ${connections.length} page connections...`);
  let saved = 0;

  for (const { sourcePath, destPath } of connections) {
    // Look up both routes by path
    const { data: sourceRoute } = await supabase
      .from('routes')
      .select('id')
      .eq('path', sourcePath)
      .eq('product_id', productId)
      .single();

    const { data: destRoute } = await supabase
      .from('routes')
      .select('id')
      .eq('path', destPath)
      .eq('product_id', productId)
      .single();

    if (!sourceRoute || !destRoute) continue;
    if (sourceRoute.id === destRoute.id) continue;

    const { error } = await supabase
      .from('page_connections')
      .upsert({
        source_route_id: sourceRoute.id,
        destination_route_id: destRoute.id,
        product_id: productId
      }, { onConflict: 'source_route_id,destination_route_id' });

    if (!error) saved++;
  }

  console.log(`Saved ${saved} unique connections.`);
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage();
  
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('name', 'Calendly')
    .single();
  
  if (!product) {
    console.log('Calendly product not found');
    await browser.close();
    return;
  }
  
  const baseUrl = 'https://calendly.com';
  
  console.log('Opening Calendly login...');
  await page.goto(baseUrl + '/login', { waitUntil: 'networkidle' });
  await dismissCookieBanner(page);

  try {
    // Step 1: Enter email
    const emailInput = page.getByLabel('Email address');
    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(process.env.CALENDLY_EMAIL);

    // Step 2: Click Continue
    const continueButton = page.getByRole('button', { name: /continue/i });
    await continueButton.click();

    // Step 3: Enter password (appears on second step)
    const passwordInput = page.getByLabel('Password');
    await passwordInput.waitFor({ timeout: 10000 });
    await passwordInput.fill(process.env.CALENDLY_PASSWORD);

    // Step 4: Click Log In
    const loginButton = page.getByRole('button', { name: /log in/i });
    await loginButton.click();

    // Wait for navigation to the app
    await page.waitForURL('**/app/**', { timeout: 30000 });
    console.log('Auto-login successful!');
  } catch (err) {
    console.log(`Auto-login failed: ${err.message}`);
    console.log('Please log in manually. Press Enter when done...');
    await new Promise(resolve => process.stdin.once('data', resolve));
  }
  
  const startPath = new URL(page.url()).pathname;
  discovered.push(startPath);
  
  console.log('\nStarting link discovery...\n');
  
  while (discovered.length > 0) {
    const path = discovered.shift();
    await crawlPage(page, path, baseUrl, product.id);
  }
  
  await saveConnections(product.id);

  console.log(`\nDone! Discovered ${visited.size} screens.`);
  await browser.close();
}

run();
