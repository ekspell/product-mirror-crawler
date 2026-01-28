# product-mirror-crawler
# Product Mirror Crawler

Automated screenshot capture for authenticated SaaS products.

## What it does

1. Opens a browser automatically
2. Logs into a SaaS app (currently Todoist)
3. Pulls routes from Supabase database
4. Visits each route and takes a screenshot
5. Uploads screenshots to Supabase Storage
6. Saves capture records to the database

## Setup

1. Install dependencies:
```
   npm install
```

2. Install Playwright browser:
```
   npx playwright install chromium
```

3. Create a `.env` file with:
```
   TODOIST_EMAIL=your_email
   TODOIST_PASSWORD=your_password
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_publishable_key
```

## Run
```
node test.js
```

A browser will open, log in, capture screenshots, and upload them automatically.