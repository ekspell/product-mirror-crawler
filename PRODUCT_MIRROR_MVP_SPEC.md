# Product Mirror MVP — Human-Guided Recording

## Overview

This spec replaces the AI-powered crawling approach. Instead, users manually navigate their product while Product Mirror follows along, captures screenshots on each page change, and organizes everything by user-named flows.

**Think:** Guided screen recording with automatic organization. The user provides the intelligence. The tool captures and organizes.

**One-liner:** "Walk through your product once. We'll document it forever."

---

## Core Concept

User has two windows side by side:

1. **Product Mirror dashboard** — shows recording progress like a Notion doc being built
2. **Playwright browser** — where user navigates their actual product

As the user navigates, screenshots appear, flows get checked off, and a complete product map builds up in real time.

---

## User Flow (Step by Step)

### First Time User

1. User lands on Product Mirror → logs in via magic link (exists)
2. Empty state: "Add your first product"
3. User adds product: **name** and **URL** only (no credentials)
4. Product appears in sidebar
5. Big CTA: "Start Recording"

### Recording Session

1. User clicks **"Start Recording"**
2. Dashboard shifts to **recording mode** (shows flow checklist, progress)
3. **Playwright browser opens** in separate window to product URL
4. User manually **logs into their product** in the Playwright browser
5. User returns to dashboard, clicks a flow to start (e.g., "Login" or adds custom)
6. Flow shows **● recording** state
7. User navigates in Playwright browser
8. **Screenshots auto-capture** on navigation — dashboard shows count incrementing
9. User clicks **"Done with current flow"** in dashboard
10. Flow shows **✓ completed** with screen count
11. User clicks next flow from checklist or **"+ Add flow"** for custom
12. Repeat steps 6-11 for all desired flows
13. User clicks **"End Recording"**
14. Playwright browser closes
15. Dashboard shows completed flows with screenshots

### Post-Recording

1. User can browse flows in Flows tab
2. Each flow = horizontal row of screenshots (like Mobbin)
3. Click screenshot → detail modal
4. Copy to Figma works

---

## Dashboard Recording Mode UI

When recording is active, the dashboard transforms:

```
┌──────────────────────────────────────────────────────────────┐
│ Product Mirror                           [End Recording]     │
├────────────────┬─────────────────────────────────────────────┤
│                │                                             │
│ ▼ Calendly     │  Recording Session                         │
│                │  Started 5 minutes ago                      │
│                │                                             │
│                │  ─────────────────────────────────────────  │
│                │                                             │
│                │  Your Flows                                 │
│                │                                             │
│                │  ✓ Login                        3 screens   │
│                │  ✓ Dashboard                    1 screen    │
│                │  ● Schedule a meeting           4 screens   │  ← active
│                │                                             │
│                │  ○ Settings                                 │  ← not started
│                │  ○ Billing                                  │
│                │  ○ Team                                     │
│                │  ○ Notifications                            │
│                │  ○ Help                                     │
│                │                                             │
│                │  [+ Add custom flow]                        │
│                │                                             │
│                │  ─────────────────────────────────────────  │
│                │                                             │
│                │  [Done with current flow]                   │
│                │                                             │
└────────────────┴─────────────────────────────────────────────┘
```

### Flow States

| State | Icon | Meaning |
|-------|------|---------|
| Not started | ○ | In checklist, user hasn't recorded yet |
| Recording | ● | Currently capturing this flow |
| Completed | ✓ | User clicked "Done", shows screen count |

### Interactions

- **Click unchecked flow** → Starts recording that flow (if no flow active) or prompts "finish current flow first?"
- **Click "Done with current flow"** → Marks flow complete, returns to "pick next" state
- **Click "+ Add custom flow"** → Inline text input for flow name, then starts recording
- **Click "End Recording"** → Confirms, closes Playwright, returns to normal dashboard

---

## Default Flow Checklist

Pre-populated for all products (user can ignore or delete):

1. Login / Sign up
2. Dashboard / Home
3. Settings / Account
4. Billing
5. Team / Users
6. Notifications
7. Help / Support

User can add unlimited custom flows via "+ Add custom flow"

---

## Technical Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│    Dashboard    │  HTTP   │    Node.js      │         │    Supabase     │
│    (Next.js)    │ ←─────→ │    Backend      │ ←─────→ │    Database     │
│    Port 3000    │  API    │    (crawler)    │         │    + Storage    │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                    │
                                    │ Controls
                                    ↓
                            ┌─────────────────┐
                            │   Playwright    │
                            │    Browser      │
                            └─────────────────┘
```

### Communication Flow

1. **Dashboard → Backend:** "Start recording for product X"
2. **Backend:** Launches Playwright browser, creates recording session in DB
3. **Backend:** Watches for navigation events in Playwright
4. **Backend:** On navigation → captures screenshot → saves to Supabase → updates session state
5. **Dashboard → Backend:** Polls `/api/recording/status` every 1-2 seconds
6. **Backend → Dashboard:** Returns current flow, screen count, flow list
7. **Dashboard:** Updates UI with latest state

### API Endpoints (Backend)

```
POST /api/recording/start
  Body: { productId }
  Response: { sessionId, success }
  Action: Launch Playwright, create session

POST /api/recording/flow/start
  Body: { sessionId, flowName }
  Response: { flowId, success }
  Action: Create flow record, set as active

POST /api/recording/flow/end
  Body: { sessionId, flowId }
  Response: { success, screenCount }
  Action: Mark flow complete

GET /api/recording/status
  Query: { sessionId }
  Response: { 
    status: 'recording' | 'idle',
    activeFlow: { id, name, screenCount } | null,
    flows: [{ id, name, screenCount, status }],
    totalScreens
  }

POST /api/recording/end
  Body: { sessionId }
  Response: { success }
  Action: Close Playwright, mark session complete
```

---

## Navigation Detection (Screenshot Triggers)

Since SPAs don't always trigger page loads, we need multiple detection strategies:

### 1. URL Change Detection

```javascript
let lastUrl = page.url();

setInterval(async () => {
  const currentUrl = page.url();
  if (currentUrl !== lastUrl) {
    await captureScreenshot();
    lastUrl = currentUrl;
  }
}, 500); // Check every 500ms
```

### 2. Click + Settle Detection

```javascript
page.on('click', async () => {
  // Wait for network to settle and animations to complete
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500); // Extra buffer for animations
  
  // Check if content changed significantly
  if (await contentChangedSignificantly()) {
    await captureScreenshot();
  }
});
```

### 3. Content Change Detection (Simple)

Compare screenshots or check for major DOM changes:

```javascript
async function contentChangedSignificantly() {
  // Option A: Compare current screenshot to last one (pixel diff)
  // Option B: Check if main content container innerHTML changed
  // Option C: Check document.body scroll height changed significantly
  
  // Start simple: just check URL + wait after clicks
  return true; // For MVP, capture after every click that settles
}
```

### MVP Approach (Keep It Simple)

For MVP, use this logic:

1. **URL changed** → screenshot
2. **Click on link/button** → wait 1 second → screenshot
3. **Debounce** → don't screenshot more than once per 2 seconds

This will occasionally capture duplicate screens (user can delete later) but won't miss anything. Better to over-capture than under-capture.

### Screenshot Capture Function

```javascript
async function captureScreenshot(sessionId, flowId, stepNumber) {
  const screenshot = await page.screenshot({ fullPage: true });
  const url = page.url();
  const title = await page.title();
  
  // Generate filename
  const filename = `${sessionId}/${flowId}/${stepNumber}.png`;
  
  // Upload to Supabase storage
  const { data, error } = await supabase.storage
    .from('screenshots')
    .upload(filename, screenshot);
  
  // Get public URL
  const publicUrl = supabase.storage
    .from('screenshots')
    .getPublicUrl(filename).data.publicUrl;
  
  // Save to routes table
  await supabase.from('routes').insert({
    product_id: productId,
    flow_id: flowId,
    session_id: sessionId,
    path: new URL(url).pathname,
    name: title || 'Untitled',
    step_number: stepNumber
  });
  
  // Save capture record
  await supabase.from('captures').insert({
    route_id: routeId,
    screenshot_url: publicUrl,
    captured_at: new Date()
  });
}
```

---

## Database Schema

### New Tables

```sql
-- Recording sessions
CREATE TABLE recording_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT now(),
  ended_at TIMESTAMP,
  status TEXT DEFAULT 'in_progress' -- in_progress, completed, cancelled
);

-- Flows (user-defined journeys)
CREATE TABLE flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  session_id uuid REFERENCES recording_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, recording, completed
  step_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  completed_at TIMESTAMP
);

-- Default flow templates (optional, could just be hardcoded)
CREATE TABLE flow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Seed default templates
INSERT INTO flow_templates (name, sort_order) VALUES
  ('Login / Sign up', 1),
  ('Dashboard / Home', 2),
  ('Settings / Account', 3),
  ('Billing', 4),
  ('Team / Users', 5),
  ('Notifications', 6),
  ('Help / Support', 7);
```

### Modify Existing Tables

```sql
-- Add flow and session references to routes
ALTER TABLE routes ADD COLUMN flow_id uuid REFERENCES flows(id) ON DELETE SET NULL;
ALTER TABLE routes ADD COLUMN session_id uuid REFERENCES recording_sessions(id) ON DELETE SET NULL;
ALTER TABLE routes ADD COLUMN step_number INTEGER;

-- Remove credential columns from products (or just ignore them)
-- For clean slate:
ALTER TABLE products DROP COLUMN IF EXISTS login_email;
ALTER TABLE products DROP COLUMN IF EXISTS login_password;
ALTER TABLE products DROP COLUMN IF EXISTS auth_state;
```

---

## File Structure

### Crawler (product-mirror-crawler)

```
product-mirror-crawler/
├── server.js                 # Express server for API endpoints
├── recording/
│   ├── session.js            # Session management (start, end, status)
│   ├── browser.js            # Playwright browser control
│   ├── screenshot.js         # Screenshot capture and upload
│   └── navigation.js         # Navigation detection logic
├── .env                      # SUPABASE_URL, SUPABASE_KEY
└── package.json
```

### Web (product-mirror-web)

```
product-mirror-web/
├── app/
│   ├── page.tsx              # Main dashboard (modify for recording mode)
│   ├── api/
│   │   └── recording/        # API routes that proxy to crawler backend
│   │       ├── start/route.ts
│   │       ├── status/route.ts
│   │       ├── flow/route.ts
│   │       └── end/route.ts
│   └── components/
│       ├── RecordingMode.tsx     # Recording mode UI
│       ├── FlowChecklist.tsx     # Flow list with checkboxes
│       ├── FlowItem.tsx          # Individual flow item
│       ├── AddFlowInput.tsx      # Custom flow name input
│       └── AddProductForm.tsx    # Simplified (name + URL only)
├── migrations/
│   └── 005_recording_sessions.sql
└── package.json
```

---

## Component Specifications

### RecordingMode.tsx

Main container for recording UI. Shows when `recording_session.status === 'in_progress'`.

**Props:**
- `sessionId: string`
- `productName: string`

**State:**
- `flows: Flow[]` — fetched from API
- `activeFlowId: string | null`
- `isPolling: boolean`

**Behavior:**
- Polls `/api/recording/status` every 1.5 seconds
- Updates flow list and screen counts
- Shows "Done with current flow" button when flow is active

### FlowChecklist.tsx

Displays list of flows (default + custom).

**Props:**
- `flows: Flow[]`
- `activeFlowId: string | null`
- `onStartFlow: (flowId: string) => void`
- `onAddCustomFlow: (name: string) => void`

**Behavior:**
- Shows different icons based on flow status
- Click on pending flow → calls `onStartFlow`
- Click on "+ Add custom flow" → shows inline input

### FlowItem.tsx

Single flow row.

**Props:**
- `flow: Flow`
- `isActive: boolean`
- `onClick: () => void`

**Display:**
- `○` + name (pending)
- `●` + name + "X screens" (recording)
- `✓` + name + "X screens" (completed)

### AddProductForm.tsx (Simplified)

**Fields:**
- Product name (text input, required)
- Product URL (text input, required, validate URL format)

**Removed:**
- Email field
- Password field
- Auth state toggle

---

## Edge Cases & Error Handling

### Recording Session

| Scenario | Handling |
|----------|----------|
| User closes Playwright browser manually | Detect browser disconnect, prompt "Resume or end session?" |
| User closes dashboard during recording | Session stays in_progress, can resume on return |
| User clicks "End Recording" with active flow | Prompt "You have an unfinished flow. End anyway?" |
| Playwright crashes | Show error, offer "Restart recording" |
| Network error during screenshot upload | Retry 3x, then skip and log error |

### Navigation Detection

| Scenario | Handling |
|----------|----------|
| User navigates very fast (multiple pages in 2 sec) | Debounce, capture final state |
| Page has infinite scroll | Only screenshot on URL change or explicit click |
| Modal opens (no URL change) | Capture on click-settle (may miss some, acceptable for MVP) |
| Login redirect loop | Detect same URL repeated, don't capture duplicates |

### Dashboard

| Scenario | Handling |
|----------|----------|
| Polling fails | Show subtle error indicator, keep retrying |
| Session not found | Redirect to normal dashboard, show "Session ended" |
| No flows recorded | Show "No flows recorded" in flows tab |

---

## What We Are NOT Building (Explicit)

Do not implement any of the following for this MVP:

- ❌ AI-powered crawling or navigation
- ❌ AI flow suggestions
- ❌ Stored credentials / auto-login
- ❌ Auto-replay of recorded sessions
- ❌ Change detection / comparison mode
- ❌ Component extraction
- ❌ Sitemap visualization
- ❌ Search functionality
- ❌ Electron/native app
- ❌ Injected panel (using dashboard instead)
- ❌ WebSocket real-time updates (polling is fine)

---

## Definition of Done

MVP is complete when:

- [ ] Add Product form has only name + URL fields
- [ ] "Start Recording" button appears for products
- [ ] Clicking "Start Recording" launches Playwright browser to product URL
- [ ] Dashboard shows recording mode with flow checklist
- [ ] Default flows appear in checklist (7 items)
- [ ] User can click a flow to start recording it
- [ ] Active flow shows ● indicator and screen count
- [ ] Screenshots auto-capture on URL change
- [ ] Screenshots auto-capture on click + settle
- [ ] Screen count increments in real-time (within 2 sec)
- [ ] User can click "Done with current flow"
- [ ] Completed flows show ✓ and final screen count
- [ ] User can add custom flow name
- [ ] User can click "End Recording"
- [ ] Playwright browser closes on end
- [ ] Dashboard returns to normal mode
- [ ] Flows tab shows recorded flows
- [ ] Each flow displays as horizontal row of screenshots
- [ ] Clicking screenshot opens detail modal
- [ ] Copy to Figma works from detail modal

---

## Testing Checklist

Test with these products:

1. **Calendly** (SPA, auth required) — your test account
2. **A public site** (e.g., Stripe docs) — no auth needed
3. **A simple site** (e.g., Hacker News) — traditional page loads

For each, verify:

- [ ] Browser opens to correct URL
- [ ] Screenshots capture on navigation
- [ ] No duplicate screenshots for same page
- [ ] Flow organization is correct
- [ ] All screenshots appear in dashboard
- [ ] Copy to Figma works

---

## Suggested Build Order

### Day 1: Foundation
1. Database migrations (recording_sessions, flows, route modifications)
2. Simplify AddProductForm (remove credential fields)
3. Basic API endpoints (start, end, status)

### Day 2: Playwright Integration
4. Playwright browser launch on "Start Recording"
5. Navigation detection (URL change)
6. Screenshot capture and upload

### Day 3: Recording UI
7. Recording mode UI in dashboard
8. Flow checklist component
9. Start/end flow functionality

### Day 4: Polish & Connect
10. Polling for status updates
11. Screen count updates in real-time
12. Add custom flow functionality

### Day 5: Flows Display
13. Flows tab shows recorded flows
14. Horizontal screenshot layout
15. Detail modal integration

### Day 6: Edge Cases & Testing
16. Error handling
17. Browser disconnect handling
18. Test with multiple products

### Day 7: Buffer
19. Bug fixes
20. Final testing
21. Demo prep

---

## Questions for Claude Code

If anything is unclear, ask before building. Key areas that might need clarification:

1. Should screenshots be full page or viewport only?
2. What's the exact debounce timing for navigation detection?
3. How should we handle very long pages (multiple viewport screenshots)?
4. Should we store the page title/URL with each screenshot?

Default answers (if not asked):
1. Full page
2. 2 second debounce
3. Single full-page screenshot (scroll capture)
4. Yes, store both

---

## Success Metrics

After MVP launch, we'll know it's working if:

- User can complete a full recording session without errors
- Flows are correctly organized
- Screenshots are clear and complete
- Copy to Figma produces usable output
- Session takes ~10-15 min for a medium product (not hours)
