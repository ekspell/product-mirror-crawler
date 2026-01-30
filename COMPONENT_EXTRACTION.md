# AI-Powered Component Extraction

This feature uses Claude's vision API to automatically identify and extract UI components from screenshots.

## Setup

### 1. Install Dependencies

```bash
cd ~/Projects/product-mirror-crawler
npm install sharp
```

### 2. Run Database Migration

Open Supabase SQL Editor and run:
```bash
~/Projects/product-mirror-web/migrations/create_components_tables.sql
```

This creates:
- `components` table - stores unique components
- `component_instances` table - tracks where each component appears
- `component_stats` view - aggregates instance counts

### 3. Run Component Extraction

```bash
node extract-components.js
```

The script will:
1. Fetch screenshots from the database
2. Send each to Claude Vision API for analysis
3. Identify UI components (buttons, inputs, navigation, etc.)
4. Crop each component using bounding box coordinates
5. Upload cropped images to Supabase storage
6. Store component data and instances in the database

## How It Works

### Component Types Detected
- Buttons (Primary, Secondary, Text/Link)
- Form inputs (Text, Select, Checkbox, Radio, Toggle)
- Navigation (Nav bars, Sidebars)
- Cards
- Modals/Dialogs
- Tables
- Avatars
- Badges
- Search bars
- Date pickers
- Icon buttons

### Deduplication
Components with the same name are grouped together. For example:
- "Primary Button" found on 3 screens = 1 component, 3 instances

### Rate Limiting
- 2 second delay between API calls to avoid rate limits
- Processes 10 screens at a time (configurable in script)

## Viewing Components

After extraction, go to the Components tab in the dashboard to see:
- All extracted components sorted by instance count
- Component name (AI-generated)
- Cropped component image
- Instance count and screen count
- Click to view all screens where it appears (coming soon)

## Costs

Using Claude Vision API costs approximately:
- ~$0.01-0.02 per screenshot analyzed
- 100 screenshots ≈ $1-2

## Troubleshooting

**No components found:**
- Check that screenshots exist in database
- Verify ANTHROPIC_API_KEY in .env
- Check console for API errors

**Upload errors:**
- Verify Supabase storage bucket exists
- Check storage permissions
- Ensure screenshots bucket is public

**Database errors:**
- Run the migration SQL
- Check table exists: `SELECT * FROM components LIMIT 1;`
