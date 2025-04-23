// --- START OF FILE chapterScraper.js ---

// chapterScraper.js (Updated for Refactored Background)
'use strict';
(() => {
    const logPrefix = "[Chapter Scraper]";
    console.log(`${logPrefix} Script injected and running on: ${window.location.href}`);

    // Listener for request from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "getChapterImages") {
            console.log(`${logPrefix} Received 'getChapterImages' request.`);
            try {
                const imageUrls = findChapterImageUrls(); // Use the existing image finding logic

                if (!imageUrls) {
                    // This case should ideally be handled inside findChapterImageUrls
                     console.error(`${logPrefix} findChapterImageUrls returned undefined/null.`);
                      chrome.runtime.sendMessage({
                         action: "scraperError",
                         payload: {
                             chapterUrl: window.location.href,
                             error: "Scraper function failed internally."
                         }
                     }).catch(e => console.error(`${logPrefix} Failed to send error: ${e.message}`));
                     return false; // Stop processing
                }

                console.log(`${logPrefix} Found ${imageUrls.length} valid image URLs. Sending response.`);
                // Send response back to the background script's specific tab listener
                chrome.runtime.sendMessage({
                    action: "chapterImagesResponse", // **** ACTION NAME CHANGED ****
                    payload: {
                        chapterUrl: window.location.href, // Include context
                        imageUrls: imageUrls
                    }
                }).catch(e => console.error(`${logPrefix} Failed to send image URLs response: ${e.message}`));

            } catch (error) {
                console.error(`${logPrefix} Error during scraping or sending response:`, error);
                // Attempt to send error back using the 'scraperError' action
                chrome.runtime.sendMessage({
                    action: "scraperError", // **** ACTION NAME FOR ERROR ****
                    payload: {
                        error: error.message || 'Unknown scraper error',
                        chapterUrl: window.location.href
                    }
                }).catch(sendError => {
                    console.error(`${logPrefix} Failed to send error message back to background:`, sendError);
                });
            }
            // Indicate message handled, no sync response needed
            return false;
        }
        // Return false if message not handled by this listener
        return false;
    });

    // Function to find image URLs (Keep your existing, effective logic)
    function findChapterImageUrls() {
        // Selector needs to be accurate for the chapter page structure
        // Using the selectors from your original file:
        const imageElements = document.querySelectorAll(
            'div.reading-content div.page-break img.wp-manga-chapter-img, div.read-container img.viewer-image'
        );

        if (!imageElements || imageElements.length === 0) {
            console.warn(`${logPrefix} No image elements found with known selectors.`);
            return []; // Return empty array if none found
        }

        const urls = Array.from(imageElements)
            .map(img => {
                // Prefer data-src/data-lazy-src if present, fallback to src
                const lazySrc = img.dataset.src || img.dataset.lazySrc || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
                const src = (lazySrc || img.src)?.trim();
                // Basic check for http(s) AND non-empty string
                return src && src.startsWith('http') ? src : null;
            })
            .filter(src => src); // Filter out null/empty URLs

        return urls; // Return the array of found URLs
    }

    console.log(`${logPrefix} Listener attached.`);

    // Optional: You could send a "ready" message, but the background now
    // drives the process by sending "getChapterImages" after injection.
    // chrome.runtime.sendMessage({ action: "scraperReady", payload: { url: window.location.href } });

})(); // Immediately invoked function expression
// --- END OF FILE chapterScraper.js ---