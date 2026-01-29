require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function run() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const { data: routes, error } = await supabase
    .from('routes')
    .select('id, name, path, products!inner(name, staging_url)')
    .eq('products.name', 'Publix');

  if (error) {
    console.error('Error fetching routes:', error);
    await browser.close();
    return;
  }

  console.log(`Found ${routes.length} Publix routes to capture`);

  for (const route of routes) {
    const baseUrl = route.products.staging_url;
    const url = `${baseUrl}${route.path}`;
    console.log(`Visiting: ${url}`);
    
    await page.goto(url);
    await page.waitForTimeout(3000);
    
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    
    const { data: previousCaptures } = await supabase
      .from('captures')
      .select('screenshot_url')
      .eq('route_id', route.id)
      .order('captured_at', { ascending: false })
      .limit(1);
    
    let hasChanges = false;
    let diffPercentage = 0;
    let changeSummary = null;
    
    if (previousCaptures && previousCaptures.length > 0) {
      console.log(`Comparing with previous capture...`);
      
      try {
        const prevUrl = previousCaptures[0].screenshot_url;
        const response = await fetch(prevUrl);
        const prevBuffer = Buffer.from(await response.arrayBuffer());
        
        const newImg = PNG.sync.read(screenshotBuffer);
        const prevImg = PNG.sync.read(prevBuffer);
        
        if (newImg.width === prevImg.width && newImg.height === prevImg.height) {
          const diff = new PNG({ width: newImg.width, height: newImg.height });
          
          const numDiffPixels = pixelmatch(
            prevImg.data,
            newImg.data,
            diff.data,
            newImg.width,
            newImg.height,
            { threshold: 0.1 }
          );
          
          const totalPixels = newImg.width * newImg.height;
          diffPercentage = (numDiffPixels / totalPixels) * 100;
          hasChanges = diffPercentage > 0.5;
          
          if (hasChanges) {
            changeSummary = `${diffPercentage.toFixed(2)}% of pixels changed`;
            console.log(`Changes detected: ${changeSummary}`);
          } else {
            console.log(`No significant changes`);
          }
        } else {
          hasChanges = true;
          changeSummary = 'Image dimensions changed';
          console.log(`Dimensions changed`);
        }
      } catch (err) {
        console.log(`Could not compare: ${err.message}`);
      }
    } else {
      console.log(`First capture for this route`);
    }
    
    const timestamp = Date.now();
    const filename = `publix-${route.name.toLowerCase().replace(/\s+/g, '-')}-${timestamp}.png`;
    
    const { error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(filename, screenshotBuffer, {
        contentType: 'image/png'
      });

    if (uploadError) {
      console.error(`Error uploading ${route.name}:`, uploadError);
      continue;
    }

    const { data: urlData } = supabase.storage
      .from('screenshots')
      .getPublicUrl(filename);

    const { error: insertError } = await supabase
      .from('captures')
      .insert({
        route_id: route.id,
        screenshot_url: urlData.publicUrl,
        has_changes: hasChanges,
        diff_percentage: diffPercentage,
        change_summary: changeSummary
      });

    if (insertError) {
      console.error(`Error saving capture for ${route.name}:`, insertError);
    } else {
      console.log(`Captured: ${route.name}`);
    }
  }

  console.log('All done!');
  await browser.close();
}

run();