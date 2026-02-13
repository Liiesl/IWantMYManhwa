// content.js (Multi-Site Support with Inline Adapters)
// Contains all adapter code inline to avoid scope issues in Manifest V3

'use strict';
console.log("IWantMYManhwa: Content script loaded on", window.location.href);

// ============ SITE ADAPTER BASE CLASS ============
class SiteAdapter {
    constructor(siteConfig = {}) {
        this.config = siteConfig;
        this.name = siteConfig.name || 'Unknown Site';
        this.domains = siteConfig.domains || [];
    }

    matchesUrl(url) {
        if (!url) return false;
        return this.domains.some(domain => {
            const pattern = new RegExp(`https?://[^/]*${domain.replace(/\./g, '\\.')}`, 'i');
            return pattern.test(url);
        });
    }

    getTitle() {
        const selectors = this.getTitleSelectors();
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent?.trim()) {
                return element.textContent.trim();
            }
        }
        const pageTitle = document.title;
        if (pageTitle) {
            const parts = pageTitle.split(/[-–—\|]/);
            return parts[0].trim();
        }
        return 'Unknown Title';
    }

    extractChapterNumber(url, name = '') {
        if (!url) return null;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            const lastSegment = pathSegments.pop();

            if (lastSegment) {
                const chapterMatch = lastSegment.match(/^chapter-([\d\.]+)/i);
                if (chapterMatch) return parseFloat(chapterMatch[1]);
                if (/^[\d\.]+$/.test(lastSegment)) return parseFloat(lastSegment);
            }
        } catch (e) {}

        if (name) {
            const nameMatch = name.match(/^[\d\.]+/);
            if (nameMatch) return parseFloat(nameMatch[0]);
        }

        return null;
    }

    getDownloadConfig() {
        return {
            maxConcurrentTabs: 3,
            tabLoadTimeoutMs: 60000,
            scriptResponseTimeoutMs: 30000,
            imageFetchTimeoutMs: 45000,
            imageFetchRetries: 3,
            imageRetryDelayMs: 1000,
            delayBetweenTaskStartMs: 200,
            delayAfterTaskFinishMs: 500,
            zipCompressionLevel: 6,
            ...(this.config.download || {})
        };
    }

    cleanChapterName(text) {
        if (!text) return 'Unknown Chapter';
        return text.replace(/^chapter\s+/i, '').replace(/^ch\.\s*/i, '').trim();
    }

    getImageUrl(img) {
        if (!img) return null;
        
        const url = img.dataset?.src || 
                    img.dataset?.lazySrc || 
                    img.getAttribute('data-src') || 
                    img.getAttribute('data-lazy-src') || 
                    img.src;
        
        if (url && typeof url === 'string' && url.startsWith('http')) {
            return url.trim();
        }
        return null;
    }

    isValidChapterLink(link, url) {
        return !!link.closest('li');
    }

    sortChapters(chapters) {
        return chapters.sort((a, b) => {
            const numA = this.extractChapterNumber(a.url, a.name);
            const numB = this.extractChapterNumber(b.url, b.name);

            if (numA !== null && numB !== null) {
                return numA - numB;
            }

            return a.name.localeCompare(b.name);
        });
    }

    // Abstract methods
    getChapterListSelectors() { throw new Error('Must implement'); }
    getTitleSelectors() { throw new Error('Must implement'); }
    getImageSelectors() { throw new Error('Must implement'); }
    isChapterUrl(url) { throw new Error('Must implement'); }
}

// ============ WEBTOONSCAN ADAPTER ============
class WebtoonscanAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'Webtoonscan',
            domains: ['webtoonscan.com', 'cdn4.webtoonscan.com'],
            ...siteConfig
        });
    }

    isChapterListingPage(url) {
        if (!url) return false;
        return url.includes('webtoonscan.com/manhwa/') && !this.isChapterUrl(url);
    }

    getChapterListSelectors() {
        return [
            'div.page-content-listing.single-page ul.main.version-chap li.wp-manga-chapter a',
            'div.listing-chapters_wrap ul li a',
            'div.version-chap ul li a',
            'ul.version-chap li a'
        ];
    }

    getTitleSelectors() {
        return [
            'h1.post-title',
            '.post-title h1',
            '.post-title h3',
            '.entry-title',
            '.main-info .container h1'
        ];
    }

    getImageSelectors() {
        return [
            'div.reading-content div.page-break img.wp-manga-chapter-img',
            'div.read-container img.viewer-image'
        ];
    }

    isChapterUrl(url) {
        if (!url) return false;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            const lastSegment = pathSegments.pop();

            if (lastSegment) {
                const isChapterPattern = /^chapter-[\d\.]+$/i.test(lastSegment) || 
                                        /^[\d\.]+$/.test(lastSegment);
                return isChapterPattern && url.includes('webtoonscan.com');
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    isValidChapterLink(link, url) {
        const parent = link.closest('li.wp-manga-chapter, li');
        if (!parent) return false;
        const text = link.textContent?.trim();
        if (!text || text.length === 0) return false;
        return true;
    }

    extractChapterNumberFromUrl(url) {
        if (!url) return null;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            const lastSegment = pathSegments.pop();

            if (lastSegment) {
                const chapterMatch = lastSegment.match(/^chapter-([\d\.]+)/i);
                if (chapterMatch) return parseFloat(chapterMatch[1]);
                if (/^[\d\.]+$/.test(lastSegment)) return parseFloat(lastSegment);
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    getChapters() {
        const chapters = [];
        const selectors = this.getChapterListSelectors();
        const uniqueUrls = new Set();

        for (const selector of selectors) {
            const links = document.querySelectorAll(selector);
            
            for (const link of links) {
                const url = link.href?.trim();
                if (!url) continue;
                if (!this.isChapterUrl(url)) continue;
                if (!this.isValidChapterLink(link, url)) continue;
                if (uniqueUrls.has(url)) continue;

                const name = this.cleanChapterName(link.textContent);
                chapters.push({ name, url });
                uniqueUrls.add(url);
            }
        }

        return this.sortChapters(chapters);
    }

    getChapterImages() {
        const images = [];
        const selectors = this.getImageSelectors();

        for (const selector of selectors) {
            const imageElements = document.querySelectorAll(selector);
            
            for (const img of imageElements) {
                const url = this.getImageUrl(img);
                if (url) {
                    images.push(url);
                }
            }

            if (images.length > 0) break;
        }

        return images;
    }

    sortChapters(chapters) {
        return chapters.sort((a, b) => {
            const numA = this.extractChapterNumberFromUrl(a.url);
            const numB = this.extractChapterNumberFromUrl(b.url);

            if (numA !== null && numB !== null) {
                return numA - numB;
            }

            const nameNumA = parseFloat(a.name.match(/^[\d\.]+/)?.[0]);
            const nameNumB = parseFloat(b.name.match(/^[\d\.]+/)?.[0]);

            if (!isNaN(nameNumA) && !isNaN(nameNumB)) {
                return nameNumA - nameNumB;
            }

            return a.name.localeCompare(b.name);
        });
    }
}

// ============ SITE REGISTRY ============
class SiteRegistry {
    constructor() {
        this.adapters = new Map();
        this.defaultAdapter = null;
    }

    register(name, adapter, isDefault = false) {
        if (!name || !adapter) {
            throw new Error('SiteRegistry: name and adapter are required');
        }

        this.adapters.set(name, adapter);
        
        if (isDefault || !this.defaultAdapter) {
            this.defaultAdapter = adapter;
        }

        console.log(`[SiteRegistry] Registered adapter: ${name}`);
    }

    get(name) {
        return this.adapters.get(name) || null;
    }

    findAdapterForUrl(url) {
        if (!url) return null;

        for (const [name, adapter] of this.adapters) {
            if (adapter.matchesUrl(url)) {
                return adapter;
            }
        }

        return null;
    }

    isSupported(url) {
        return this.findAdapterForUrl(url) !== null;
    }

    getRegisteredSites() {
        return Array.from(this.adapters.keys());
    }

    initialize() {
        this.adapters.clear();
        
        if (typeof WebtoonscanAdapter !== 'undefined') {
            this.register('webtoonscan', new WebtoonscanAdapter(), true);
        }

        console.log('[SiteRegistry] Initialized with adapters:', this.getRegisteredSites());
    }
}

// Create and initialize registry
const siteRegistry = new SiteRegistry();
siteRegistry.initialize();

console.log("[Content Script] Registry initialized with:", siteRegistry.getRegisteredSites());

// ============ CONTENT SCRIPT LOGIC ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "getChapters") {
        console.log("[Content Script] Received request: getChapters");
        
        try {
            const currentUrl = window.location.href;
            console.log("[Content Script] Looking for adapter for:", currentUrl);
            console.log("[Content Script] Registered sites:", siteRegistry.getRegisteredSites());
            
            const adapter = siteRegistry.findAdapterForUrl(currentUrl);
            
            if (!adapter) {
                console.error("[Content Script] No adapter found for URL:", currentUrl);
                sendResponse({ 
                    action: "error",
                    error: `No adapter found for this site: ${currentUrl}`,
                    title: 'Unknown',
                    chapters: []
                });
                return true;
            }
            
            console.log(`[Content Script] Using adapter: ${adapter.name}`);
            
            // Get chapters using adapter
            let chapters = [];
            if (typeof adapter.getChapters === 'function') {
                chapters = adapter.getChapters();
            } else {
                chapters = extractChaptersFallback(adapter);
            }
            
            console.log(`[Content Script] Found ${chapters.length} chapters.`);
            
            // Get title
            let title = 'Unknown Title';
            if (typeof adapter.getTitle === 'function') {
                title = adapter.getTitle();
            }
            
            sendResponse({ 
                action: "chaptersFound",
                title: title,
                chapters: chapters,
                siteName: adapter.name
            });
            
        } catch (error) {
            console.error("[Content Script] Error:", error);
            sendResponse({ 
                action: "error",
                error: error.message,
                title: 'Unknown',
                chapters: []
            });
        }
        
        return true;
    }
    
    return false;
});

function extractChaptersFallback(adapter) {
    const chapters = [];
    const uniqueUrls = new Set();
    
    const selectors = adapter.getChapterListSelectors();
    
    for (const selector of selectors) {
        const links = document.querySelectorAll(selector);
        
        for (const link of links) {
            const url = link.href?.trim();
            if (!url || uniqueUrls.has(url)) continue;
            
            if (adapter.isChapterUrl && !adapter.isChapterUrl(url)) continue;
            if (adapter.isValidChapterLink && !adapter.isValidChapterLink(link, url)) continue;
            
            const name = adapter.cleanChapterName ? 
                adapter.cleanChapterName(link.textContent) : 
                link.textContent?.trim() || 'Unknown';
            
            chapters.push({ name, url });
            uniqueUrls.add(url);
        }
    }
    
    return adapter.sortChapters ? adapter.sortChapters(chapters) : chapters;
}

chrome.runtime.sendMessage({ action: "contentScriptReady", url: window.location.href });
console.log("[Content Script] Ready");