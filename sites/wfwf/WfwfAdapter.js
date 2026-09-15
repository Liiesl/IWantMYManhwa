'use strict';

class WfwfAdapter extends WfwfContentAdapter {
    constructor(siteConfig = {}) {
        super(siteConfig);
    }

    async downloadChapter(chapterData, seriesTitle, updateStatus, options = {}) {
        const { chapter, index, activeTabIds = new Set() } = chapterData;
        const { sendPopupMessage } = options;
        const config = this.getDownloadConfig();

        const chapterLogPrefix = `[Wfwf Download Ch${index + 1}]`;
        const chapterDataForUi = {
            chapterId: `chapter_${index}`,
            chapterName: chapter.name
        };

        console.log(`${chapterLogPrefix} Starting download...`);
        if (updateStatus) updateStatus('fetching', 'Opening chapter tab...');

        let chapterTabId = null;
        let validImageUrls = [];

        try {
            const chapterTab = await chrome.tabs.create({ url: chapter.url, active: false });
            chapterTabId = chapterTab.id;
            if (!chapterTabId) throw new Error("Failed to create chapter tab.");
            activeTabIds.add(chapterTabId);
            console.log(`${chapterLogPrefix} Created chapter tab ID: ${chapterTabId}`);

            validImageUrls = await this.scrapeImageUrlsQuick(
                chapterTabId,
                this.getImageSelectors(),
                null,
                config.tabLoadTimeoutMs
            );
            // scrapeImageUrlsQuick returns raw data-src/src values; apply the same
            // ad/placeholder exclusion as getChapterImages (generic filter)
            validImageUrls = validImageUrls.filter(url =>
                !url.includes('/assets/') &&
                !url.includes('sprite.png') &&
                !url.includes('iabn101.net') &&
                !url.includes('jads.co') &&
                !url.includes('juicyads')
            );
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

            if (updateStatus) updateStatus('loading', 'Preparing image tab...');
            await this.waitForTabReady(imageTabId, config.tabLoadTimeoutMs);

            await chrome.scripting.executeScript({ target: { tabId: imageTabId }, files: ['jszip.min.js'] });
            await chrome.scripting.executeScript({ target: { tabId: imageTabId }, files: ['imageTabWorker.js'] });

            if (updateStatus) updateStatus('fetching', 'Processing images...');

            const workerData = {
                imageUrls: validImageUrls,
                seriesTitle: seriesTitle,
                chapterName: chapter.name,
                chapterIndex: index,
                // Image CDN enforces hotlink protection (403 + Cloudflare block page
                // without a wfwf Referer). Spoof the chapter page as the referrer
                // so image fetches look like they come from the reader page.
                referrer: chapter.url,
                imageFetchTimeoutMs: config.imageFetchTimeoutMs,
                imageFetchRetries: config.imageFetchRetries,
                imageRetryDelayMs: config.imageRetryDelayMs
            };

            if (options.reportImageTotal) options.reportImageTotal(validImageUrls.length);

            const maxAttempts = (config.scriptResponseRetries || 0) + 1;
            let lastError = null;

            const sendProgressStatus = (progress) => {
                if (progress.type === 'image') {
                    const total = progress.total || validImageUrls.length;
                    const done = Math.min(progress.downloadedCount || 0, total);
                    if (updateStatus) updateStatus('fetching', `Downloading ${done}/${total}...`, { progress: { done, total } });
                } else if (progress.type === 'zip') {
                    if (updateStatus) updateStatus('zipping', `Zipping... ${progress.percent}%`, { progress: { done: progress.percent, total: 100 } });
                }
            };

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (attempt > 1) {
                    console.warn(`${chapterLogPrefix} Attempt ${attempt - 1} failed (${lastError?.message}). Retrying (${attempt}/${maxAttempts})...`);
                    if (updateStatus) updateStatus('fetching', `Attempt ${attempt - 1} failed, retrying...`);
                    try {
                        await new Promise(r => setTimeout(r, 1500));
                        await chrome.tabs.remove(imageTabId);
                        activeTabIds.delete(imageTabId);
                    } catch (e) {}
                    const newImageTab = await chrome.tabs.create({ url: firstImageUrl, active: false });
                    imageTabId = newImageTab.id;
                    if (!imageTabId) throw new Error("Failed to recreate image tab.");
                    activeTabIds.add(imageTabId);
                    if (updateStatus) updateStatus('loading', 'Preparing image tab (retry)...');
                    await this.waitForTabReady(imageTabId, config.tabLoadTimeoutMs);
                    await chrome.scripting.executeScript({ target: { tabId: imageTabId }, files: ['jszip.min.js'] });
                    await chrome.scripting.executeScript({ target: { tabId: imageTabId }, files: ['imageTabWorker.js'] });
                }

                if (updateStatus) updateStatus('fetching', 'Processing images...');

                try {
                    const result = await this.waitForImageTabResponse(imageTabId, workerData, {
                        timeoutMs: config.scriptResponseTimeoutMs,
                        onProgress: sendProgressStatus
                    });

                    if (result.status === 'success') {
                        const finalMessage = result.failedImages > 0 ? `Downloaded (${result.failedImages} img failed)` : "Downloaded";
                        if (updateStatus) updateStatus('complete', finalMessage);
                        return { status: 'success', chapterName: chapter.name, failedImages: result.failedImages };
                    }
                    throw new Error(result.error || 'Image tab processing failed');
                } catch (error) {
                    lastError = error;
                    console.error(`${chapterLogPrefix} Attempt ${attempt} failed:`, error.message);
                    if (attempt >= maxAttempts) throw error;
                }
            }

        } catch (error) {
            console.error(`${chapterLogPrefix} Download failed:`, error);
            if (updateStatus) updateStatus('failed', error.message);
            return { status: 'failed', chapterName: chapter.name, error: error.message };
        } finally {
            if (imageTabId) {
                try {
                    await new Promise(r => setTimeout(r, 2000));
                    await chrome.tabs.remove(imageTabId);
                    activeTabIds.delete(imageTabId);
                } catch (e) {}
            }
        }
    }
}

if (typeof window !== 'undefined') window.WfwfAdapter = WfwfAdapter;
if (typeof globalThis !== 'undefined') globalThis.WfwfAdapter = WfwfAdapter;
if (typeof self !== 'undefined') self.WfwfAdapter = WfwfAdapter;
