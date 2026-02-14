---
title: "API Reference"
category: "Development"
order: 2
---

# API Reference

## SiteAdapter Class

The base class that all site adapters extend.

### Constructor

```javascript
constructor(siteConfig = {})
```

**Parameters:**
- `siteConfig` (Object): Configuration object
  - `name` (string): Display name of the site
  - `domains` (array): Array of supported domains

### Methods

#### getChapterListSelectors()

Returns an array of CSS selectors to find chapter links.

```javascript
getChapterListSelectors() {
    return ['div.chapters a', 'ul.chapter-list li a'];
}
```

#### getTitleSelectors()

Returns an array of CSS selectors to find the series title.

```javascript
getTitleSelectors() {
    return ['h1.manga-title', 'div.title h1'];
}
```

#### getImageSelectors()

Returns an array of CSS selectors to find chapter images.

```javascript
getImageSelectors() {
    return ['div.reader img', '#chapter-images img'];
}
```

#### isChapterUrl(url)

Determines if a URL is a chapter page.

```javascript
isChapterUrl(url) {
    return /site\.com\/chapter\//.test(url);
}
```

#### extractChapterInfo(url)

Extracts chapter information from a URL.

```javascript
async extractChapterInfo(url) {
    // Return chapter info object
    return {
        chapterNumber: 1,
        chapterName: 'Chapter 1'
    };
}
```

## ContentAdapter Methods

Methods specific to content script adapters.

### scanPage()

Scans the current page for chapters.

```javascript
scanPage() {
    const chapters = [];
    // Find and return chapters
    return chapters;
}
```

### getSeriesTitle()

Extracts the series title from the page.

```javascript
getSeriesTitle() {
    // Return series title string
    return 'Series Title';
}
```

## Full Adapter Methods

Methods for adapters that handle downloads (used in background.js).

### downloadChapter(chapterData, seriesTitle, updateStatus, options)

Downloads a single chapter.

**Parameters:**
- `chapterData` (Object): Chapter information
- `seriesTitle` (string): Title of the series
- `updateStatus` (function): Callback to update status
- `options` (Object): Download options

```javascript
async downloadChapter(chapterData, seriesTitle, updateStatus, options = {}) {
    updateStatus({
        chapterId: chapterData.url,
        status: 'fetching',
        message: 'Downloading images...'
    });
    
    // Download logic here
}
```

## SiteRegistry

Registry for managing site adapters.

### Methods

#### initialize()

Initializes the registry with all available adapters.

```javascript
siteRegistry.initialize();
```

#### isSupported(url)

Checks if a URL is supported by any adapter.

```javascript
const supported = siteRegistry.isSupported('https://example.com/manga/123');
```

#### findAdapterForUrl(url)

Finds the appropriate adapter for a URL.

```javascript
const adapter = siteRegistry.findAdapterForUrl(url);
```