// sites/ExampleAdapter.js
// Template for creating new site adapters

'use strict';

/**
 * Template adapter for new sites
 * Copy this file and rename it for your site (e.g., BatoAdapter.js)
 * Then implement the required methods below
 */
class ExampleAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'Example Site',  // Display name
            domains: ['example.com', 'www.example.com'],  // Supported domains
            ...siteConfig
        });
    }

    /**
     * CSS selectors for finding chapter list
     * Return array of selectors - they'll be tried in order
     * 
     * Tips:
     * - Use specific classes when possible
     * - Provide multiple selectors as fallbacks
     * - Test in DevTools: document.querySelectorAll('your-selector')
     * 
     * @returns {string[]}
     */
    getChapterListSelectors() {
        return [
            'div.chapter-list a.chapter-link',  // Most specific
            'ul.chapters li a',                  // Fallback 1
            '.episode-list a'                    // Fallback 2
        ];
    }

    /**
     * CSS selectors for finding the manhwa title
     * @returns {string[]}
     */
    getTitleSelectors() {
        return [
            'h1.series-title',
            '.manga-title h1',
            'h1.entry-title'
        ];
    }

    /**
     * CSS selectors for finding chapter images on reader page
     * @returns {string[]}
     */
    getImageSelectors() {
        return [
            'div.reader-img img',
            '.page-image img',
            'img.chapter-image'
        ];
    }

    /**
     * Check if a URL is a chapter reader URL
     * This should return true for URLs like:
     * - https://example.com/chapter/123
     * - https://example.com/read/series-name/chapter-1
     * 
     * @param {string} url 
     * @returns {boolean}
     */
    isChapterUrl(url) {
        if (!url) return false;
        
        // Example patterns - adjust for your site
        return /example\.com.*\/(chapter|read)\//i.test(url);
        
        // Alternative: check URL structure
        // try {
        //     const urlObj = new URL(url);
        //     const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
        //     return pathSegments.includes('chapter');
        // } catch (e) {
        //     return false;
        // }
    }

    /**
     * Check if URL is a chapter listing page (not reader)
     * This is where users see all chapters and can select which to download
     * 
     * @param {string} url 
     * @returns {boolean}
     */
    isChapterListingPage(url) {
        if (!url) return false;
        
        // Chapter listing page has the series overview but not a specific chapter
        // Example: https://example.com/series/series-name
        return url.includes('example.com/series/') && !this.isChapterUrl(url);
    }

    /**
     * Optional: Custom chapter link validation
     * Override if site has special requirements
     * 
     * @param {HTMLElement} link 
     * @param {string} url 
     * @returns {boolean}
     */
    isValidChapterLink(link, url) {
        // Default: check if it's within a list item and has text
        const parent = link.closest('li');
        if (!parent) return false;
        
        const text = link.textContent?.trim();
        if (!text || text.length === 0) return false;
        
        // Add site-specific validation here
        // Example: check for specific data attributes
        // if (!link.dataset.chapterId) return false;
        
        return true;
    }

    /**
     * Optional: Custom chapter number extraction
     * Override if chapter numbers are in unusual format
     * 
     * @param {string} url 
     * @returns {number|null}
     */
    extractChapterNumberFromUrl(url) {
        if (!url) return null;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            
            // Look for chapter number in path
            // Example: /series/name/chapter-123 -> 123
            for (const segment of pathSegments) {
                // Pattern: chapter-NUMBER
                const chapterMatch = segment.match(/^chapter-([\d\.]+)/i);
                if (chapterMatch) return parseFloat(chapterMatch[1]);
                
                // Pattern: just a number at the end
                if (/^[\d\.]+$/.test(segment)) {
                    return parseFloat(segment);
                }
            }
        } catch (e) {
            return null;
        }
        
        return null;
    }

    /**
     * Optional: Custom chapter extraction
     * Only override if default extraction doesn't work
     * 
     * @returns {Array<{name: string, url: string}>}
     */
    getChapters() {
        // Use default implementation or provide custom logic
        const chapters = [];
        const selectors = this.getChapterListSelectors();
        const uniqueUrls = new Set();
        
        for (const selector of selectors) {
            const links = document.querySelectorAll(selector);
            
            for (const link of links) {
                const url = link.href?.trim();
                if (!url || uniqueUrls.has(url)) continue;
                
                if (!this.isChapterUrl(url)) continue;
                if (!this.isValidChapterLink(link, url)) continue;
                
                const name = this.cleanChapterName(link.textContent);
                chapters.push({ name, url });
                uniqueUrls.add(url);
            }
            
            if (chapters.length > 0) break;  // Stop if we found chapters
        }
        
        return this.sortChapters(chapters);
    }

    /**
     * Optional: Custom image extraction
     * Only override if default extraction doesn't work
     * 
     * @returns {string[]}
     */
    getChapterImages() {
        const images = [];
        const selectors = this.getImageSelectors();
        
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            
            for (const img of elements) {
                const url = this.getImageUrl(img);
                if (url) images.push(url);
            }
            
            if (images.length > 0) break;
        }
        
        return images;
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.ExampleAdapter = ExampleAdapter;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExampleAdapter;
}