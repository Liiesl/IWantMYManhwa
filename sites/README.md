# Adding New Site Support

This document explains how to add support for new manhwa/manga websites to IWantMYManhwa.

## Overview

Each site has **two adapter files**:

| File | Purpose | Used By |
|------|---------|---------|
| `sites/webtoonscan/WebtoonscanContentAdapter.js` | Scraping only (get chapters, images) | content.js |
| `sites/webtoonscan/WebtoonscanAdapter.js` | Full (scraping + download) | background.js |

The **ContentAdapter** is compiled into `content.js` by the build script.
The **full Adapter** is loaded directly by background.js.

## Quick Start: Adding a New Site

### Step 1: Create Adapter Files

Create a directory and files in `sites/`:

```
sites/yoursite/
├── YoursiteContentAdapter.js   # For content.js (scraping only)
└── YoursiteAdapter.js          # For background.js (full with download)
```

**ContentAdapter** (`sites/yoursite/YoursiteContentAdapter.js`):

```javascript
'use strict';

class YoursiteContentAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'Yoursite',
            domains: ['yoursite.com', 'www.yoursite.com'],
            ...siteConfig
        });
    }

    getChapterListSelectors() {
        return [
            'div.chapter-list a.chapter-item',
            'ul.chapters li a'
        ];
    }

    getTitleSelectors() {
        return ['h1.series-title', '.manga-title h1'];
    }

    getImageSelectors() {
        return ['div.reader-img img', '.page-image img'];
    }

    isChapterUrl(url) {
        return /yoursite\.com.*\/chapter\//i.test(url);
    }
}

// Make available globally
if (typeof window !== 'undefined') window.YoursiteContentAdapter = YoursiteContentAdapter;
if (typeof globalThis !== 'undefined') globalThis.YoursiteContentAdapter = YoursiteContentAdapter;
if (typeof self !== 'undefined') self.YoursiteContentAdapter = YoursiteContentAdapter;
```

**Full Adapter** (`sites/yoursite/YoursiteAdapter.js`):

```javascript
'use strict';

class YoursiteAdapter extends YoursiteContentAdapter {
    async downloadChapter(chapterData, seriesTitle, updateStatus, options = {}) {
        // Implement download logic specific to this site
        // This is called by background.js
    }
}

// Make available globally
if (typeof window !== 'undefined') window.YoursiteAdapter = YoursiteAdapter;
if (typeof globalThis !== 'undefined') globalThis.YoursiteAdapter = YoursiteAdapter;
if (typeof self !== 'undefined') self.YoursiteAdapter = YoursiteAdapter;
```

### Step 2: Update build.js

Add your ContentAdapter to the build:

```javascript
const CONTENT_ADAPTER_FILES = [
    'webtoonscan/WebtoonscanContentAdapter.js',
    'yoursite/YoursiteContentAdapter.js'  // Add this
];
```

### Step 3: Update background.js

Add importScripts for your adapters:

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

### Step 4: Update sidepanel.html

The side panel loads adapters via its own `<script>` tags for the
support check — without these the panel reports "site is not supported":

```html
<script src="sites/SiteAdapter.js"></script>
<script src="sites/yoursite/YoursiteContentAdapter.js"></script>
<script src="sites/yoursite/YoursiteAdapter.js"></script>
<script src="sites/SiteRegistry.js"></script>
<script src="sidepanel.js"></script>
```

### Step 5: Register in SiteRegistry.js

Add your adapter in `SiteRegistry.initialize()`:

```javascript
if (typeof YoursiteAdapter !== 'undefined') {
    this.register('yoursite', new YoursiteAdapter());
}
```

### Step 6: Update manifest.json

Add host permissions:

```json
"host_permissions": [
    "*://*.webtoonscan.com/*",
    "*://*.yoursite.com/*"
]
```

### Step 7: Build

```bash
node build.js
```

**Note:** `build.js` rewrites `host_permissions` and content-script
`matches` in `manifest.json` from adapter `domains` on every run, and
reloads the extension at `chrome://extensions/` afterwards — the
background service worker keeps the old adapters in memory until reloaded.

## Rotating domains & hotlink-protected CDNs

Some sites increment their domain periodically (e.g. Wfwf:
`wfwfNNN.com`) or serve images from a separate protected CDN. Chrome
match patterns cannot express mid-host wildcards, and fetch-level
`referrer` spoofing is ignored — see `sites/wfwf/README.md` for the
established pattern:

- Override `matchesUrl()` with a regex so support-checks work on any number.
- Keep `domains` explicit (current number only); `build.js` derives
  manifest entries from it.
- If the image CDN 403s without a site `Referer`, force it at the network
  layer with a `declarativeNetRequest` rule (generate the rules file in
  `build.js` from the adapter's `domains` so rotations stay a one-line change).

## Adapter Methods

### Required Methods (ContentAdapter)

- `getChapterListSelectors()` - CSS selectors for chapter links
- `getTitleSelectors()` - CSS selectors for title
- `getImageSelectors()` - CSS selectors for chapter images
- `isChapterUrl(url)` - Check if URL is a chapter page

### Optional Methods

- `isChapterListingPage(url)` - Check if URL is a listing page
- `isValidChapterLink(link, url)` - Validate chapter link
- `extractChapterNumberFromUrl(url)` - Extract chapter number
- `getChapters()` - Custom chapter extraction
- `getChapterImages()` - Custom image extraction
- `sortChapters(chapters)` - Custom sorting

### Download Method (Full Adapter only)

- `downloadChapter(chapterData, seriesTitle, updateStatus, options)` - Complete download flow

## Finding Selectors

1. Open the page in your browser
2. Open DevTools (F12)
3. Use Element Inspector to select elements
4. Copy CSS selectors from DevTools
5. Test in Console: `document.querySelectorAll('your-selector')`

## Testing

1. Load extension in Chrome (developer mode)
2. Navigate to the new site
3. Open extension side panel
4. Try scanning chapters
5. Verify download works
