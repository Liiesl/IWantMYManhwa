# Development Guide

## Working with Adapters

The extension uses a **build system** to compile ContentAdapter files into `content.js`. This allows you to:
- Develop adapters in separate, organized files
- Get proper syntax highlighting and IDE support
- Compile them into a single file for the browser

## Project Structure

```
sites/
├── SiteAdapter.js              # Base adapter class
├── SiteRegistry.js             # Registry for managing adapters
├── webtoonscan/
│   ├── WebtoonscanAdapter.js         # Full adapter (scraping + download) - for background.js
│   └── WebtoonscanContentAdapter.js  # Scraping only - for content.js
└── ... (other sites)

content.js           # GENERATED FILE (don't edit directly)
build.js             # Build script
```

## Each Site Has Two Adapters

| File | Used By | Contains |
|------|---------|----------|
| `sites/webtoonscan/WebtoonscanAdapter.js` | background.js | Scraping + download |
| `sites/webtoonscan/WebtoonscanContentAdapter.js` | content.js | Scraping only |

## Development Workflow

### 1. Edit Adapter Files

For scraping changes (content.js): Edit `sites/webtoonscan/WebtoonscanContentAdapter.js`
For download changes (background.js): Edit `sites/webtoonscan/WebtoonscanAdapter.js`

### 2. Build

Run the build script to compile ContentAdapters into `content.js`:

```bash
node build.js
```

### 3. Load Extension

Load the extension in Chrome developer mode as usual.

### 4. Watch Mode (Optional)

For automatic rebuilding on file changes:

```bash
node build.js --watch
```

## Adding a New Site

### Step 1: Create Adapter Files

Create two files in `sites/yoursite/`:

**`sites/yoursite/YoursiteContentAdapter.js`** (for content.js - scraping only):
```javascript
class YoursiteContentAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'Yoursite',
            domains: ['yoursite.com'],
            ...siteConfig
        });
    }

    getChapterListSelectors() {
        return ['div.chapters a'];
    }

    getTitleSelectors() {
        return ['h1.title'];
    }

    getImageSelectors() {
        return ['div.reader img'];
    }

    isChapterUrl(url) {
        return /yoursite\.com\/chapter\//.test(url);
    }
}

// Make available globally
if (typeof window !== 'undefined') window.YoursiteContentAdapter = YoursiteContentAdapter;
if (typeof globalThis !== 'undefined') globalThis.YoursiteContentAdapter = YoursiteContentAdapter;
if (typeof self !== 'undefined') self.YoursiteContentAdapter = YoursiteContentAdapter;
```

**`sites/yoursite/YoursiteAdapter.js`** (for background.js - full with download):
```javascript
class YoursiteAdapter extends YoursiteContentAdapter {
    async downloadChapter(chapterData, seriesTitle, updateStatus, options = {}) {
        // Implement download logic
    }
}

// Make available globally
if (typeof window !== 'undefined') window.YoursiteAdapter = YoursiteAdapter;
if (typeof globalThis !== 'undefined') globalThis.YoursiteAdapter = YoursiteAdapter;
if (typeof self !== 'undefined') self.YoursiteAdapter = YoursiteAdapter;
```

### Step 2: Update build.js

Add your ContentAdapter to the `CONTENT_ADAPTER_FILES` array:

```javascript
const CONTENT_ADAPTER_FILES = [
    'webtoonscan/WebtoonscanContentAdapter.js',
    'yoursite/YoursiteContentAdapter.js'  // Add this
];
```

### Step 3: Update background.js

Add your adapter files to importScripts:

```javascript
importScripts(
    'sites/SiteAdapter.js',
    'sites/webtoonscan/WebtoonscanContentAdapter.js',
    'sites/webtoonscan/WebtoonscanAdapter.js',
    'sites/yoursite/YoursiteContentAdapter.js',
    'sites/yoursite/YoursiteAdapter.js',
    'sites/SiteRegistry.js'
);
```

### Step 4: Update manifest.json

Add host permissions for your site:

```json
"host_permissions": [
    "*://*.webtoonscan.com/*",
    "*://*.yoursite.com/*"
],
"content_scripts": [
    {
        "matches": [
            "*://*.webtoonscan.com/manhwa/*",
            "*://*.yoursite.com/manga/*"
        ],
        "js": ["content.js"]
    }
]
```

### Step 5: Build

```bash
node build.js
```

## Important Notes

- **Never edit `content.js` directly** - it's auto-generated
- Always run `node build.js` after modifying ContentAdapter files
- The build script combines ContentAdapter files into content.js
- Full adapters are loaded directly by background.js

## Troubleshooting

### "No adapter found" error
- Check that you ran `node build.js`
- Verify your ContentAdapter is in `CONTENT_ADAPTER_FILES` array
- Check browser console for build errors

### Changes not appearing
- Make sure you rebuilt with `node build.js`
- Reload the extension in Chrome
- Hard refresh the page (Ctrl+Shift+R)

### Build errors
- Ensure Node.js is installed: `node --version`
- Check that all files in `CONTENT_ADAPTER_FILES` exist
