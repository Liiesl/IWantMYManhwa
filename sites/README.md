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

### Step 4: Update manifest.json

Add host permissions:

```json
"host_permissions": [
    "*://*.webtoonscan.com/*",
    "*://*.yoursite.com/*"
]
```

### Step 5: Build

```bash
node build.js
```

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
