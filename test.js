require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// Connect to Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function run() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Log in to Todoist
  await page.goto('https://todoist.com/');
  await page.getByRole('link', { name: 'Log in' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(process.env.TODOIST_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.TODOIST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/app/**');

  // Get routes from database
  const { data: routes, error } = await supabase
    .from('routes')
    .select('id, name, path');

  if (error) {
    console.error('Error fetching routes:', error);
    await browser.close();
    return;
  }

  console.log(`Found ${routes.length} routes to capture`);

  // Visit each route and take a screenshot
  for (const route of routes) {
    const url = `https://app.todoist.com/app${route.path}`;
    await page.goto(url);
    await page.waitForTimeout(2000);
    
    // Take screenshot and get as buffer
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    
    // Create unique filename with timestamp
    const timestamp = Date.now();
    const filename = `${route.name.toLowerCase()}-${timestamp}.png`;
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(filename, screenshotBuffer, {
        contentType: 'image/png'
      });

    if (uploadError) {
      console.error(`Error uploading ${route.name}:`, uploadError);
      continue;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('screenshots')
      .getPublicUrl(filename);

    // Save capture record to database
    const { error: insertError } = await supabase
      .from('captures')
      .insert({
        route_id: route.id,
        screenshot_url: urlData.publicUrl,
      });

    if (insertError) {
      console.error(`Error saving capture for ${route.name}:`, insertError);
    } else {
      console.log(`Captured and uploaded: ${route.name}`);
    }
  }

  console.log('All done!');
  await browser.close();
}

run();