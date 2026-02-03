const { supabase } = require('../lib/supabase');

async function captureScreenshot(page, { sessionId, flowId, flowName, productId, stepNumber }) {
  // Ensure window is in front before capturing
  await page.bringToFront();

  // Small delay to ensure the page is fully rendered
  await new Promise(r => setTimeout(r, 100));

  const screenshot = await page.screenshot({ fullPage: true });
  const url = page.url();
  let title = '';
  try {
    title = await page.title();
  } catch (_) {
    // page may have navigated mid-capture
  }

  const filename = `${sessionId}/${flowId}/${stepNumber}.png`;

  // Upload to Supabase storage
  const { error: uploadError } = await supabase.storage
    .from('screenshots')
    .upload(filename, screenshot, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadError) {
    console.error('Screenshot upload failed:', uploadError.message);
    throw uploadError;
  }

  const { data: urlData } = supabase.storage
    .from('screenshots')
    .getPublicUrl(filename);

  const publicUrl = urlData.publicUrl;

  // Insert route record
  const { data: route, error: routeError } = await supabase
    .from('routes')
    .insert({
      product_id: productId,
      flow_id: flowId,
      flow_name: flowName || null,
      session_id: sessionId,
      path: new URL(url).pathname,
      name: title || 'Untitled',
      step_number: stepNumber,
    })
    .select('id')
    .single();

  if (routeError) {
    console.error('Route insert failed:', routeError.message);
    throw routeError;
  }

  // Insert capture record
  const { error: captureError } = await supabase
    .from('captures')
    .insert({
      route_id: route.id,
      screenshot_url: publicUrl,
      captured_at: new Date().toISOString(),
    });

  if (captureError) {
    console.error('Capture insert failed:', captureError.message);
    throw captureError;
  }

  return { routeId: route.id, screenshotUrl: publicUrl, path: new URL(url).pathname, title };
}

module.exports = { captureScreenshot };
