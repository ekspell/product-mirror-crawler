require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('verbatim');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000,
  maxRetries: 2,
});

async function categorizeBatch(routes, batchNum, totalBatches) {
  console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${routes.length} routes)...`);

  const screenList = routes.map(r => `${r.id} | "${r.name}" | ${r.path}`).join('\n');

  const systemPrompt = `You are a senior product designer organizing Calendly app screens into meaningful user flows.

Group screens by USER INTENT and TASKS, not URL structure.

Good flow names describe user goals:
- "Creating an event type"
- "Managing availability"
- "Inviting team members"
- "First-time setup"
- "Viewing scheduled meetings"

Rules:
- Each flow should be a coherent user journey
- Name flows as actions/tasks when possible
- A screen can only belong to one flow
- Group related screens even if URLs are different
- EVERY screen must be categorized

Return ONLY valid JSON with no markdown, no code blocks, no explanation.

CRITICAL: Use the exact UUIDs (first column) as keys.

Format: { "uuid-here": "flow_name", "another-uuid": "flow_name", ... }

You MUST include ALL ${routes.length} screens in your response.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Categorize these ${routes.length} Calendly screens. Each line starts with the UUID:\n\n${screenList}`
      }]
    });

    const responseText = message.content[0].text;

    // Parse JSON
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```')) {
      const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) jsonText = jsonMatch[1];
    }

    const categorization = JSON.parse(jsonText);

    // Normalize keys
    const normalized = {};
    for (const [key, value] of Object.entries(categorization)) {
      normalized[key.trim().toLowerCase()] = value;
    }

    console.log(`  ✓ Received ${Object.keys(normalized).length}/${routes.length} categorizations`);
    return normalized;
  } catch (error) {
    console.error(`  ✗ Error in batch ${batchNum}:`, error.message);
    return null;
  }
}

async function run() {
  // Get Calendly product
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('name', 'Calendly')
    .single();

  if (!product) {
    console.log('Calendly product not found');
    return;
  }

  // Fetch all routes
  const { data: routes, error } = await supabase
    .from('routes')
    .select('id, name, path')
    .eq('product_id', product.id);

  if (error || !routes || routes.length === 0) {
    console.log('No routes found:', error?.message);
    return;
  }

  console.log(`Found ${routes.length} Calendly screens.`);

  // Process in batches of 50
  const BATCH_SIZE = 50;
  const batches = [];
  for (let i = 0; i < routes.length; i += BATCH_SIZE) {
    batches.push(routes.slice(i, i + BATCH_SIZE));
  }

  console.log(`Processing in ${batches.length} batches of ~${BATCH_SIZE} routes each...\n`);

  // Categorize all batches
  const allCategorizations = {};
  for (let i = 0; i < batches.length; i++) {
    const result = await categorizeBatch(batches[i], i + 1, batches.length);
    if (result) {
      Object.assign(allCategorizations, result);
    }
    // Small delay between batches
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✓ Total categorizations received: ${Object.keys(allCategorizations).length}/${routes.length}`);

  // Build lookups
  const routeById = new Map(routes.map(r => [r.id.toLowerCase(), r]));
  const routeByIdOriginal = new Map(routes.map(r => [r.id.toLowerCase(), r.id]));

  // Show categorization summary
  const flowGroups = {};
  for (const [routeId, flowName] of Object.entries(allCategorizations)) {
    if (!flowGroups[flowName]) flowGroups[flowName] = [];
    const route = routeById.get(routeId);
    flowGroups[flowName].push(route ? route.name : routeId);
  }

  console.log('\nAI Categorization Summary:\n');
  for (const [flowName, screens] of Object.entries(flowGroups)) {
    console.log(`  ${flowName} (${screens.length} screens)`);
  }

  // Update database
  console.log('\nUpdating database...\n');
  let updated = 0;
  let notFound = 0;

  for (const [routeId, flowName] of Object.entries(allCategorizations)) {
    if (!routeById.has(routeId)) {
      notFound++;
      continue;
    }

    const originalId = routeByIdOriginal.get(routeId);
    const { error: updateError } = await supabase
      .from('routes')
      .update({ flow_name: flowName })
      .eq('id', originalId);

    if (!updateError) {
      updated++;
    }
  }

  // Check for missed routes
  const categorizedIds = new Set(Object.keys(allCategorizations));
  const missed = routes.filter(r => !categorizedIds.has(r.id.toLowerCase()));

  if (missed.length > 0) {
    console.log(`\n⚠ ${missed.length} routes were not categorized:`);
    for (const r of missed.slice(0, 5)) {
      console.log(`  - "${r.name}" | ${r.path}`);
    }
    if (missed.length > 5) {
      console.log(`  ... and ${missed.length - 5} more`);
    }
  }

  console.log(`\n✓ Done! Updated ${updated}/${routes.length} routes.`);

  if (updated === routes.length) {
    console.log('🎉 All routes successfully categorized!');
  }
}

run().catch(console.error);
