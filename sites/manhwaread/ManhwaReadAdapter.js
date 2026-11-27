'use strict';

class ManhwaReadAdapter extends ManhwaReadContentAdapter {
    async downloadChapter(chapterData, seriesTitle, updateStatus, options = {}) {
        const { chapter, index, activeTabIds = new Set() } = chapterData;
        const config = this.getDownloadConfig();
        const logPrefix = `[ManhwaRead Download Ch${index + 1}]`;
        let chapterTabId = null;
        let imageUrls = [];

        try {
            if (updateStatus) updateStatus('fetching', 'Opening chapter tab...');

            const chapterTab = await chrome.tabs.create({ url: chapter.url, active: false });
            chapterTabId = chapterTab.id;
            if (!chapterTabId) throw new Error('Failed to create chapter tab.');
            activeTabIds.add(chapterTabId);

            await this.waitForTabReady(chapterTabId, config.tabLoadTimeoutMs);

            const scrapeResults = await chrome.scripting.executeScript({
                target: { tabId: chapterTabId },
                world: 'MAIN',
                func: async (dataTimeoutMs, imageTimeoutMs, retryCount, retryDelayMs) => {
                    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
                    const dataDeadline = Date.now() + dataTimeoutMs;

                    while ((!window.chapterData?.base || !window.chapterData?.data) && Date.now() < dataDeadline) {
                        await wait(250);
                    }

                    if (!window.chapterData?.base || !window.chapterData?.data) {
                        throw new Error('Chapter image data was not available on the page.');
                    }

                    let images;
                    try {
                        images = JSON.parse(atob(window.chapterData.data));
                    } catch (error) {
                        throw new Error(`Could not decode chapter image data: ${error.message}`);
                    }

                    if (!Array.isArray(images) || images.length === 0 || images.some(image => !image?.src)) {
                        throw new Error('Chapter image data did not contain a valid image list.');
                    }

                    const baseUrl = new URL(window.chapterData.base);
                    if (!['http:', 'https:'].includes(baseUrl.protocol)) {
                        throw new Error('Chapter image data used an unsupported URL.');
                    }
                    const imageBase = `${baseUrl.href.replace(/\/+$/, '')}/`;
                    const imageUrls = images.map(image => {
                        const url = new URL(String(image.src).replace(/\\/g, '/').replace(/^\/+/, ''), imageBase);
                        if (url.origin !== baseUrl.origin) {
                            throw new Error('Chapter image data included an unexpected image host.');
                        }
                        return url.href;
                    });
                    const objectUrls = new Array(imageUrls.length);
                    let nextIndex = 0;
                    let loadError = null;

                    const requestImage = url => new Promise((resolve, reject) => {
                        const request = new XMLHttpRequest();
                        request.open('GET', url);
                        request.responseType = 'blob';
                        request.timeout = imageTimeoutMs;
                        request.setRequestHeader('Accept', 'image/webp,image/*');
                        request.onload = () => {
                            if (request.status < 200 || request.status >= 300 || !request.response?.size) {
                                reject(new Error(`Image request failed with HTTP ${request.status}.`));
                                return;
                            }
                            resolve(request.response);
                        };
                        request.onerror = () => reject(new Error('Image request failed due to a network error.'));
                        request.ontimeout = () => reject(new Error('Image request timed out.'));
                        request.send();
                    });

                    const loadImage = async (url, index) => {
                        let lastError;
                        for (let attempt = 0; attempt <= retryCount; attempt++) {
                            try {
                                const blob = await requestImage(url);
                                objectUrls[index] = URL.createObjectURL(blob);
                                return;
                            } catch (error) {
                                lastError = error;
                                if (attempt < retryCount) await wait(retryDelayMs * (attempt + 1));
                            }
                        }
                        throw new Error(`Failed to load chapter image ${index + 1}/${imageUrls.length}: ${lastError.message}`);
                    };

                    const loadWorker = async () => {
                        while (!loadError) {
                            const index = nextIndex++;
                            if (index >= imageUrls.length) return;
                            try {
                                await loadImage(imageUrls[index], index);
                            } catch (error) {
                                loadError = error;
                            }
                        }
                    };

                    try {
                        await Promise.all(Array.from({ length: Math.min(3, imageUrls.length) }, loadWorker));
                        if (loadError) throw loadError;
                        return { urls: objectUrls, imageCount: images.length };
                    } catch (error) {
                        objectUrls.filter(Boolean).forEach(url => URL.revokeObjectURL(url));
                        throw error;
                    }
                },
                args: [
                    config.tabLoadTimeoutMs,
                    config.imageFetchTimeoutMs,
                    config.imageFetchRetries,
                    config.imageRetryDelayMs
                ]
            });

            const scrapeResult = scrapeResults[0]?.result;
            imageUrls = scrapeResult?.urls || [];
            if (imageUrls.length === 0) {
                throw new Error('No chapter image URLs were found.');
            }
            if (imageUrls.length !== scrapeResult.imageCount) {
                throw new Error(`Only found ${imageUrls.length} of ${scrapeResult.imageCount} chapter images.`);
            }

            if (options.reportImageTotal) options.reportImageTotal(imageUrls.length);
            if (updateStatus) updateStatus('loading', 'Preparing chapter images...');
            await this.loadImageWorker(chapterTabId, options.outputFormat);

            const workerData = {
                outputFormat: options.outputFormat || 'zip',
                imageUrls,
                seriesTitle,
                chapterName: chapter.name,
                chapterIndex: index,
                imageFetchTimeoutMs: config.imageFetchTimeoutMs,
                imageFetchRetries: config.imageFetchRetries,
                imageRetryDelayMs: config.imageRetryDelayMs
            };

            const sendProgressStatus = progress => {
                if (progress.type === 'image' && updateStatus) {
                    const total = progress.total || imageUrls.length;
                    const done = Math.min(progress.downloadedCount || 0, total);
                    updateStatus('fetching', `Downloading ${done}/${total}...`, { progress: { done, total } });
                } else if ((progress.type === 'zip' || progress.type === 'pdf') && updateStatus) {
                    const message = progress.type === 'pdf' ? `Compiling PDF... ${progress.percent}%` : `Zipping... ${progress.percent}%`;
                    updateStatus('zipping', message, {
                        progress: { done: progress.percent, total: 100 }
                    });
                }
            };

            const result = await this.waitForImageTabResponse(chapterTabId, workerData, {
                timeoutMs: config.scriptResponseTimeoutMs,
                onProgress: sendProgressStatus
            });
            if (result.status !== 'success') {
                throw new Error(result.error || 'Image processing failed.');
            }

            if (updateStatus) {
                const message = result.failedImages > 0
                    ? `Downloaded (${result.failedImages} images failed)`
                    : 'Downloaded';
                updateStatus('complete', message);
            }

            return { status: 'success', chapterName: chapter.name, failedImages: result.failedImages };
        } catch (error) {
            console.error(`${logPrefix} Download failed:`, error);
            if (updateStatus) updateStatus('failed', error.message);
            return { status: 'failed', chapterName: chapter.name, error: error.message };
        } finally {
            if (chapterTabId) {
                if (imageUrls.length > 0) {
                    try {
                        await chrome.scripting.executeScript({
                            target: { tabId: chapterTabId },
                            world: 'MAIN',
                            func: urls => urls.forEach(url => URL.revokeObjectURL(url)),
                            args: [imageUrls]
                        });
                    } catch (error) {
                        console.warn(`${logPrefix} Failed to release temporary image URLs:`, error);
                    }
                }
                try {
                    await chrome.tabs.remove(chapterTabId);
                    activeTabIds.delete(chapterTabId);
                } catch (error) {
                    console.warn(`${logPrefix} Failed to close tab ${chapterTabId}:`, error);
                }
            }
        }
    }
}

// Make available globally
if (typeof window !== 'undefined') window.ManhwaReadAdapter = ManhwaReadAdapter;
if (typeof globalThis !== 'undefined') globalThis.ManhwaReadAdapter = ManhwaReadAdapter;
if (typeof self !== 'undefined') self.ManhwaReadAdapter = ManhwaReadAdapter;
