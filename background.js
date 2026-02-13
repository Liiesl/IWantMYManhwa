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

// --- Load Site Adapters ---
try {
    importScripts(
        'sites/SiteAdapter.js',
        'sites/webtoonscan/WebtoonscanContentAdapter.js',
        'sites/webtoonscan/WebtoonscanAdapter.js',
        'sites/SiteRegistry.js'
    );
    console.log("Site adapters loaded successfully.");
    
    // Initialize registry
    if (typeof siteRegistry !== 'undefined') {
        siteRegistry.initialize();
    }
} catch (e) {
    console.error("Failed to load site adapters:", e);
}

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
    isPaused: false,
    isStopped: false,
    chaptersRequested: 0,
    chaptersProcessed: 0, // Includes success, skipped, failed
    chaptersSucceeded: 0, // Chapters where download was *initiated*
    chaptersFailed: 0,    // Chapters that failed processing OR download initiation
    chaptersCancelled: 0, // Chapters cancelled by user
    title: '',
    activeTabIds: new Set(), // Track tabs we opened
    chapterQueue: [] // Queue of remaining chapters
};
let chapterScraperPromises = {}; // { tabId: { resolve, reject, timeoutId } } for scraper response
let imageTabPromises = {}; // { tabId: { resolve, reject, timeoutId } } for image tab completion

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

function sendPauseNotification() {
    sendPopupMessage("downloadPaused", {
        chaptersRemaining: currentDownloadState.chapterQueue.length,
        chaptersProcessed: currentDownloadState.chaptersProcessed,
        chaptersRequested: currentDownloadState.chaptersRequested
    });
}

function sendResumeNotification() {
    sendPopupMessage("downloadResumed", {
        chaptersRemaining: currentDownloadState.chapterQueue.length
    });
}

function sendStopNotification() {
    sendPopupMessage("downloadStopped", {
        totalChaptersSucceeded: currentDownloadState.chaptersSucceeded,
        totalChaptersRequested: currentDownloadState.chaptersRequested,
        totalChaptersCancelled: currentDownloadState.chaptersCancelled
    });
}

function updateOverallProgress(textOverride = null) {
    if (currentDownloadState.isStopped) return; // Don't update progress if stopped
    
    const progress = currentDownloadState.chaptersRequested > 0
        ? Math.floor((currentDownloadState.chaptersProcessed / currentDownloadState.chaptersRequested) * 100)
        : 0;
    
    let statusText = textOverride || `Processed ${currentDownloadState.chaptersProcessed}/${currentDownloadState.chaptersRequested}...`;

    if (!textOverride && currentDownloadState.chaptersRequested > 0) {
         statusText += ` (Initiated: ${currentDownloadState.chaptersSucceeded}, Failed/Skipped: ${currentDownloadState.chaptersFailed})`;
    }

    if (currentDownloadState.isPaused) {
        statusText = `PAUSED - ${statusText}`;
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

        // Create object URL for download (avoids base64 memory overhead)
        const objectUrl = URL.createObjectURL(zipBlob);
        zipBlob = null;

        // Trigger download
        const downloadId = await chrome.downloads.download({
            url: objectUrl,
            filename: zipFilename,
            saveAs: false
        });

        if (!downloadId) {
            URL.revokeObjectURL(objectUrl);
            throw new Error("Download initiation failed (chrome.downloads.download returned undefined).");
        }

        // Revoke URL after download starts (browser has copied the data)
        URL.revokeObjectURL(objectUrl);
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
        zipBlob = null;
        console.log(`${chapterLogPrefix} triggerChapterZipDownload cleanup executed.`)
    }
}


// --- Process Single Chapter (Downloads its own ZIP) ---
// Delegates to adapter for download logic
async function processSingleChapter(chapter, chapterIndex, totalChapters, seriesTitle, adapter) {
    const chapterLogPrefix = `[Ch ${chapterIndex + 1}/${totalChapters} "${chapter.name}"]`;
    const chapterDataForUi = { chapterId: chapter.url, chapterName: chapter.name };

    console.log(`${chapterLogPrefix} Starting processing...`);
    
    // Status update helper
    const updateStatus = (status, message) => {
        sendPopupMessage("updateChapterStatus", { ...chapterDataForUi, status, message });
    };

    updateStatus("starting", "Opening tab...");

    // If no adapter provided, try to get one from chapter URL
    if (!adapter && typeof siteRegistry !== 'undefined') {
        adapter = siteRegistry.findAdapterForUrl(chapter.url);
    }

    if (!adapter) {
        console.error(`${chapterLogPrefix} No adapter found for chapter URL: ${chapter.url}`);
        updateStatus("failed", "No adapter for this site");
        return { status: 'failed', chapterName: chapter.name, error: "No adapter found" };
    }

    console.log(`${chapterLogPrefix} Using adapter: ${adapter.name}`);

    // Delegate to adapter's downloadChapter method
    try {
        const result = await adapter.downloadChapter(
            { chapter, index: chapterIndex, activeTabIds: currentDownloadState.activeTabIds },
            seriesTitle,
            updateStatus,
            { sendPopupMessage }
        );
        return result;
    } catch (error) {
        console.error(`${chapterLogPrefix} Adapter download failed:`, error);
        updateStatus("failed", error.message);
        return { status: 'failed', chapterName: chapter.name, error: error.message };
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
    currentDownloadState.isPaused = false;
    currentDownloadState.isStopped = false;
    currentDownloadState.chaptersRequested = chapters.length;
    currentDownloadState.chaptersProcessed = 0;
    currentDownloadState.chaptersSucceeded = 0; // Downloads initiated
    currentDownloadState.chaptersFailed = 0;    // Failed or skipped
    currentDownloadState.chaptersCancelled = 0; // Cancelled by user
    currentDownloadState.title = title;
    currentDownloadState.activeTabIds.clear();
    currentDownloadState.chapterQueue = [...chapters]; // Store queue in state for pause handling
    chapterScraperPromises = {};

    sendPopupMessage("downloadStarted", { totalChapters: chapters.length, title: title });
    updateOverallProgress(`Preparing... 0/${chapters.length}`);

    // --- NO master batchZip needed anymore ---
    // const sanitizedTitle = sanitizeFilename(title || 'WebtoonScan_Download', true); // Still need title for filenames


    // --- Concurrency Control (largely the same) ---
    let activeTasks = 0;
    let chapterResults = new Array(chapters.length).fill(null); // Store results { status, chapterName, ... }

    const waitWhilePaused = async () => {
        while (currentDownloadState.isPaused && !currentDownloadState.isStopped) {
            await sleep(500);
        }
    };

    const runTask = async () => {
        while (currentDownloadState.chapterQueue.length > 0 || activeTasks > 0) {
            // Wait if paused
            await waitWhilePaused();
            
            // Check if stopped
            if (currentDownloadState.isStopped) {
                console.log("[Batch] Download stopped. Cancelling remaining chapters.");
                // Mark all remaining chapters as cancelled
                const remainingCount = currentDownloadState.chapterQueue.length;
                currentDownloadState.chaptersCancelled = remainingCount;
                currentDownloadState.chapterQueue = [];
                break;
            }

            while (currentDownloadState.chapterQueue.length > 0 && activeTasks < MAX_CONCURRENT_TABS) {
                // Wait if paused before starting new task
                await waitWhilePaused();
                
                if (currentDownloadState.isStopped) break;

                activeTasks++;
                const chapter = currentDownloadState.chapterQueue.shift();
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

                // Get adapter for this chapter
                let adapter = null;
                if (typeof siteRegistry !== 'undefined') {
                    adapter = siteRegistry.findAdapterForUrl(chapter.url);
                }

                if (!adapter) {
                    console.warn(`[Batch] No adapter found for chapter: ${chapter.url}`);
                    currentDownloadState.chaptersProcessed++;
                    currentDownloadState.chaptersFailed++;
                    chapterResults[chapterIndex] = { status: 'skipped', chapterName: chapter.name, error: "No adapter found" };
                    activeTasks--;
                    updateOverallProgress();
                    continue;
                }

                console.log(`[Batch] Using adapter: ${adapter.name} for chapter`);

                // Process the chapter asynchronously (which now includes zipping and download)
                (async () => {
                    let result;
                    try {
                        // Pass adapter to processSingleChapter
                        result = await processSingleChapter(chapter, chapterIndex, chapters.length, currentDownloadState.title, adapter);
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
                // Wait while paused or stopped
                await waitWhilePaused();
                
                if (currentDownloadState.isStopped) break;
                
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

         if (currentDownloadState.isStopped) {
             // Download was stopped by user
             const cancelled = currentDownloadState.chaptersCancelled;
             const finalMessage = `⬛ Download Stopped: Completed ${successfulDownloads}, Failed/Skipped ${failedOrSkipped}, Cancelled ${cancelled}.`;
             console.log(`[Batch] ${finalMessage}`);
             sendStopNotification();
             // Also send downloadComplete for cleanup
             currentDownloadState.isActive = false;
             if (currentDownloadState.activeTabIds.size > 0) {
                  for (const tabId of currentDownloadState.activeTabIds) {
                       chrome.tabs.remove(tabId).catch(e => { /* Ignore */ });
                  }
                  currentDownloadState.activeTabIds.clear();
             }
             chapterScraperPromises = {};
             return;
         }

         if (successfulDownloads === 0 && failedOrSkipped > 0) {
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
            console.warn(`[Msg Listener] Received scraperError for unknown/closed Tab ${tabId}:`, message);
        }
        messageHandled = true;

    } else if (message.action === "imageTabDone") {
        const tabId = sender.tab?.id;
        if (tabId && imageTabPromises[tabId]) {
            const { resolve, timeoutId } = imageTabPromises[tabId];
            clearTimeout(timeoutId);
            console.log(`[Msg Listener] Received imageTabDone from Tab ${tabId}:`, message.payload);
            resolve(message.payload);
            delete imageTabPromises[tabId];
        } else {
            console.warn(`[Msg Listener] Received imageTabDone for unknown Tab ${tabId}:`, message);
        }
        messageHandled = true;

    } else if (message.action === "pauseDownload") {
        console.log("[Msg Listener] Received pauseDownload request.");
        if (currentDownloadState.isActive && !currentDownloadState.isPaused && !currentDownloadState.isStopped) {
            currentDownloadState.isPaused = true;
            console.log("[Batch] Download paused. Waiting for active tasks to finish...");
            sendPauseNotification();
        }
        messageHandled = true;

    } else if (message.action === "resumeDownload") {
        console.log("[Msg Listener] Received resumeDownload request.");
        if (currentDownloadState.isActive && currentDownloadState.isPaused && !currentDownloadState.isStopped) {
            currentDownloadState.isPaused = false;
            console.log("[Batch] Download resumed.");
            sendResumeNotification();
        }
        messageHandled = true;

    } else if (message.action === "stopDownload") {
        console.log("[Msg Listener] Received stopDownload request.");
        if (currentDownloadState.isActive && !currentDownloadState.isStopped) {
            currentDownloadState.isStopped = true;
            currentDownloadState.isPaused = false; // Resume from pause if stopped
            console.log("[Batch] Download stop requested. Will stop after current tasks finish...");
            // Don't send stopNotification yet - it will be sent when all tasks complete
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
    currentDownloadState = { 
        isActive: false, 
        isPaused: false, 
        isStopped: false,
        chaptersRequested: 0, 
        chaptersProcessed: 0, 
        chaptersSucceeded: 0, 
        chaptersFailed: 0,
        chaptersCancelled: 0,
        title: '', 
        activeTabIds: new Set(),
        chapterQueue: []
    };
    chapterScraperPromises = {};
    chrome.storage.local.clear();
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'keepAlive') {
    // console.log("[KeepAlive Alarm] Ping.");
  }
});

console.log("[Background] Event listeners registered.");