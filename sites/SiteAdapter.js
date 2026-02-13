// sites/SiteAdapter.js
// Base abstract class for all site adapters

'use strict';

/**
 * Base adapter class for all manhwa/manga site implementations.
 * All site-specific adapters must extend this class and implement all methods.
 */
class SiteAdapter {
    constructor(siteConfig = {}) {
        this.config = siteConfig;
        this.name = siteConfig.name || 'Unknown Site';
        this.domains = siteConfig.domains || [];
    }

    /**
     * Check if this adapter handles the given URL
     * @param {string} url - The URL to check
     * @returns {boolean} - True if this adapter handles this URL
     */
    matchesUrl(url) {
        if (!url) return false;
        return this.domains.some(domain => {
            const pattern = new RegExp(`https?://[^/]*${domain.replace(/\./g, '\\.')}`, 'i');
            return pattern.test(url);
        });
    }

    /**
     * Get the manhwa title from the page
     * @returns {string} - The title or 'Unknown Title'
     */
    getTitle() {
        const selectors = this.getTitleSelectors();
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent?.trim()) {
                return element.textContent.trim();
            }
        }
        // Fallback to page title
        const pageTitle = document.title;
        if (pageTitle) {
            const parts = pageTitle.split(/[-–—\|]/);
            return parts[0].trim();
        }
        return 'Unknown Title';
    }

    /**
     * Extract the chapter number from a chapter URL or name
     * @param {string} url - Chapter URL
     * @param {string} name - Chapter name (optional fallback)
     * @returns {number|string|null} - Chapter number or null if not found
     */
    extractChapterNumber(url, name = '') {
        if (!url) return null;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            const lastSegment = pathSegments.pop();

            if (lastSegment) {
                // Try chapter-number pattern
                const chapterMatch = lastSegment.match(/^chapter-([\d\.]+)/i);
                if (chapterMatch) return parseFloat(chapterMatch[1]);

                // Try pure number pattern
                if (/^[\d\.]+$/.test(lastSegment)) return parseFloat(lastSegment);
            }
        } catch (e) {
            // Invalid URL, fall through
        }

        // Fallback: try to extract from name
        if (name) {
            const nameMatch = name.match(/^[\d\.]+/);
            if (nameMatch) return parseFloat(nameMatch[0]);
        }

        return null;
    }

    // Abstract methods - must be implemented by subclasses
    
    /**
     * Get CSS selectors for finding chapter list
     * @returns {string[]} - Array of CSS selectors to try
     */
    getChapterListSelectors() {
        throw new Error('getChapterListSelectors() must be implemented by subclass');
    }

    /**
     * Get CSS selectors for finding the manhwa title
     * @returns {string[]} - Array of CSS selectors to try
     */
    getTitleSelectors() {
        throw new Error('getTitleSelectors() must be implemented by subclass');
    }

    /**
     * Get CSS selectors for finding chapter images
     * @returns {string[]} - Array of CSS selectors to try
     */
    getImageSelectors() {
        throw new Error('getImageSelectors() must be implemented by subclass');
    }

    /**
     * Check if a URL matches the chapter pattern for this site
     * @param {string} url - URL to check
     * @returns {boolean} - True if URL is a chapter URL
     */
    isChapterUrl(url) {
        throw new Error('isChapterUrl() must be implemented by subclass');
    }

    /**
     * Extract and clean chapter name from link text
     * @param {string} text - Raw link text
     * @returns {string} - Cleaned chapter name
     */
    cleanChapterName(text) {
        if (!text) return 'Unknown Chapter';
        return text.replace(/^chapter\s+/i, '').replace(/^ch\.\s*/i, '').trim();
    }

    /**
     * Get download configuration for this site
     * @returns {Object} - Download settings
     */
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

    /**
     * Get file naming pattern
     * @returns {Object} - Naming patterns
     */
    getNamingPattern() {
        return {
            chapterFolder: 'Chapter_{number}',  // Available: {number}, {name}, {title}
            imageFile: '{number}.{extension}',  // Available: {number}, {extension}
            zipFile: '{title}_Chapter_{number}.zip',
            ...(this.config.naming || {})
        };
    }

    /**
     * Get the image URL from an image element
     * Handles lazy loading attributes
     * @param {HTMLElement} img - Image element
     * @returns {string|null} - Image URL or null
     */
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

    /**
     * Validate that a chapter link element is valid
     * Override for site-specific validation
     * @param {HTMLElement} link - Link element
     * @param {string} url - URL
     * @returns {boolean} - True if valid chapter link
     */
    isValidChapterLink(link, url) {
        // Default: check if it's within a list item
        return !!link.closest('li');
    }

    /**
     * Sort chapters in ascending order
     * Override for site-specific sorting
     * @param {Array} chapters - Array of chapter objects {name, url}
     * @returns {Array} - Sorted chapters
     */
    sortChapters(chapters) {
        return chapters.sort((a, b) => {
            const numA = this.extractChapterNumber(a.url, a.name);
            const numB = this.extractChapterNumber(b.url, b.name);

            if (numA !== null && numB !== null) {
                return numA - numB;
            }

            // Fallback: sort by name
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Download a chapter
     * Each adapter implements its own download logic
     * This is the COMPLETE download flow - from getting images to triggering download
     * 
     * @param {Object} chapterData - Chapter info {name, url, index}
     * @param {string} seriesTitle - The series title
     * @param {Function} updateStatus - Callback to update UI status (optional)
     * @param {Object} options - Additional options {downloadState, sendPopupMessage, etc.}
     * @returns {Promise<Object>} - Result {status: 'success'|'failed'|'skipped', chapterName, failedImages, error}
     */
    async downloadChapter(chapterData, seriesTitle, updateStatus, options = {}) {
        throw new Error('downloadChapter() must be implemented by subclass');
    }
}

// Make available globally for use in other scripts
try {
    if (typeof window !== 'undefined') {
        window.SiteAdapter = SiteAdapter;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.SiteAdapter = SiteAdapter;
    }
    if (typeof self !== 'undefined') {
        self.SiteAdapter = SiteAdapter;
    }
} catch (e) {
    console.error("[SiteAdapter] Failed to set global:", e);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SiteAdapter;
}