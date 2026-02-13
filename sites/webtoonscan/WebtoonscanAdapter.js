// sites/WebtoonscanAdapter.js
// Full adapter - scraping + download
// Used by background.js

'use strict';

class WebtoonscanAdapter extends WebtoonscanContentAdapter {
    constructor(siteConfig = {}) {
        super(siteConfig);
    }

    // --- Download Method (Custom for Webtoonscan's CDN) ---

    async downloadChapter(chapterData, seriesTitle, updateStatus, options = {}) {
        const { chapter, index, activeTabIds = new Set() } = chapterData;
        const { sendPopupMessage } = options;
        const config = this.getDownloadConfig();
        
        const chapterLogPrefix = `[Webtoonscan Download Ch${index + 1}]`;
        const chapterDataForUi = {
            chapterId: `chapter_${index}`,
            chapterName: chapter.name
        };

        console.log(`${chapterLogPrefix} Starting download...`);
        if (updateStatus) updateStatus('fetching', 'Opening chapter tab...');

        let chapterTabId = null;
        let validImageUrls = [];

        try {
            // 1. Open chapter tab
            const chapterTab = await chrome.tabs.create({ url: chapter.url, active: false });
            chapterTabId = chapterTab.id;
            if (!chapterTabId) throw new Error("Failed to create chapter tab.");
            activeTabIds.add(chapterTabId);
            console.log(`${chapterLogPrefix} Created chapter tab ID: ${chapterTabId}`);

            // 2. Wait for tab to load
            await this.waitForTabLoad(chapterTabId, config.tabLoadTimeoutMs);

            // 3. Get image URLs using parent's getChapterImages logic
            const imageUrls = await this.scrapeImagesFromTab(chapterTabId, config);

            if (!Array.isArray(imageUrls)) {
                throw new Error("Failed to get image URLs.");
            }

            validImageUrls = imageUrls.filter(url => url && typeof url === 'string' && url.startsWith('http'));
            console.log(`${chapterLogPrefix} Found ${validImageUrls.length} valid image URLs.`);

            if (validImageUrls.length === 0) {
                if (updateStatus) updateStatus('skipped', 'No images found');
                return { status: 'skipped', chapterName: chapter.name, message: "No images found" };
            }

        } catch (error) {
            console.error(`${chapterLogPrefix} Failed to get images:`, error);
            if (updateStatus) updateStatus('failed', error.message);
            return { status: 'failed', chapterName: chapter.name, error: error.message };
        } finally {
            if (chapterTabId) {
                try {
                    await chrome.tabs.remove(chapterTabId);
                    activeTabIds.delete(chapterTabId);
                } catch (e) {}
            }
        }

        // 4. Open image tab on CDN domain (special handling for Webtoonscan)
        if (updateStatus) updateStatus('fetching', 'Opening image tab...');
        
        const firstImageUrl = validImageUrls[0];
        let imageTabId = null;

        try {
            console.log(`${chapterLogPrefix} Creating image tab for URL: ${firstImageUrl}`);
            const imageTab = await chrome.tabs.create({ url: firstImageUrl, active: false });
            imageTabId = imageTab.id;
            if (!imageTabId) throw new Error("Failed to create image tab.");
            activeTabIds.add(imageTabId);
            console.log(`${chapterLogPrefix} Created image tab ID: ${imageTabId}`);

            if (updateStatus) updateStatus('loading', 'Waiting for image tab...');
            await this.waitForTabLoad(imageTabId, config.tabLoadTimeoutMs);

            // 5. Inject jszip and imageTabWorker
            await chrome.scripting.executeScript({ target: { tabId: imageTabId }, files: ['jszip.min.js'] });
            await chrome.scripting.executeScript({ target: { tabId: imageTabId }, files: ['imageTabWorker.js'] });

            if (updateStatus) updateStatus('fetching', 'Processing images...');

            // 6. Send data to worker and wait for result
            const workerData = {
                imageUrls: validImageUrls,
                seriesTitle: seriesTitle,
                chapterName: chapter.name,
                chapterIndex: index
            };

            const result = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`Timeout waiting for image tab (${config.scriptResponseTimeoutMs / 1000}s)`));
                }, config.scriptResponseTimeoutMs);

                const listener = (message) => {
                    if (message.action === "imageTabDone") {
                        clearTimeout(timeoutId);
                        chrome.runtime.onMessage.removeListener(listener);
                        resolve(message.payload);
                    }
                };

                chrome.runtime.onMessage.addListener(listener);
                chrome.tabs.sendMessage(imageTabId, { action: "processImages", data: workerData })
                    .catch(err => { clearTimeout(timeoutId); reject(new Error(`Failed to send to image tab: ${err.message}`)); });
            });

            if (result.status === 'success') {
                const finalMessage = result.failedImages > 0 ? `Downloaded (${result.failedImages} img failed)` : "Downloaded";
                if (updateStatus) updateStatus('complete', finalMessage);
                return { status: 'success', chapterName: chapter.name, failedImages: result.failedImages };
            } else {
                throw new Error(result.error || 'Image tab processing failed');
            }

        } catch (error) {
            console.error(`${chapterLogPrefix} Download failed:`, error);
            if (updateStatus) updateStatus('failed', error.message);
            return { status: 'failed', chapterName: chapter.name, error: error.message };
        } finally {
            if (imageTabId) {
                try {
                    await chrome.tabs.remove(imageTabId);
                    activeTabIds.delete(imageTabId);
                } catch (e) {}
            }
        }
    }

    // Helper: scrape images from a chapter tab
    async scrapeImagesFromTab(tabId, config) {
        // Inject a simple scraper inline
        const scraperCode = `
            (function() {
                const selectors = [
                    'div.reading-content div.page-break img.wp-manga-chapter-img',
                    'div.read-container img.viewer-image'
                ];
                for (const selector of selectors) {
                    const images = document.querySelectorAll(selector);
                    if (images.length > 0) {
                        const urls = [];
                        for (const img of images) {
                            const url = img.dataset?.src || img.dataset?.lazySrc || img.getAttribute('data-src') || img.src;
                            if (url && url.startsWith('http')) urls.push(url.trim());
                        }
                        if (urls.length > 0) return urls;
                    }
                }
                return [];
            })();
        `;
        
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                // This will be replaced by the function above
                const selectors = [
                    'div.reading-content div.page-break img.wp-manga-chapter-img',
                    'div.read-container img.viewer-image'
                ];
                for (const selector of selectors) {
                    const images = document.querySelectorAll(selector);
                    if (images.length > 0) {
                        const urls = [];
                        for (const img of images) {
                            const url = img.dataset?.src || img.dataset?.lazySrc || img.getAttribute('data-src') || img.src;
                            if (url && url.startsWith('http')) urls.push(url.trim());
                        }
                        if (urls.length > 0) return urls;
                    }
                }
                return [];
            }
        });
        
        return results[0]?.result || [];
    }

    // Helper method to wait for tab load
    waitForTabLoad(tabId, timeoutMs) {
        return new Promise((resolve, reject) => {
            const listener = (updatedTabId, changeInfo, tab) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    clearTimeout(timeoutId);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            
            const timeoutId = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                reject(new Error(`Timeout loading tab (${timeoutMs / 1000}s)`));
            }, timeoutMs);

            chrome.tabs.onUpdated.addListener(listener);
        });
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.WebtoonscanAdapter = WebtoonscanAdapter;
}

if (typeof globalThis !== 'undefined') {
    globalThis.WebtoonscanAdapter = WebtoonscanAdapter;
}

if (typeof self !== 'undefined') {
    self.WebtoonscanAdapter = WebtoonscanAdapter;
}
