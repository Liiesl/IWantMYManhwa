// background.js for WebtoonScan Downloader (Refactored - Individual Chapter Zips)
'use strict';

// Assume jszip.min.js is loaded correctly via manifest or importScripts
try {
    importScripts('jszip.min.js'); // Adjust path if needed
    if (typeof JSZip === 'undefined') {
         throw new Error("JSZip failed to load. Check path and integrity.");
    }
    console.log("JSZip imported successfully.");
} catch (e) {
    console.error("Failed to import JSZip:", e);
    // Notify user via popup/sidepanel if possible, cannot proceed.
    // chrome.runtime.sendMessage({ action: "error", message: "Fatal: JSZip library failed to load." });
}

console.log("WebtoonScan Downloader (Refactored/Individual Zips): Background service worker started.");

// --- Configuration ---
const MAX_CONCURRENT_TABS = 3; // Max parallel chapter processing tabs
const TAB_LOAD_TIMEOUT_MS = 60000; // 60 seconds timeout for a chapter tab to load
const SCRIPT_RESPONSE_TIMEOUT_MS = 30000; // 30 seconds timeout for scraper script response
const IMAGE_FETCH_TIMEOUT_MS = 45000; // 45 seconds timeout for fetching a single image
const IMAGE_FETCH_RETRIES = 3;       // Retries for failed image downloads
const IMAGE_RETRY_DELAY_MS = 1000;   // Delay between image fetch retries
const DELAY_BETWEEN_TASK_START_MS = 200; // Small delay before starting next task if slot available
const DELAY_AFTER_TASK_FINISH_MS = 500; // Increased delay after a chapter finishes (includes zip/download)
const ZIP_COMPRESSION_LEVEL = 6;     // JSZip compression level (0-9)


// --- State ---
let currentDownloadState = {
    isActive: false,
    chaptersRequested: 0,
    chaptersProcessed: 0, // Includes success, skipped, failed
    chaptersSucceeded: 0, // Chapters where download was *initiated*
    chaptersFailed: 0,    // Chapters that failed processing OR download initiation
    title: '',
    activeTabIds: new Set() // Track tabs we opened
};
let chapterScraperPromises = {}; // { tabId: { resolve, reject, timeoutId } } for scraper response

// --- Utility Functions ---
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFilename(name, allowSpaces = false) {
    if (!name) return 'unknown';
    let sanitized = String(name).trim();
    // Basic removal of unsafe characters for filenames/paths
    sanitized = sanitized.replace(/[\\/:\*\?"<>\|]/g, '_').replace(/[\x00-\x1F]/g, '');
    if (!allowSpaces) {
        sanitized = sanitized.replace(/\s+/g, '_');
    } else {
        // Prevent excessive spaces if allowed
        sanitized = sanitized.replace(/\s{2,}/g, ' ');
    }
    // Clean up multiple/leading/trailing underscores/dots/spaces
    sanitized = sanitized.replace(/[\.\_\s]{2,}/g, '_').replace(/^[\.\_\s]+|[\.\_\s]+$/g, '');
    // Limit length
    sanitized = sanitized.substring(0, 100); // Shorten max length slightly for chapter names
    return sanitized || 'sanitized_name';
}

function padNumber(num, length = 3) {
    // Handle potential non-integer chapter numbers like 10.5 - keep the decimal part
    const numStr = String(num);
    const parts = numStr.split('.');
    const integerPart = parts[0];
    const decimalPart = parts.length > 1 ? '.' + parts[1] : '';
    return integerPart.padStart(length, '0') + decimalPart;
}

// Helper to attempt extracting a chapter number from a name
function extractChapterNumber(name, index) {
    if (!name) return index + 1; // Fallback to index

    // Try specific patterns first (more reliable)
    const patterns = [
        /Chapter\s*([\d\.]+)/i,
        /Ch\.?\s*([\d\.]+)/i,
        /(?:^|\s|\W)([\d\.]+)(?:$|\s|\W|:|-)/ // More general number possibly surrounded by non-word chars
    ];

    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match && match[1]) {
            const numStr = match[1];
            // Check if it's actually a number (potentially float)
            if (!isNaN(parseFloat(numStr))) {
                return numStr; // Return the string representation (e.g., "10.5")
            }
        }
    }

    // Last resort: find any sequence of digits, preferring longer sequences
    const digits = name.match(/\d+/g);
    if (digits) {
        // Maybe sort by length? Or just take the first/last? Let's take the first for now.
        return digits[0];
    }

    return index + 1; // Absolute fallback
}


// --- Communication Helpers ---
function sendPopupMessage(action, payload) {
    // console.log(`[Popup Msg Send] Action: ${action}`, payload ?? ''); // Optional detailed logging
    chrome.runtime.sendMessage({ action, payload })
        .catch(err => {
            if (err.message && !err.message.includes("Receiving end does not exist")) {
                console.warn(`[Popup Msg Send] Error sending ${action}: ${err.message}`);
            }
        });
}

function updateOverallProgress(textOverride = null) {
    const progress = currentDownloadState.chaptersRequested > 0
        ? Math.floor((currentDownloadState.chaptersProcessed / currentDownloadState.chaptersRequested) * 100)
        : 0;
    let statusText = textOverride || `Processed ${currentDownloadState.chaptersProcessed}/${currentDownloadState.chaptersRequested}...`;

    if (!textOverride && currentDownloadState.chaptersRequested > 0) {
         statusText += ` (Initiated: ${currentDownloadState.chaptersSucceeded}, Failed/Skipped: ${currentDownloadState.chaptersFailed})`;
    }

    sendPopupMessage("updateProgress", {
        value: progress,
        text: statusText
    });
}

function sendFinalStatus(success, message) {
    sendPopupMessage("downloadComplete", {
        success: success,
        message: message,
        totalChaptersProcessed: currentDownloadState.chaptersProcessed,
        totalChaptersSucceeded: currentDownloadState.chaptersSucceeded, // Renamed for clarity
        totalChaptersFailed: currentDownloadState.chaptersFailed,
        totalChaptersRequested: currentDownloadState.chaptersRequested
    });
    // Reset state AFTER sending message
    currentDownloadState.isActive = false;
    currentDownloadState.activeTabIds.clear();
}


// --- Fetch Single Image with Retries ---
// (Identical to the original - no changes needed here)
async function fetchSingleImage(imageUrl, logPrefix) {
    let retries = IMAGE_FETCH_RETRIES;
    let delay = IMAGE_RETRY_DELAY_MS;
    let lastError = null;

    while (retries >= 0) {
        const attempt = IMAGE_FETCH_RETRIES - retries + 1;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

            const response = await fetch(imageUrl, {
                mode: 'cors', // Usually needed for cross-origin images
                signal: controller.signal
            });
            clearTimeout(timeoutId); // Clear timeout if fetch completes

            if (!response.ok) {
                if ((response.status === 429 || response.status >= 500) && retries > 0) {
                    throw new Error(`HTTP ${response.status} (Retryable)`);
                } else {
                    throw new Error(`HTTP error ${response.status}`);
                }
            }

            const blob = await response.blob();
            if (!blob || !blob.type || !blob.type.startsWith('image/')) {
                throw new Error(`Invalid image data received (Type: ${blob?.type})`);
            }
            return blob;

        } catch (error) {
            lastError = error;
            if (retries > 0 && (error.name === 'AbortError' || error.message.includes('Failed to fetch') || error.message.includes('Retryable'))) {
                console.warn(`${logPrefix} Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms... (${retries} left)`);
                await sleep(delay);
                delay *= 2; // Exponential backoff (optional)
                retries--;
            } else {
                console.error(`${logPrefix} Final fetch failed after ${attempt} attempts: ${error.message}`);
                return null; // Indicate failure
            }
        }
    }
    console.error(`${logPrefix} Fetch failed with no retries: ${lastError?.message}`);
    return null;
}

// --- Trigger Single Chapter ZIP Download ---
async function triggerChapterZipDownload(chapterZip, zipFilename, chapterLogPrefix, chapterDataForUi) {
    let zipBlob = null;
    let zipDataUrl = null;
    try {
        console.log(`${chapterLogPrefix} Generating ZIP blob for ${zipFilename}...`);
        sendPopupMessage("updateChapterStatus", {
            ...chapterDataForUi,
            status: "zipping",
            message: `Compressing...`
        });

        zipBlob = await chapterZip.generateAsync(
            {
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: ZIP_COMPRESSION_LEVEL }
            },
            (metadata) => { // Optional progress for zipping (less crucial for single chapters)
                const percent = metadata.percent.toFixed(0);
                if (percent > 0 && percent % 25 === 0) { // Update less often
                     sendPopupMessage("updateChapterStatus", {
                        ...chapterDataForUi,
                        status: "zipping",
                        message: `Compressing ${percent}%...`
                    });
                }
            }
        );

        console.log(`${chapterLogPrefix} ZIP blob generated (${(zipBlob.size / 1024).toFixed(1)} KB).`);
        sendPopupMessage("updateChapterStatus", {
            ...chapterDataForUi,
            status: "downloading",
            message: `Starting download...`
        });

        // Convert blob to data URL for download API
        zipDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = (e) => reject(new Error(`FileReader failed: ${e.target.error}`));
            reader.readAsDataURL(zipBlob);
        });
        zipBlob = null;

        // Trigger download
        const downloadId = await chrome.downloads.download({
            url: zipDataUrl,
            filename: zipFilename,
            saveAs: false // Let browser handle duplicates etc.
        });

        if (!downloadId) {
            throw new Error("Download initiation failed (chrome.downloads.download returned undefined).");
        }
        console.log(`${chapterLogPrefix} Download initiated with ID: ${downloadId} for ${zipFilename}`);
        return { success: true, downloadId: downloadId };

    } catch (error) {
        console.error(`${chapterLogPrefix} Failed to generate or download ZIP: ${error.message}`);
        sendPopupMessage("updateChapterStatus", {
            ...chapterDataForUi,
            status: "failed",
            message: `ZIP/Download Error!`
        });
        return { success: false, error: error.message };
    } finally {
        zipDataUrl = null;
        zipBlob = null;
        console.log(`${chapterLogPrefix} triggerChapterZipDownload cleanup executed.`)
    }
}


// --- Process Single Chapter (Downloads its own ZIP) ---
// Removed batchZip parameter
async function processSingleChapter(chapter, chapterIndex, totalChapters, seriesTitle) {
    let chapterTab = null;
    let chapterTabId = null;
    const chapterLogPrefix = `[Ch ${chapterIndex + 1}/${totalChapters} "${chapter.name}"]`;
    // Keep sanitizing the name part for the filename
    const sanitizedChapterNamePart = sanitizeFilename(chapter.name || `Chapter_${chapterIndex + 1}`, true);
    const chapterDataForUi = { chapterId: chapter.url, chapterName: chapter.name };

    let chapterZip = null;
    let imageUrls = null;
    let validImageUrls = null;

    console.log(`${chapterLogPrefix} Starting processing...`);
    sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "starting", message: "Opening tab..." });

    try {
        // 1. Open chapter tab
        // (Code identical to original - creating tab, waiting for load)
        console.log(`${chapterLogPrefix} Creating tab for URL: ${chapter.url}`);
        chapterTab = await chrome.tabs.create({ url: chapter.url, active: false });
        chapterTabId = chapterTab.id;
        if (!chapterTabId) throw new Error("Failed to create tab.");
        currentDownloadState.activeTabIds.add(chapterTabId);
        console.log(`${chapterLogPrefix} Created tab ID: ${chapterTabId}`);
        sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "loading", message: "Waiting for page..." });

        await new Promise((resolve, reject) => {
            const listener = (tabId, changeInfo, tab) => {
                if (tabId === chapterTabId && changeInfo.status === 'complete') {
                    if (tab.url && (tab.url.startsWith(chapter.url.substring(0,30)) || tab.url.includes("chapter") || tab.url.includes(sanitizeFilename(chapter.name || '').substring(0,10)))) {
                        console.log(`${chapterLogPrefix} Tab ${chapterTabId} loaded successfully at ${tab.url}`);
                        clearTimeout(timeoutId);
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                     } else {
                        console.warn(`${chapterLogPrefix} Tab ${chapterTabId} loaded but URL changed unexpectedly to: ${tab.url} (Original: ${chapter.url})`);
                        clearTimeout(timeoutId);
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve(); // Still resolve, let scraping fail if it's wrong page
                     }
                } else if (tabId === chapterTabId && (changeInfo.status === 'error' || tab.status === 'unloaded')) {
                     console.error(`${chapterLogPrefix} Tab ${chapterTabId} encountered error or unloaded during load.`);
                     clearTimeout(timeoutId);
                     chrome.tabs.onUpdated.removeListener(listener);
                     reject(new Error(`Tab failed to load (status: ${changeInfo.status || tab.status})`));
                }
            };
            const timeoutId = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                console.error(`${chapterLogPrefix} Timeout waiting for tab ${chapterTabId} to load.`);
                chrome.tabs.remove(chapterTabId).catch(()=>{/*ignore*/});
                currentDownloadState.activeTabIds.delete(chapterTabId);
                reject(new Error(`Timeout loading tab (${(TAB_LOAD_TIMEOUT_MS / 1000)}s)`));
            }, TAB_LOAD_TIMEOUT_MS);
            chrome.tabs.onUpdated.addListener(listener);
        });

        // 2. Inject content script and get images
        // (Code identical to original - injecting, sending message, waiting for response)
        sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "scraping", message: "Finding images..." });
        console.log(`${chapterLogPrefix} Injecting scraper into tab ${chapterTabId}`);
        let imageUrls = [];
        try {
             try {
                 await chrome.scripting.executeScript({ target: { tabId: chapterTabId }, files: ['chapterScraper.js'] });
             } catch (injectionError) {
                 console.error(`${chapterLogPrefix} Failed to inject script into tab ${chapterTabId}: ${injectionError.message}`);
                 throw new Error(`Script injection failed: ${injectionError.message}`);
             }
             console.log(`${chapterLogPrefix} Scraper injected. Requesting images...`);
             imageUrls = await new Promise((resolve, reject) => {
                 const timeoutId = setTimeout(() => { delete chapterScraperPromises[chapterTabId]; reject(new Error(`Timeout waiting for scraper response (${(SCRIPT_RESPONSE_TIMEOUT_MS / 1000)}s)`)); }, SCRIPT_RESPONSE_TIMEOUT_MS);
                 chapterScraperPromises[chapterTabId] = { resolve, reject, timeoutId };
                 chrome.tabs.sendMessage(chapterTabId, { action: "getChapterImages" })
                     .catch(err => { clearTimeout(timeoutId); delete chapterScraperPromises[chapterTabId]; reject(new Error(`Content script communication failed: ${err.message}`)); });
             });
             if (!Array.isArray(imageUrls)) throw new Error("Content script did not return a valid image URL array.");
             console.log(`${chapterLogPrefix} Received ${imageUrls.length} image URLs from scraper.`);
        } catch (scriptError) {
            console.error(`${chapterLogPrefix} Failed to inject script or get response: ${scriptError.message}`);
            throw new Error(`Scraping failed: ${scriptError.message}`);
        }

        validImageUrls = imageUrls.filter(url => url && typeof url === 'string' && url.startsWith('http'));
        const totalImagesToFetch = validImageUrls.length;

        if (totalImagesToFetch === 0) {
             console.warn(`${chapterLogPrefix} No valid image URLs found by scraper.`);
             sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "skipped", message: "No images found" });
             return { status: 'skipped', chapterName: sanitizedChapterNamePart, message: "No images found" };
        }
        console.log(`${chapterLogPrefix} Found ${totalImagesToFetch} valid URLs. Starting download...`);

        // --- MODIFIED: Create Chapter-Specific ZIP and Folder (Natural Numbering) ---
        chapterZip = new JSZip();
        // Extract the chapter number string (e.g., "1", "10.5", "123")
        const chapterNumberStr = extractChapterNumber(chapter.name, chapterIndex);
        // *** CHANGE: Use the raw chapter number string for the internal folder name ***
        const internalFolderName = chapterNumberStr;

        // Create the folder inside this chapter's zip
        const numberedFolder = chapterZip.folder(internalFolderName);
        if (!numberedFolder) {
             throw new Error(`Failed to create internal zip folder: ${internalFolderName}`);
        }
        console.log(`${chapterLogPrefix} Created internal zip folder: ${internalFolderName}`);

        sendPopupMessage("updateChapterStatus", {
             ...chapterDataForUi,
             status: "fetching",
             message: `Downloading 0/${totalImagesToFetch}...`
        });

        // 3. Download images for the chapter and add to the chapter-specific zip
        let downloadedCount = 0;
        let failedImageCount = 0;
        for (let i = 0; i < totalImagesToFetch; i++) {
            const imageUrl = validImageUrls[i];
            const imageLogPrefix = `${chapterLogPrefix} Img ${i + 1}/${totalImagesToFetch}`;
            let blob = null;
            try {
                if (blob) {
                    // Determine file extension (code identical)
                    let fileExtension = 'jpg';
                    // ... (mime type / URL extension logic remains the same) ...
                    if (blob.type && blob.type.startsWith('image/')) {
                        const subtype = blob.type.split('/')[1];
                        if (subtype && ['jpeg', 'png', 'gif', 'webp', 'bmp'].includes(subtype)) {
                            fileExtension = subtype === 'jpeg' ? 'jpg' : subtype;
                        }
                    } else {
                        try { /* URL fallback */
                            const urlPath = new URL(imageUrl).pathname;
                            const lastDot = urlPath.lastIndexOf('.');
                            if (lastDot > 0 && lastDot < urlPath.length - 1) {
                                const ext = urlPath.substring(lastDot + 1).toLowerCase();
                                if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
                                    fileExtension = ext === 'jpeg' ? 'jpg' : ext;
                                }
                            }
                        } catch (urlParseError) { /* ignore */ }
                    }
                    // *** KEEP PADDING for image filenames ***
                    const imageFilename = `${padNumber(i + 1, 3)}.${fileExtension}`;

                    try {
                        // Add to numbered folder in chapterZip
                        numberedFolder.file(imageFilename, blob, { binary: true });
                        downloadedCount++;
                        if (downloadedCount % 5 === 0 || downloadedCount === totalImagesToFetch) {
                            sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "fetching", message: `Downloading ${downloadedCount}/${totalImagesToFetch}...` });
                        }
                    } catch (zipFileError) {
                        console.error(`${imageLogPrefix} Error adding file to zip: ${zipFileError}`);
                        failedImageCount++;
                        sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "error", message: `Zip error for img ${i + 1}!` });
                    }
                } else {
                    failedImageCount++;
                    sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "error", message: `Failed img ${i + 1}/${totalImagesToFetch}` });
                }
            } finally {

            }
        } // End image fetch loop

        // 4. Finalize chapter status based on image fetching
        if (downloadedCount === 0 && totalImagesToFetch > 0) {
            console.error(`${chapterLogPrefix} All ${totalImagesToFetch} images failed to download.`);
            sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "failed", message: "All images failed" });
            return { status: 'failed', chapterName: sanitizedChapterNamePart, failedImages: failedImageCount, message: "All images failed" };
        }

        const partialSuccess = failedImageCount > 0;
        const statusMsg = partialSuccess ? `Done (${failedImageCount} failed)` : "Images downloaded";
        console.log(`${chapterLogPrefix} Finished image fetching. ${statusMsg}`);
        sendPopupMessage("updateChapterStatus", {
            ...chapterDataForUi,
            status: partialSuccess ? "complete_partial" : "complete_fetch",
            message: statusMsg
        });

        // 5. --- NEW: Generate and Trigger Download for THIS chapter's ZIP ---
        const sanitizedSeriesTitle = sanitizeFilename(seriesTitle || 'WebtoonScan_Download', true);
        // *** CHANGE: Use the raw chapterNumberStr in the filename, not padded ***
        const zipFilename = `${sanitizedSeriesTitle}_Ch_${chapterNumberStr}_(${sanitizedChapterNamePart}).zip`;

        // Trigger the download for THIS chapter's ZIP
        const downloadResult = await triggerChapterZipDownload(chapterZip, zipFilename, chapterLogPrefix, chapterDataForUi);

        if (downloadResult.success) {
             const finalMessage = partialSuccess ? `Downloaded (${failedImageCount} img failed)` : "Downloaded";
             sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status: "complete", message: finalMessage });
             console.log(`${chapterLogPrefix} Successfully initiated download for ${zipFilename}`);
             return { status: 'success', chapterName: sanitizedChapterNamePart, failedImages: failedImageCount };
        } else {
             console.error(`${chapterLogPrefix} Failed to initiate download for ${zipFilename}. Error: ${downloadResult.error}`);
             return { status: 'failed', chapterName: sanitizedChapterNamePart, failedImages: failedImageCount, message: `Download failed: ${downloadResult.error}` };
        }

    } catch (error) {
        console.error(`${chapterLogPrefix} Error processing chapter:`, error);
        sendPopupMessage("updateChapterStatus", {
            ...chapterDataForUi,
            status: "failed",
            message: `Error: ${error.message.substring(0, 50)}...`
        });
        return { status: 'failed', chapterName: sanitizedChapterNamePart, error: error.message };

    } finally {
        // 6. Close the tab (Identical to original)
        if (chapterTabId) {
            try {
                 await chrome.tabs.remove(chapterTabId);
                 console.log(`${chapterLogPrefix} Closed tab ${chapterTabId}.`);
            } catch (removeError) {
                 if (removeError.message && !removeError.message.includes("No tab with id")) {
                     console.warn(`${chapterLogPrefix} Could not remove tab ${chapterTabId}: ${removeError.message}`);
                 }
            }
             currentDownloadState.activeTabIds.delete(chapterTabId);
             delete chapterScraperPromises[chapterTabId];
        }
        // --- EXPLICIT CLEANUP ---
        // Release references to potentially large objects for this chapter
        chapterZip = null;
        imageUrls = null;
        validImageUrls = null;
        console.log(`${chapterLogPrefix} processSingleChapter cleanup executed.`);
        // --- END EXPLICIT CLEANUP ---
        await sleep(DELAY_AFTER_TASK_FINISH_MS);
    }
}


// --- Batch Download Orchestrator (Manages Tasks) ---
async function handleBatchDownload(chapters, title) {
    // Initial checks (identical to original)
    if (currentDownloadState.isActive) {
        console.warn("Batch download requested while another is active. Ignoring.");
        sendPopupMessage("error", { message: "Another download is already in progress." });
        return;
    }
     if (!chapters || chapters.length === 0) {
        console.error("Batch download requested with no chapters.");
        sendPopupMessage("error", { message: "No chapters selected." });
        return;
    }
     if (typeof JSZip === 'undefined') {
         console.error("JSZip is not loaded. Cannot start download.");
         sendPopupMessage("error", { message: "Fatal Error: JSZip library not loaded." });
         return;
     }

    console.log(`[Batch] Starting individual chapter downloads for ${chapters.length} chapters. Title: ${title}`);
    currentDownloadState.isActive = true;
    currentDownloadState.chaptersRequested = chapters.length;
    currentDownloadState.chaptersProcessed = 0;
    currentDownloadState.chaptersSucceeded = 0; // Downloads initiated
    currentDownloadState.chaptersFailed = 0;    // Failed or skipped
    currentDownloadState.title = title;
    currentDownloadState.activeTabIds.clear();
    chapterScraperPromises = {};

    sendPopupMessage("downloadStarted", { totalChapters: chapters.length, title: title });
    updateOverallProgress(`Preparing... 0/${chapters.length}`);

    // --- NO master batchZip needed anymore ---
    // const sanitizedTitle = sanitizeFilename(title || 'WebtoonScan_Download', true); // Still need title for filenames


    // --- Concurrency Control (largely the same) ---
    let chapterQueue = [...chapters];
    let activeTasks = 0;
    let chapterResults = new Array(chapters.length).fill(null); // Store results { status, chapterName, ... }

    const runTask = async () => {
        while (chapterQueue.length > 0 || activeTasks > 0) {
            while (chapterQueue.length > 0 && activeTasks < MAX_CONCURRENT_TABS) {
                activeTasks++;
                const chapter = chapterQueue.shift();
                // Calculate original index carefully
                const chapterIndex = chapters.findIndex(c => c.url === chapter?.url); // Find index based on original array

                if (chapterIndex === -1 || !chapter || !chapter.url || !chapter.name) {
                     console.warn(`[Batch] Skipping invalid chapter data:`, chapter);
                     const pseudoIndex = currentDownloadState.chaptersProcessed; // Use processed count as fallback index
                     currentDownloadState.chaptersProcessed++;
                     currentDownloadState.chaptersFailed++; // Count invalid as failed/skipped
                     chapterResults[pseudoIndex] = { status: 'skipped', chapterName: `Invalid_${pseudoIndex + 1}` };
                     activeTasks--;
                     updateOverallProgress();
                     continue;
                }

                console.log(`[Batch] Starting task ${chapterIndex + 1}/${chapters.length} for Ch "${chapter.name}". Active: ${activeTasks}`);
                updateOverallProgress(`Processing Ch. ${chapter.name}... (${activeTasks} active)`);

                // Process the chapter asynchronously (which now includes zipping and download)
                (async () => {
                    let result;
                    try {
                        // Pass series title for filename generation
                        result = await processSingleChapter(chapter, chapterIndex, chapters.length, currentDownloadState.title);
                    } catch (error) {
                        console.error(`[Batch] UNEXPECTED error from processSingleChapter for Ch ${chapter.name} (Index: ${chapterIndex}):`, error);
                        result = { status: 'failed', chapterName: chapter.name, error: `Unexpected Orchestrator Error: ${error.message}` };
                    } finally {
                        chapterResults[chapterIndex] = result || { status: 'failed', chapterName: chapter.name, error: 'Task finished without result' };
                        currentDownloadState.chaptersProcessed++;

                        // Update counts based on the *final* status of the chapter process
                        if (result?.status === 'success') {
                            currentDownloadState.chaptersSucceeded++; // Download initiated
                        } else { // Includes 'failed', 'skipped', or undefined result
                            currentDownloadState.chaptersFailed++;
                        }

                        const statusMsg = result?.status === 'success' ? `✅ Download Init.` :
                                          result?.status === 'failed' ? `❌ Failed` :
                                          result?.status === 'skipped' ? `⚠️ Skipped` : `❔ Unknown`;
                        console.log(`[Batch] Finished task ${chapterIndex + 1}. Status: ${result?.status || 'failed'}. Chapter: ${chapter.name}`);
                        updateOverallProgress(`${statusMsg}: Ch. ${chapter.name}`);

                        activeTasks--;
                        console.log(`[Batch] Task slot released. Active tasks: ${activeTasks}`);
                    }
                })(); // End IIAFE

                await sleep(DELAY_BETWEEN_TASK_START_MS);
            } // End inner while loop (task starting)

            if (activeTasks > 0) {
                updateOverallProgress(`Waiting for ${activeTasks} tasks...`);
                await sleep(500);
            }
        }
    }; // End runTask definition

    try {
         await runTask();
         console.log("[Batch] All chapter processing tasks finished.");
         updateOverallProgress("Finalizing...");

         // --- Finalize Batch (No single ZIP generation) ---
         const successfulDownloads = currentDownloadState.chaptersSucceeded;
         const failedOrSkipped = currentDownloadState.chaptersFailed;

         if (successfulDownloads === 0) {
             console.warn("[Batch] No chapter downloads were successfully initiated.");
             throw new Error(`Failed to initiate download for any chapters (Failed/Skipped: ${failedOrSkipped}).`);
         }

         // Report overall success/failure
         const finalMessage = `✅ Batch Complete: Initiated ${successfulDownloads}/${chapters.length} chapter downloads. Failed/Skipped: ${failedOrSkipped}. Check your browser downloads.`;
         console.log(`[Batch] ${finalMessage}`);
         sendFinalStatus(true, finalMessage); // Report overall process as success if at least one started

    } catch (error) {
         // This catches errors in the runTask loop itself, or the final check failure.
         console.error("[Batch] Critical error during batch processing:", error);
         const finalMessage = `❌ Batch Failed: ${error.message}`;
         sendFinalStatus(false, finalMessage);
    } finally {
         // Cleanup (identical to original - reset state, close lingering tabs)
         currentDownloadState.isActive = false;
         if (currentDownloadState.activeTabIds.size > 0) {
              console.warn(`[Batch] Attempting to clean up ${currentDownloadState.activeTabIds.size} potentially orphaned tabs...`);
              for (const tabId of currentDownloadState.activeTabIds) {
                   chrome.tabs.remove(tabId).catch(e => { /* Ignore */ });
              }
              currentDownloadState.activeTabIds.clear();
         }
         chapterScraperPromises = {};
         console.log("[Batch] Orchestration finished.");
    }
}


// --- Message Listener ---
// (Almost identical to original, just logging confirms the action)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let messageHandled = false;

    if (message.action === "chapterImagesResponse") {
        const tabId = sender.tab?.id;
        if (tabId && chapterScraperPromises[tabId]) {
            const { resolve, reject, timeoutId } = chapterScraperPromises[tabId];
            clearTimeout(timeoutId);
            if (message.payload?.imageUrls && Array.isArray(message.payload.imageUrls)) {
                // console.log(`[Msg Listener] Received ${message.payload.imageUrls.length} images from Tab ${tabId}`);
                resolve(message.payload.imageUrls);
            } else {
                const errorMsg = message.payload?.error || "Invalid image data from content script";
                console.error(`[Msg Listener] Invalid response/error from Tab ${tabId}:`, errorMsg);
                reject(new Error(errorMsg));
            }
            delete chapterScraperPromises[tabId];
        } else {
            console.warn(`[Msg Listener] Received chapterImagesResponse for unknown/closed Tab ${tabId}.`, message);
        }
        messageHandled = true;

    } else if (message.action === "startDownload") {
        console.log("[Msg Listener] Received startDownload request.");
        const { chapters, title } = message;
        handleBatchDownload(chapters, title); // Async, no sendResponse needed
        messageHandled = true;

    } else if (message.action === "scraperError") {
        const tabId = sender.tab?.id;
        if (tabId && chapterScraperPromises[tabId]) {
            const { reject, timeoutId } = chapterScraperPromises[tabId];
            clearTimeout(timeoutId);
            const errorMsg = message.payload?.error || "Unknown scraper error reported";
            console.error(`[Msg Listener] Received scraperError from Tab ${tabId}:`, errorMsg);
            reject(new Error(errorMsg));
            delete chapterScraperPromises[tabId];
        } else {
            console.warn(`[Msg Listener] Received scraperError for unknown/closed Tab ${tabId}.`, message);
        }
        messageHandled = true;
    }

    // Return false as we are not using sendResponse asynchronously here.
    return false;
});

// --- Service Worker Lifecycle & Keep Alive ---
// (Identical to original)
chrome.runtime.onInstalled.addListener(details => {
    console.log('WebtoonScan Downloader (Individual Zips) installed/updated.', details.reason);
    currentDownloadState = { isActive: false, chaptersRequested: 0, chaptersProcessed: 0, chaptersSucceeded: 0, chaptersFailed: 0, title: '', activeTabIds: new Set() };
    chapterScraperPromises = {};
    chrome.storage.local.clear();
});

chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'keepAlive') {
    // console.log("[KeepAlive Alarm] Ping.");
  }
});

console.log("[Background] Event listeners registered.");