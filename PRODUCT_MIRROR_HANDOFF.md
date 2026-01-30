# Product Mirror - Developer Log & Handoff Document
## Date: January 28, 2026

---

## PROJECT OVERVIEW

**Product Mirror** is a SaaS monitoring tool that automatically captures screenshots of web applications, detects visual changes, and organizes screens into flows. Think of it as "Mobbin for your own product" — a design team can see every screen and state in their live product without manually documenting it.

**Primary Use Case:** A senior product designer joins a new company and wants to familiarize themselves with all the screens and flows in the product. Product Mirror auto-discovers and catalogs everything.

---

## TECH STACK

- **Frontend:** Next.js (app router), React, Tailwind CSS, Lucide React icons
- **Backend/Database:** Supabase (PostgreSQL + Storage)
- **Crawler:** Node.js + Playwright
- **Comparison:** pixelmatch + pngjs for change detection

---

## REPOSITORIES

### 1. product-mirror-web
- **Location:** `~/Projects/product-mirror-web`
- **GitHub:** https://github.com/ekspell/product-mirror-web
- **Purpose:** Dashboard UI for viewing captured screens

### 2. product-mirror-crawler
- **Location:** `~/Projects/product-mirror-crawler`
- **GitHub:** https://github.com/ekspell/product-mirror-crawler
- **Purpose:** Playwright scripts that capture screenshots

---

## DATABASE SCHEMA (Supabase)

**Project URL:** https://adyuxgzpbbpgkrvyfulv.supabase.co

### Tables:

**teams**
- id (uuid, primary key)
- name (text)

**products**
- id (uuid, primary key)
- name (text) — e.g., "Calendly"
- staging_url (text) — e.g., "https://calendly.com"
- team_id (uuid, foreign key → teams)
- created_at (timestamp)

**routes**
- id (uuid, primary key)
- name (text) — screen name
- path (text) — URL path like "/app/home"
- product_id (uuid, foreign key → products)
- flow_name (text) — category like "Admin", "Settings", "Workflows"
- created_at (timestamp)

**captures**
- id (uuid, primary key)
- route_id (uuid, foreign key → routes)
- screenshot_url (text) — Supabase storage URL
- captured_at (timestamp)
- has_changes (boolean)
- diff_percentage (float)
- change_summary (text)

### Storage:
- Bucket: `screenshots` (public access enabled)

---

## KEY FILES

### product-mirror-web

```
app/
├── layout.tsx          — Main layout with sidebar
├── page.tsx            — Home page, fetches routes from Supabase
├── supabase.ts         — Supabase client config
├── api/
│   └── sweep/
│       └── route.ts    — API endpoint to trigger crawler
└── components/
    ├── Sidebar.tsx     — Left navigation
    ├── DashboardTabs.tsx — Tabs for Changes/Flows/Components views
    └── RunSweepButton.tsx — Button that triggers sweep API
```

### product-mirror-crawler

```
├── .env                — Credentials (SUPABASE_URL, SUPABASE_KEY, CALENDLY_EMAIL, CALENDLY_PASSWORD)
├── discover.js         — AUTO-DISCOVERY CRAWLER (the smart one!)
├── calendly-test.js    — Manual Calendly crawler with login
├── publix-test.js      — Public site crawler (no auth needed)
└── test.js             — Original Todoist crawler
```

---

## CURRENT STATE

### What's Working:
1. ✅ **Link Discovery Crawler** — Automatically finds all screens in an app
2. ✅ **Auto Flow Categorization** — Groups screens by URL pattern (Admin, Settings, etc.)
3. ✅ **Change Detection** — Compares screenshots, detects pixel differences
4. ✅ **Dashboard UI** — Shows all captured screens organized by flow
5. ✅ **Run Sweep Button** — Triggers crawler from UI (currently runs publix-test.js)
6. ✅ **83 Calendly screens captured** — Full app discovery completed

### What's NOT Working:
1. ❌ **Auto-login for Calendly** — Two-step login flow fails, requires manual login
2. ❌ **Smart page naming** — Currently uses ugly URL-based names like "New?TemplateId=1"
3. ❌ **Duplicate detection** — Captures 20 similar workflow template pages
4. ❌ **Flow mapping** — Doesn't track navigation paths (A → B → C)

---

## TEST DATA

**Current Product:** Calendly
- 83 screens discovered and captured
- Flows: Admin, Settings, Workflows, Routing, Scheduling, Availability, Dashboard, Other

**Credentials in .env:**
```
CALENDLY_EMAIL=drake.christensen@me.com
CALENDLY_PASSWORD=[stored in .env file]
SUPABASE_URL=https://adyuxgzpbbpgkrvyfulv.supabase.co
SUPABASE_KEY=sb_publishable_q-nOmZsPhs45SoBOi3t9eQ_1gsBu-h9
```

---

## HOW TO RUN

### Start the web app:
```bash
cd ~/Projects/product-mirror-web
npm run dev
# Open http://localhost:3000
```

### Run the discovery crawler:
```bash
cd ~/Projects/product-mirror-crawler
node discover.js
# Log in manually when browser opens
# Press Enter in terminal when logged in
# Crawler auto-discovers all screens
```

---

## UI COMPONENTS DETAIL

### Sidebar (Sidebar.tsx)
- Product_Mirror logo
- Nav items: Home, Changes (badge), Flows, Screens, Components
- Bottom: Notifications, Settings, Support
- User profile (placeholder: Olivia Rhye)

### Dashboard Tabs (DashboardTabs.tsx)
- **Changes tab:** 2-column grid of screenshot cards with change badges
- **Flows tab:** Left sidebar with collapsible flow tree + horizontal screenshot rows
- **Components tab:** Placeholder UI component cards

### Badge Styling
- Black fill (#000000) at 40% opacity
- 8px corner radius (rounded-lg in Tailwind)
- Green dot for change indicator
- Shows change summary + time on left badge
- Shows flow name on right badge

---

## NEXT STEPS (Priority Order)

### 1. Smart Page Naming
**Problem:** Pages named "Me", "New?TemplateId=3", etc.
**Solution:** Use `await page.title()` to grab the actual page title from the browser tab
**File to modify:** `discover.js`

### 2. Skip Duplicate Query Params
**Problem:** Captures 20 nearly identical workflow template pages
**Solution:** Before visiting a URL, strip query params and check if base path already visited
**File to modify:** `discover.js`

### 3. Flow Mapping (Navigation Tracking)
**Problem:** Flows are just URL-pattern groupings, not actual user journeys
**Solution:** 
- Track `{source: "/app/admin", destination: "/app/admin/users"}` when discovering links
- New database table: `page_connections` with source_route_id, destination_route_id
- Build tree from connections
**Files to modify:** `discover.js`, Supabase schema, `DashboardTabs.tsx`

### 4. AI Flow Naming
**Problem:** Flow names like "Admin" are generic
**Solution:** Send screenshots or page titles to LLM, ask it to suggest flow names like "User Management", "Billing Settings"
**New capability needed:** LLM API integration

### 5. Fix Auto-Login
**Problem:** Calendly two-step login (email → continue → password → login) times out
**Solution:** 
- Use more robust selectors (`getByRole`, `getByLabel`)
- Add proper waits between steps
- Handle 2FA prompt if needed
**File to modify:** `calendly-test.js` or create generic login handler

### 6. Update "Run Sweep" Button
**Problem:** Currently hardcoded to run publix-test.js
**Solution:** Make it run `discover.js` for the selected product
**File to modify:** `app/api/sweep/route.ts`

### 7. Real-time Stats
**Problem:** "Last sweep: 2 hours ago" and "114 detected" are hardcoded
**Solution:** Query database for actual last capture time and change count
**File to modify:** `app/page.tsx`

---

## DESIGN REFERENCES

- Badge style: Black/40 opacity, 8px radius, green dot indicator
- Layout: Mobbin-style with left sidebar, tabs, card grid
- Light theme: gray-50 backgrounds, gray-900 text
- Font: Inter (Google Fonts)

---

## DEVELOPER NOTES

### Kate's Preferences:
- Prefers clear, step-by-step instructions
- New to coding beyond basic implementation
- Learning VS Code shortcuts (Cmd+F, Cmd+S, Cmd+Shift+K)
- Copy-paste from chat often gets corrupted — download files or make small targeted edits instead
- Planning to transition to Claude Code for smoother workflow

### Common Issues:
1. **Copy-paste truncation** — Large code blocks get cut off. Use file downloads or small edits.
2. **Terminal heredoc mode** — If you see `heredoc>`, press Ctrl+C and try a different approach
3. **Port conflicts** — If localhost:3000 is busy, kill the process or use a different port
4. **Supabase query errors** — Check that `flow_name` column exists, check table relationships

---

## SESSION HISTORY

### Phase 1-3 (Previous sessions):
- Built basic crawler for Todoist
- Set up Supabase database
- Created initial dashboard

### Phase 3.5 (Jan 28):
- UI refactor with sidebar, header, tabs
- Added Lucide icons, Inter font
- Implemented Flows view with collapsible tree

### Phase 4 (Jan 28):
- Added change detection with pixelmatch
- Store has_changes, diff_percentage, change_summary in captures table
- Display real change badges in UI

### Phase 4.5 (Jan 28 evening):
- Removed Publix, added Calendly as test product
- Built link discovery crawler (discover.js)
- Auto-discovered 83 Calendly screens
- Discussed flow mapping architecture for tomorrow

---

## QUICK REFERENCE COMMANDS

```bash
# Start web app
cd ~/Projects/product-mirror-web && npm run dev

# Run discovery crawler
cd ~/Projects/product-mirror-crawler && node discover.js

# Check what's in database
# Go to Supabase SQL Editor and run:
SELECT * FROM products;
SELECT * FROM routes WHERE product_id = (SELECT id FROM products WHERE name = 'Calendly');
SELECT COUNT(*) FROM captures;

# Git save
cd ~/Projects/product-mirror-web && git add . && git commit -m "message" && git push
cd ~/Projects/product-mirror-crawler && git add . && git commit -m "message" && git push
```

---

## END OF HANDOFF DOCUMENT
