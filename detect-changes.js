require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const pixelmatch = require('pixelmatch').default;
const { PNG } = require('pngjs');
const https = require('https');
const http = require('http');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          const png = PNG.sync.read(buffer);
          resolve(png);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function compareScreenshots(oldUrl, newUrl) {
  try {
    const [oldImg, newImg] = await Promise.all([
      downloadImage(oldUrl),
      downloadImage(newUrl)
    ]);

    // Ensure images are same size (resize if needed)
    const width = Math.min(oldImg.width, newImg.width);
    const height = Math.min(oldImg.height, newImg.height);

    // Create diff image
    const diff = new PNG({ width, height });

    // Compare pixels
    const numDiffPixels = pixelmatch(
      oldImg.data,
      newImg.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 } // 0.1 = 10% tolerance for minor rendering differences
    );

    const totalPixels = width * height;
    const diffPercentage = ((numDiffPixels / totalPixels) * 100).toFixed(2);

    return {
      hasDifference: numDiffPixels > 0,
      diffPercentage: parseFloat(diffPercentage),
      numDiffPixels,
      totalPixels
    };
  } catch (error) {
    console.error('  Error comparing images:', error.message);
    return null;
  }
}

function generateChangeSummary(diffPercentage) {
  if (diffPercentage === 0) {
    return 'No changes detected';
  } else if (diffPercentage < 1) {
    return 'Minor changes detected';
  } else if (diffPercentage < 5) {
    return 'Moderate changes detected';
  } else if (diffPercentage < 20) {
    return 'Significant changes detected';
  } else {
    return 'Major changes detected';
  }
}

async function detectChangesForProduct(productId) {
  console.log(`\nDetecting changes for product: ${productId}\n`);

  // Get all routes for this product
  const { data: routes, error: routesError } = await supabase
    .from('routes')
    .select('id, name, path')
    .eq('product_id', productId);

  if (routesError || !routes || routes.length === 0) {
    console.log('No routes found');
    return;
  }

  console.log(`Found ${routes.length} routes to check\n`);

  let checkedCount = 0;
  let changesDetected = 0;

  for (const route of routes) {
    // Get the latest 2 captures for this route
    const { data: captures, error: capturesError } = await supabase
      .from('captures')
      .select('id, screenshot_url, captured_at')
      .eq('route_id', route.id)
      .order('captured_at', { ascending: false })
      .limit(2);

    if (capturesError || !captures || captures.length < 2) {
      console.log(`  Skipping "${route.name}" - need at least 2 captures for comparison`);
      continue;
    }

    const [newCapture, oldCapture] = captures;

    console.log(`Comparing "${route.name}"...`);
    console.log(`  Old: ${new Date(oldCapture.captured_at).toLocaleString()}`);
    console.log(`  New: ${new Date(newCapture.captured_at).toLocaleString()}`);

    const result = await compareScreenshots(oldCapture.screenshot_url, newCapture.screenshot_url);

    if (!result) {
      console.log('  ⚠️  Comparison failed\n');
      continue;
    }

    checkedCount++;

    const hasChanges = result.diffPercentage > 0.5; // Ignore very minor differences (< 0.5%)
    const summary = generateChangeSummary(result.diffPercentage);

    if (hasChanges) {
      changesDetected++;
      console.log(`  🔴 CHANGES DETECTED: ${result.diffPercentage}% different (${result.numDiffPixels.toLocaleString()} pixels)`);
    } else {
      console.log(`  ✅ No changes: ${result.diffPercentage}% different`);
    }

    // Update the latest capture with change detection results
    const { error: updateError } = await supabase
      .from('captures')
      .update({
        has_changes: hasChanges,
        change_summary: hasChanges ? summary : null
      })
      .eq('id', newCapture.id);

    if (updateError) {
      console.log(`  ⚠️  Failed to update capture: ${updateError.message}`);
    }

    console.log();
  }

  console.log(`\n📊 Summary:`);
  console.log(`  Total routes checked: ${checkedCount}`);
  console.log(`  Changes detected: ${changesDetected}`);
  console.log(`  No changes: ${checkedCount - changesDetected}`);
  console.log(`  Skipped (not enough captures): ${routes.length - checkedCount}`);
}

async function run() {
  const productId = process.argv[2];

  if (!productId) {
    console.error('Usage: node detect-changes.js <product-id>');
    process.exit(1);
  }

  // Get product name
  const { data: product } = await supabase
    .from('products')
    .select('name')
    .eq('id', productId)
    .single();

  if (!product) {
    console.log(`Product not found: ${productId}`);
    process.exit(1);
  }

  console.log(`Product: ${product.name}`);

  await detectChangesForProduct(productId);
  console.log('\n✅ Change detection complete!');
}

run().catch(console.error);
