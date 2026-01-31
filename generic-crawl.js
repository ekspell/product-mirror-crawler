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
const connections = [];
const pathToRouteId = new Map();

function getFlowName(path, productName) {
  // Generic flow categorization based on common patterns
  if (path.includes('/admin')) return 'Admin';
  if (path.includes('/settings') || path.includes('/preferences')) return 'Settings';
  if (path.includes('/dashboard') || path.includes('/home')) return 'Dashboard';
  if (path.includes('/profile') || path.includes('/account')) return 'Account';
  if (path.includes('/analytics') || path.includes('/reports')) return 'Analytics';
  if (path.includes('/integrations')) return 'Integrations';
  if (path.includes('/help') || path.includes('/support')) return 'Support';
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
      .filter(href => {
        try {
          const url = new URL(href);
          const baseUrlObj = new URL(base);
          // Only include links from the same origin
          return url.origin === baseUrlObj.origin;
        } catch {
          return false;
        }
      })
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

async function crawlPage(page, path, baseUrl, productId, productName) {
  if (visited.has(path)) return;
  visited.add(path);

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

  const flowName = getFlowName(path, productName);

  let pageName = await page.title();
  // Strip product name from title
  pageName = pageName.replace(new RegExp(`\\s*[|–—-]\\s*${productName}\\s*$`, 'i'), '').trim();
  if (!pageName || pageName.toLowerCase() === productName.toLowerCase()) {
    pageName = getPageNameFromPath(path);
  }

  // Check if route already exists for this product+path
  const { data: existingRoute } = await supabase
    .from('routes')
    .select('id, name, flow_name')
    .eq('product_id', productId)
    .eq('path', path)
    .single();

  let route;
  if (existingRoute) {
    // Route exists - use it and optionally update the name if it changed
    route = existingRoute;
    if (route.name !== pageName) {
      await supabase
        .from('routes')
        .update({ name: pageName })
        .eq('id', route.id);
    }
  } else {
    // Create new route
    const { data: newRoute, error: routeError } = await supabase
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
    route = newRoute;
  }

  pathToRouteId.set(path, route.id);
  pathToRouteId.set(basePath, route.id);

  const timestamp = Date.now();
  const safeProductName = productName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const safePageName = pageName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filename = `${safeProductName}-${safePageName}-${timestamp}.png`;

  const { error: uploadError } = await supabase.storage
    .from('screenshots')
    .upload(filename, screenshotBuffer, { contentType: 'image/png' });

  if (uploadError) {
    console.log(`  Upload error: ${uploadError.message}`);
    return;
  }

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
    if (!visited.has(link)) {
      connections.push({ sourcePath: path, destPath: link });
      discovered.push(link);
    }
  }
}

async function saveConnections(productId) {
  console.log(`\nSaving page connections...`);

  const seen = new Set();
  const toInsert = [];

  for (const { sourcePath, destPath } of connections) {
    const sourceId = pathToRouteId.get(sourcePath) || pathToRouteId.get(sourcePath.split('?')[0]);
    const destId = pathToRouteId.get(destPath) || pathToRouteId.get(destPath.split('?')[0]);

    if (!sourceId || !destId || sourceId === destId) continue;

    const key = `${sourceId}:${destId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    toInsert.push({
      source_route_id: sourceId,
      destination_route_id: destId,
      product_id: productId
    });
  }

  if (toInsert.length === 0) {
    console.log('No connections to save.');
    return;
  }

  let saved = 0;
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50);
    const { error } = await supabase
      .from('page_connections')
      .upsert(batch, { onConflict: 'source_route_id,destination_route_id' });

    if (!error) saved += batch.length;
  }

  console.log(`Saved ${saved} unique connections (from ${connections.length} total links).`);
}

async function attemptLogin(page, baseUrl, product) {
  if (product.auth_state === 'public') {
    console.log('Product is public, skipping login');
    return true;
  }

  if (!product.login_email || !product.login_password) {
    console.log('No login credentials provided for authenticated product');
    return false;
  }

  console.log(`Attempting auto-login for ${product.name}...`);

  try {
    // Try to find login page
    const loginUrls = [
      '/login',
      '/signin',
      '/auth/login',
      '/account/login'
    ];

    let loginPageFound = false;
    for (const loginUrl of loginUrls) {
      try {
        await page.goto(baseUrl + loginUrl, { waitUntil: 'networkidle', timeout: 10000 });
        loginPageFound = true;
        break;
      } catch {
        continue;
      }
    }

    if (!loginPageFound) {
      console.log('Could not find login page');
      return false;
    }

    await dismissCookieBanner(page);

    // Try multiple email input selectors
    const emailInput = page.getByLabel(/email/i)
      .or(page.getByPlaceholder(/email/i))
      .or(page.locator('input[type="email"]'))
      .or(page.locator('input[name="email"]'))
      .or(page.locator('input[name="username"]'));

    await emailInput.first().waitFor({ timeout: 5000 });
    await emailInput.first().fill(product.login_email);

    // Check if password field is visible (single-step login)
    const passwordInput = page.getByLabel(/password/i)
      .or(page.getByPlaceholder(/password/i))
      .or(page.locator('input[type="password"]'))
      .or(page.locator('input[name="password"]'));

    const passwordVisible = await passwordInput.first().isVisible({ timeout: 1000 }).catch(() => false);

    if (!passwordVisible) {
      // Two-step login - click continue/next button
      const continueButton = page.getByRole('button', { name: /continue|next|submit/i });
      await continueButton.first().click();
      await passwordInput.first().waitFor({ timeout: 10000 });
    }

    await passwordInput.first().fill(product.login_password);

    // Click login button
    const loginButton = page.getByRole('button', { name: /log in|sign in|login|submit/i });
    await loginButton.first().click();

    // Wait for navigation away from login page
    await page.waitForURL(url => {
      const path = new URL(url).pathname;
      return !path.includes('/login') && !path.includes('/signin') && !path.includes('/auth');
    }, { timeout: 30000 });

    console.log('Auto-login successful!');
    return true;
  } catch (err) {
    console.log(`Auto-login failed: ${err.message}`);
    return false;
  }
}

async function run() {
  const productId = process.argv[2];

  if (!productId) {
    console.error('Usage: node generic-crawl.js <product-id>');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage();

  const { data: product, error } = await supabase
    .from('products')
    .select('id, name, staging_url, auth_state, login_email, login_password')
    .eq('id', productId)
    .single();

  if (error || !product) {
    console.log(`Product not found: ${productId}`);
    await browser.close();
    process.exit(1);
  }

  console.log(`Starting crawl for: ${product.name}`);
  console.log(`URL: ${product.staging_url}`);
  console.log(`Auth state: ${product.auth_state}`);

  const baseUrl = product.staging_url.replace(/\/$/, ''); // Remove trailing slash

  // Attempt login if authenticated
  const loginSuccess = await attemptLogin(page, baseUrl, product);

  if (product.auth_state === 'authenticated' && !loginSuccess) {
    console.log('Manual login required. Please log in, then press Enter...');
    await new Promise(resolve => process.stdin.once('data', resolve));
  }

  // If we're not authenticated or login didn't work, start from home page
  if (!loginSuccess || product.auth_state === 'public') {
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
    } catch (err) {
      console.log('Network idle timeout, continuing anyway...');
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
    await page.waitForTimeout(2000);
    await dismissCookieBanner(page);
  }

  const startPath = new URL(page.url()).pathname;
  discovered.push(startPath);

  console.log('\nStarting link discovery...\n');

  while (discovered.length > 0) {
    const path = discovered.shift();
    await crawlPage(page, path, baseUrl, product.id, product.name);
  }

  await saveConnections(product.id);

  console.log(`\nDone! Discovered ${visited.size} screens.`);
  await browser.close();
}

run();
