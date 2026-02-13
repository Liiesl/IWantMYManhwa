// --- START OF FILE chapterScraper.js ---

// chapterScraper.js (Multi-Site Support)
// Uses SiteRegistry and adapters for site-specific image extraction

'use strict';
(() => {
    const logPrefix = "[Chapter Scraper]";
    console.log(`${logPrefix} Script injected and running on: ${window.location.href}`);

    // Wait for SiteRegistry to be available
    function waitForRegistry(callback, maxAttempts = 50) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (typeof siteRegistry !== 'undefined' && siteRegistry.adapters.size > 0) {
                clearInterval(interval);
                callback();
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.error(`${logPrefix} SiteRegistry not available after ${maxAttempts} attempts`);
                // Proceed with fallback
                callback();
            }
        }, 100);
    }

    // Initialize when registry is ready
    waitForRegistry(() => {
        if (typeof siteRegistry !== 'undefined') {
            console.log(`${logPrefix} SiteRegistry ready with adapters:`, siteRegistry.getRegisteredSites());
        }
    });

    // Listener for request from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "getChapterImages") {
            console.log(`${logPrefix} Received 'getChapterImages' request.`);
            
            try {
                const imageUrls = findChapterImageUrls();

                if (!imageUrls) {
                    console.error(`${logPrefix} findChapterImageUrls returned undefined/null.`);
                    chrome.runtime.sendMessage({
                        action: "scraperError",
                        payload: {
                            chapterUrl: window.location.href,
                            error: "Scraper function failed internally."
                        }
                    }).catch(e => console.error(`${logPrefix} Failed to send error: ${e.message}`));
                    return false;
                }

                console.log(`${logPrefix} Found ${imageUrls.length} valid image URLs. Sending response.`);
                chrome.runtime.sendMessage({
                    action: "chapterImagesResponse",
                    payload: {
                        chapterUrl: window.location.href,
                        imageUrls: imageUrls
                    }
                }).catch(e => console.error(`${logPrefix} Failed to send image URLs response: ${e.message}`));

            } catch (error) {
                console.error(`${logPrefix} Error during scraping or sending response:`, error);
                chrome.runtime.sendMessage({
                    action: "scraperError",
                    payload: {
                        error: error.message || 'Unknown scraper error',
                        chapterUrl: window.location.href
                    }
                }).catch(sendError => {
                    console.error(`${logPrefix} Failed to send error message back to background:`, sendError);
                });
            }
            
            return false;
        }
        
        return false;
    });

    // Function to find image URLs using adapter or fallback
    function findChapterImageUrls() {
        // Try to find adapter for current URL
        let adapter = null;
        
        if (typeof siteRegistry !== 'undefined') {
            adapter = siteRegistry.findAdapterForUrl(window.location.href);
        }
        
        if (adapter && typeof adapter.getChapterImages === 'function') {
            console.log(`${logPrefix} Using adapter: ${adapter.name}`);
            const images = adapter.getChapterImages();
            if (images && images.length > 0) {
                return images;
            }
            // If adapter returns empty, try fallback
        }
        
        // Fallback to manual extraction using adapter selectors
        if (adapter && adapter.getImageSelectors) {
            const selectors = adapter.getImageSelectors();
            const images = [];
            
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const img of elements) {
                    const url = getImageUrl(img, adapter);
                    if (url) images.push(url);
                }
                if (images.length > 0) break;
            }
            
            if (images.length > 0) return images;
        }
        
        // Ultimate fallback: try common selectors
        return fallbackImageExtraction();
    }

    /**
     * Get image URL from element
     * @param {HTMLElement} img 
     * @param {SiteAdapter} adapter 
     * @returns {string|null}
     */
    function getImageUrl(img, adapter) {
        if (adapter && adapter.getImageUrl) {
            return adapter.getImageUrl(img);
        }
        
        // Default behavior
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
     * Ultimate fallback using common selectors
     * @returns {string[]}
     */
    function fallbackImageExtraction() {
        console.warn(`${logPrefix} No adapter found or adapter returned empty, using fallback extraction.`);
        
        const commonSelectors = [
            'div.reading-content div.page-break img.wp-manga-chapter-img',
            'div.read-container img.viewer-image',
            'img.wp-manga-chapter-img',
            '.reading-content img',
            '.chapter-content img',
            'article img',
            '.entry-content img'
        ];
        
        const images = [];
        
        for (const selector of commonSelectors) {
            const elements = document.querySelectorAll(selector);
            console.log(`${logPrefix} Fallback selector "${selector}" found ${elements.length} elements.`);
            
            for (const img of elements) {
                const url = img.dataset?.src || 
                            img.dataset?.lazySrc || 
                            img.getAttribute('data-src') || 
                            img.getAttribute('data-lazy-src') || 
                            img.src;
                
                if (url && typeof url === 'string' && url.startsWith('http')) {
                    images.push(url.trim());
                }
            }
            
            if (images.length > 0) {
                console.log(`${logPrefix} Fallback found ${images.length} images.`);
                break;
            }
        }
        
        return images;
    }

    console.log(`${logPrefix} Listener attached.`);

})(); // Immediately invoked function expression
// --- END OF FILE chapterScraper.js ---