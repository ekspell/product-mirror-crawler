require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Maximum number of unique components to extract
const MAX_COMPONENTS = 10;

// Component types we're looking for
const COMPONENT_TYPES = [
  'Button (Primary)',
  'Button (Secondary)',
  'Button (Text/Link)',
  'Text Input',
  'Select/Dropdown',
  'Checkbox',
  'Radio Button',
  'Toggle/Switch',
  'Navigation Bar',
  'Sidebar Navigation',
  'Card',
  'Modal/Dialog',
  'Table Header',
  'Avatar/Profile Picture',
  'Badge/Pill',
  'Search Bar',
  'Date Picker',
  'Icon Button',
];

async function analyzeScreenshot(screenshotUrl, routeName) {
  console.log(`  Analyzing: ${routeName}...`);

  try {
    // Fetch the image
    const imageResponse = await fetch(screenshotUrl);
    const imageBuffer = await imageResponse.buffer();
    const base64Image = imageBuffer.toString('base64');

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const { width: imageWidth, height: imageHeight } = metadata;

    // Ask Claude to identify components
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `Analyze this screenshot and identify all UI components from this list: ${COMPONENT_TYPES.join(', ')}.

For each component you find, provide:
1. Component type (must match one from the list)
2. Specific name (e.g., "Sign in button", "Email input field")
3. Bounding box coordinates as percentages of image dimensions (x, y, width, height) where x,y is top-left corner

CRITICAL INSTRUCTIONS FOR BOUNDING BOXES:
- Include the COMPLETE component - every pixel of text, icons, borders, shadows, backgrounds
- Add generous margins around each component (at least 10-20 pixels on all sides)
- If a button has text, make sure the entire text is included with space on both sides
- If there are drop shadows or hover effects, include those too
- It's better to include too much than to cut off any part
- Double-check that x + width and y + height leave room for the full component

Return ONLY valid JSON array (no markdown, no explanation):
[
  {
    "type": "Button (Primary)",
    "name": "Sign in button",
    "bbox": { "x": 0.44, "y": 0.59, "width": 0.12, "height": 0.06 }
  }
]

Image dimensions: ${imageWidth}x${imageHeight}px
Be precise but generous - capture the full visual extent of each component.`
            }
          ]
        }
      ]
    });

    const responseText = message.content[0].text;

    // Parse the response
    let components = [];
    try {
      // Extract JSON from potential markdown wrapping
      let jsonText = responseText.trim();
      if (jsonText.startsWith('```')) {
        const jsonMatch = jsonText.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
        if (jsonMatch) jsonText = jsonMatch[1];
      }
      components = JSON.parse(jsonText);
    } catch (e) {
      console.log(`    ⚠ Failed to parse components for ${routeName}`);
      return [];
    }

    console.log(`    ✓ Found ${components.length} components`);

    // Convert percentage coordinates to pixels and validate
    const validComponents = components
      .map(comp => ({
        ...comp,
        bbox: {
          x: Math.round(comp.bbox.x * imageWidth),
          y: Math.round(comp.bbox.y * imageHeight),
          width: Math.round(comp.bbox.width * imageWidth),
          height: Math.round(comp.bbox.height * imageHeight),
        }
      }))
      .filter(comp => {
        // Validate bounding box is within image bounds
        return comp.bbox.x >= 0 &&
               comp.bbox.y >= 0 &&
               comp.bbox.x + comp.bbox.width <= imageWidth &&
               comp.bbox.y + comp.bbox.height <= imageHeight &&
               comp.bbox.width > 0 &&
               comp.bbox.height > 0;
      });

    return { components: validComponents, imageBuffer };
  } catch (error) {
    console.error(`    ✗ Error analyzing ${routeName}:`, error.message);
    return [];
  }
}

async function cropAndUploadComponent(imageBuffer, bbox, componentName, productId, routeId) {
  try {
    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const imageWidth = metadata.width;
    const imageHeight = metadata.height;

    // Add 50px padding around the bounding box to ensure nothing is cut off
    const padding = 50;
    const paddedBbox = {
      left: Math.max(0, bbox.x - padding),
      top: Math.max(0, bbox.y - padding),
      width: Math.min(bbox.width + (padding * 2), imageWidth - Math.max(0, bbox.x - padding)),
      height: Math.min(bbox.height + (padding * 2), imageHeight - Math.max(0, bbox.y - padding)),
    };

    // Ensure crop doesn't exceed image boundaries
    if (paddedBbox.left + paddedBbox.width > imageWidth) {
      paddedBbox.width = imageWidth - paddedBbox.left;
    }
    if (paddedBbox.top + paddedBbox.height > imageHeight) {
      paddedBbox.height = imageHeight - paddedBbox.top;
    }

    // Crop the component from the screenshot with padding
    const croppedBuffer = await sharp(imageBuffer)
      .extract(paddedBbox)
      .png()
      .toBuffer();

    // Generate filename
    const timestamp = Date.now();
    const sanitizedName = componentName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const filename = `components/${productId}/${sanitizedName}-${timestamp}.png`;

    // Upload to Supabase storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(filename, croppedBuffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (uploadError) {
      console.error(`      ✗ Upload failed: ${uploadError.message}`);
      return null;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('screenshots')
      .getPublicUrl(filename);

    return publicUrl;
  } catch (error) {
    console.error(`      ✗ Crop/upload error:`, error.message);
    return null;
  }
}

async function findSimilarComponent(componentName, productId) {
  // Simple similarity: check if a component with same name already exists
  // TODO: Could enhance with image similarity comparison
  const { data } = await supabase
    .from('components')
    .select('id')
    .eq('product_id', productId)
    .eq('name', componentName)
    .limit(1)
    .single();

  return data?.id || null;
}

async function run() {
  console.log('Starting component extraction...\n');

  // Get product
  const productId = process.argv[2];

  if (!productId) {
    console.error('Usage: node extract-components.js <product-id>');
    process.exit(1);
  }

  const { data: product } = await supabase
    .from('products')
    .select('id, name')
    .eq('id', productId)
    .single();

  if (!product) {
    console.log(`Product not found: ${productId}`);
    return;
  }

  console.log(`Product: ${product.name} (${product.id})\n`);

  // Get routes with screenshots
  const { data: routes } = await supabase
    .from('routes')
    .select(`
      id,
      name,
      captures (screenshot_url)
    `)
    .eq('product_id', product.id)
    .limit(3); // Limit screens since we're capping at 10 components total

  if (!routes || routes.length === 0) {
    console.log('No routes found');
    return;
  }

  console.log(`Processing ${routes.length} screens...\n`);

  let totalComponents = 0;
  let totalInstances = 0;

  for (const route of routes) {
    const latestCapture = route.captures?.[0];
    if (!latestCapture?.screenshot_url) {
      console.log(`  ⊘ Skipping ${route.name} (no screenshot)`);
      continue;
    }

    const result = await analyzeScreenshot(latestCapture.screenshot_url, route.name);
    if (!result || !result.components || result.components.length === 0) continue;

    const { components, imageBuffer } = result;

    // Process each component
    for (const comp of components) {
      // Check if similar component exists
      let componentId = await findSimilarComponent(comp.name, product.id);

      if (!componentId) {
        // Create new component entry
        const imageUrl = await cropAndUploadComponent(
          imageBuffer,
          comp.bbox,
          comp.name,
          product.id,
          route.id
        );

        if (!imageUrl) continue;

        const { data: newComponent, error } = await supabase
          .from('components')
          .insert({
            name: comp.name,
            image_url: imageUrl,
            product_id: product.id,
          })
          .select('id')
          .single();

        if (error) {
          console.error(`      ✗ DB error:`, error.message);
          continue;
        }

        componentId = newComponent.id;
        totalComponents++;
        console.log(`      ✓ New component: ${comp.name} (${totalComponents}/${MAX_COMPONENTS})`);
      } else {
        console.log(`      → Existing: ${comp.name}`);
      }

      // Create instance
      const { error: instanceError } = await supabase
        .from('component_instances')
        .insert({
          component_id: componentId,
          route_id: route.id,
          bounding_box: comp.bbox,
        });

      if (!instanceError) {
        totalInstances++;
      }

      // Check if we've reached the limit
      if (totalComponents >= MAX_COMPONENTS) {
        console.log(`\n  ℹ Reached limit of ${MAX_COMPONENTS} unique components`);
        break;
      }
    }

    // Check if we've reached the limit
    if (totalComponents >= MAX_COMPONENTS) {
      break;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n✓ Done!`);
  console.log(`  ${totalComponents} unique components extracted`);
  console.log(`  ${totalInstances} component instances recorded`);
}

run().catch(console.error);
