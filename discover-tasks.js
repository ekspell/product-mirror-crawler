#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Initialize Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function discoverTasks(productId) {
  console.log(`\nDiscovering tasks for product: ${productId}\n`);

  // Fetch product details
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();

  if (productError || !product) {
    console.error('Error fetching product:', productError);
    process.exit(1);
  }

  console.log(`Product: ${product.name}`);
  console.log(`URL: ${product.staging_url}`);
  console.log(`Auth state: ${product.auth_state}\n`);

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // Navigate to product URL
    console.log('Navigating to product URL...');
    await page.goto(product.staging_url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Handle authentication if needed
    if (product.auth_state === 'authenticated') {
      console.log('Attempting to log in...');

      // Wait for login form
      await page.waitForTimeout(2000);

      // Generic login detection
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[id*="email"]',
        'input[placeholder*="email" i]',
        'input[autocomplete="email"]'
      ];

      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id*="password"]'
      ];

      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Sign in")',
        'input[type="submit"]'
      ];

      let emailInput = null;
      for (const selector of emailSelectors) {
        emailInput = await page.$(selector);
        if (emailInput) break;
      }

      let passwordInput = null;
      for (const selector of passwordSelectors) {
        passwordInput = await page.$(selector);
        if (passwordInput) break;
      }

      if (emailInput && passwordInput && product.login_email && product.login_password) {
        await emailInput.fill(product.login_email);
        await passwordInput.fill(product.login_password);

        let submitButton = null;
        for (const selector of submitSelectors) {
          submitButton = await page.$(selector);
          if (submitButton) break;
        }

        if (submitButton) {
          await submitButton.click();
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
          console.log('✓ Logged in successfully');
        }
      } else {
        console.log('⚠ Could not find login form elements');
      }
    } else {
      console.log('Product is public, skipping login');
    }

    // Wait for page to stabilize
    await page.waitForTimeout(3000);

    // Take screenshot of dashboard
    console.log('\nCapturing dashboard screenshot...');
    const screenshotPath = path.join(__dirname, 'temp-dashboard.png');
    await page.screenshot({
      path: screenshotPath,
      fullPage: false
    });
    console.log('✓ Screenshot captured');

    // Read screenshot as base64
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    // Send to Claude Vision API
    console.log('\nAnalyzing dashboard with Claude Vision API...');
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
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
              text: `You are analyzing a web application called "${product.name}". Based on this screenshot, what are the 5-8 main tasks a user can perform in this app?

Think about common user goals like:
- Creating something new
- Managing settings
- Inviting others
- Viewing reports
- Completing a transaction
- Scheduling or booking something
- Configuring preferences

Return JSON only in this exact format:
{
  "tasks": [
    {"name": "Task name", "description": "Brief description of what this task accomplishes"},
    {"name": "Another task", "description": "Another description"}
  ]
}

Important: Return ONLY the JSON, no other text.`
            }
          ]
        }
      ]
    });

    // Parse response
    const responseText = message.content[0].text;
    console.log('\nClaude Vision API response:');
    console.log(responseText);

    // Extract JSON from response
    let tasksData;
    try {
      // Try to parse directly
      tasksData = JSON.parse(responseText);
    } catch (e) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        tasksData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Could not parse JSON from response');
      }
    }

    if (!tasksData.tasks || !Array.isArray(tasksData.tasks)) {
      throw new Error('Invalid response format');
    }

    console.log(`\n✓ Discovered ${tasksData.tasks.length} tasks:\n`);
    tasksData.tasks.forEach((task, i) => {
      console.log(`${i + 1}. ${task.name}`);
      console.log(`   ${task.description}\n`);
    });

    // Save tasks to database
    console.log('Saving tasks to database...');
    for (const task of tasksData.tasks) {
      const { data: savedTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
          product_id: productId,
          name: task.name,
          description: task.description,
          status: 'pending'
        })
        .select()
        .single();

      if (taskError) {
        console.error(`Error saving task "${task.name}":`, taskError);
      } else {
        console.log(`✓ Saved task: ${task.name}`);
      }
    }

    // Clean up temp file
    fs.unlinkSync(screenshotPath);

    console.log('\n✓ Task discovery complete!\n');

  } catch (error) {
    console.error('\nError during task discovery:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Main execution
const productId = process.argv[2];

if (!productId) {
  console.error('Usage: node discover-tasks.js <product-id>');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY not found in environment variables');
  process.exit(1);
}

discoverTasks(productId)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
