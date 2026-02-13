// --- START OF FILE sidepanel.js ---

// sidepanel.js (Updated for Refactored Background)
'use strict';

// --- DOM Elements ---
const scanChaptersBtn = document.getElementById('scanChaptersBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadControls = document.getElementById('downloadControls');
const manhwaTitleEl = document.getElementById('manhwaTitle');
const chapterCountEl = document.getElementById('chapterCount');
const startChapterInput = document.getElementById('startChapter');
const endChapterInput = document.getElementById('endChapter');
const overallStatusMessageEl = document.getElementById('overallStatusMessage');
const overallProgressContainerEl = document.getElementById('overallProgressContainer');
const progressVisual = document.getElementById('progress-visual'); // Visible overall bar fill
const progressText = document.getElementById('progressText'); // Text for overall bar
const chapterProgressContainerEl = document.getElementById('chapterProgressContainer');

// --- State ---
let chapterList = []; // Sorted ASCENDING (Ch 1, Ch 2, ...)
let currentManhwaTitle = '';
let isDownloading = false;
let isPaused = false;
let isScanning = false;
let chapterUiElements = {}; // Store chapter UI elements { chapterId: { item, name, status, fill } }

// --- UI Update Functions ---

function setOverallStatus(message, isError = false, isComplete = false) {
    overallStatusMessageEl.textContent = message;
    overallStatusMessageEl.style.color = isError ? '#f44336' : (isComplete ? '#4CAF50' : 'var(--text-secondary)');
    console.log(`Overall Status Update: ${message}`);
}

// Only used for the final ZIP generation progress now
function updateOverallProgress(text, percent = -1) {
    overallProgressContainerEl.style.display = 'block'; // Ensure visible
    progressText.textContent = text;
    if (percent >= 0) {
        const clampedPercent = Math.min(100, Math.max(0, percent));
        progressVisual.style.width = `${clampedPercent}%`;
    } else {
        // Indeterminate state maybe? Or just text update.
        progressVisual.style.width = '0%'; // Or maybe hide width update?
    }
}

function hideOverallProgress() {
     overallProgressContainerEl.style.display = 'none';
     progressVisual.style.width = '0%';
     progressText.textContent = '';
}

function showDownloadControls() {
    downloadControls.style.display = 'flex';
    downloadBtn.style.display = 'none';
}

function hideDownloadControls() {
    downloadControls.style.display = 'none';
    downloadBtn.style.display = 'flex';
}

function setPauseState(paused) {
    isPaused = paused;
    const icon = pauseBtn.querySelector('.button-icon');
    const text = pauseBtn.querySelector('span:not(.button-icon)');
    if (paused) {
        pauseBtn.classList.add('paused');
        icon.innerHTML = '<i class="fas fa-play"></i>';
        text.textContent = 'Resume';
        setOverallStatus('Paused. Waiting for active tasks to finish...');
    } else {
        pauseBtn.classList.remove('paused');
        icon.innerHTML = '<i class="fas fa-pause"></i>';
        text.textContent = 'Pause';
        setOverallStatus('Resuming download...');
    }
}


function clearChapterProgress() {
    chapterProgressContainerEl.innerHTML = '';
    chapterUiElements = {};
}

function ensureChapterUi(payload) {
    const { chapterId, chapterName } = payload;
    if (!chapterUiElements[chapterId]) {
        const item = document.createElement('div');
        item.className = 'chapter-progress-item';
        item.dataset.chapterId = chapterId;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'chapter-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'chapter-name';
        nameSpan.textContent = chapterName || `Chapter ${chapterId.split('/').pop()?.split('-').pop() || 'Unknown'}`;
        nameSpan.title = chapterName || chapterId; // Tooltip for long names

        const statusSpan = document.createElement('span');
        statusSpan.className = 'chapter-status';
        statusSpan.textContent = 'Waiting...'; // Initial status

        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(statusSpan);

        const trackDiv = document.createElement('div');
        trackDiv.className = 'chapter-progress-track';

        const fillDiv = document.createElement('div');
        fillDiv.className = 'chapter-progress-fill';

        trackDiv.appendChild(fillDiv);

        item.appendChild(infoDiv);
        item.appendChild(trackDiv);

        // Insert in order (or append if simple) - appending is easier
        chapterProgressContainerEl.appendChild(item);

        chapterUiElements[chapterId] = {
            item: item,
            name: nameSpan,
            status: statusSpan,
            fill: fillDiv,
            track: trackDiv
        };
        // Scroll to bottom to show new item if list is long
        chapterProgressContainerEl.scrollTop = chapterProgressContainerEl.scrollHeight;
    }
    // Update chapter name if it wasn't available initially or changed
    if (chapterName && chapterUiElements[chapterId] && chapterUiElements[chapterId].name.textContent !== chapterName) {
        chapterUiElements[chapterId].name.textContent = chapterName;
        chapterUiElements[chapterId].name.title = chapterName;
    }
    return chapterUiElements[chapterId];
}

function updateChapterUi(payload) {
    const { chapterId, status, message } = payload; // Note: No fetched/total in new structure
    const ui = ensureChapterUi(payload);

    ui.status.textContent = message || status; // Display detailed message
    ui.item.className = 'chapter-progress-item'; // Reset classes
    ui.fill.style.backgroundColor = 'var(--accent-color)'; // Reset color
    ui.fill.style.width = '0%'; // Reset width, update based on status

    switch (status) {
        case 'starting':
        case 'loading':
             ui.fill.style.width = '5%'; // Small indicator
             break;
        case 'scraping':
            ui.fill.style.width = '20%';
            break;
        case 'fetching':
            // We don't get granular image progress anymore, show indeterminate/partial progress
            ui.fill.style.width = '50%';
             // Maybe parse message like "Downloading 10/20"? Requires background change.
             // For now, just show 50% during fetch phase.
            break;
        case 'complete':
            ui.item.classList.add('completed');
            ui.fill.style.width = '100%';
            ui.fill.style.backgroundColor = '#4CAF50';
            break;
         case 'complete_partial': // Handle partial success if background sends it
             ui.item.classList.add('completed'); // Still mark as complete visually
             ui.fill.style.width = '100%';
             ui.fill.style.backgroundColor = '#ff9800'; // Orange for partial? Or keep green?
             break;
        case 'failed':
        case 'error': // Treat 'error' status similar to 'failed'
            ui.item.classList.add('failed');
            ui.fill.style.width = '100%';
            ui.fill.style.backgroundColor = '#f44336';
            break;
         case 'skipped':
             ui.item.classList.add('skipped'); // Optional: Add a specific style for skipped
             ui.fill.style.width = '100%';
             ui.fill.style.backgroundColor = '#9E9E9E'; // Grey for skipped
             break;
        case 'pending':
        default:
            ui.fill.style.width = '0%';
            break;
    }
}

// --- Event Listeners ---

scanChaptersBtn.addEventListener('click', async () => {
    if (isScanning || isDownloading) return;
    isScanning = true;
    scanChaptersBtn.disabled = true;
    downloadBtn.disabled = true;
    hideOverallProgress();
    setOverallStatus('Scanning...');
    chapterList = []; // Reset
    manhwaTitleEl.textContent = '---';
    chapterCountEl.textContent = '0';
    startChapterInput.value = 1;
    endChapterInput.value = 1;
    clearChapterProgress();

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && tab.url.includes("webtoonscan.com/manhwa/")) {
            // Inject content script dynamically to ensure it's loaded
            console.log('Injecting content script...');
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                console.log('Content script injected successfully');
            } catch (injectError) {
                // Script might already be injected, which is fine
                console.log('Content script injection result:', injectError?.message || 'Already injected or failed');
            }

            console.log('Sending getChapters request to content script...');
            const response = await chrome.tabs.sendMessage(tab.id, { action: "getChapters" });
            console.log('Received response from content script:', response);

            // Check the action name returned by content.js
            if (response && response.action === "chaptersFound" && response.chapters && response.chapters.length > 0) {
                 // Sort chapters numerically ASCENDING
                response.chapters.sort((a, b) => {
                    const numA = parseFloat(a.name.match(/^[\d\.]+/)?.[0] || a.name);
                    const numB = parseFloat(b.name.match(/^[\d\.]+/)?.[0] || b.name);
                    return (!isNaN(numA) && !isNaN(numB)) ? numA - numB : a.name.localeCompare(b.name);
                });

                chapterList = response.chapters;
                currentManhwaTitle = response.title || 'Unknown Title';
                manhwaTitleEl.textContent = currentManhwaTitle;
                chapterCountEl.textContent = chapterList.length;

                startChapterInput.min = 1;
                startChapterInput.max = chapterList.length;
                startChapterInput.value = 1;
                endChapterInput.min = 1;
                endChapterInput.max = chapterList.length;
                endChapterInput.value = chapterList.length;

                downloadBtn.disabled = false;
                setOverallStatus(`Found ${chapterList.length} chapters. Ready.`);

            } else if (response && response.action === "chaptersFound") {
                 setOverallStatus('No chapters found on this page.', true);
                 console.warn("Content script returned empty chapter list.");
            } else {
                setOverallStatus(`Could not get chapters. ${response?.message || 'Invalid response.'}`, true);
                console.error("Invalid or error response from content script:", response);
            }
        } else {
            setOverallStatus('Not on a webtoonscan.com/manhwa/ page.', true);
             chapterList = [];
             currentManhwaTitle = '';
        }
    } catch (error) {
        setOverallStatus(`Error scanning: ${error.message.substring(0, 100)}...`, true);
        console.error("Error during scanning:", error);
         chapterList = [];
         currentManhwaTitle = '';
    } finally {
        isScanning = false;
        scanChaptersBtn.disabled = false;
        if (chapterList.length === 0) {
            downloadBtn.disabled = true;
        }
    }
});

downloadBtn.addEventListener('click', () => {
    if (isDownloading || isScanning || chapterList.length === 0) {
        // Provide feedback if needed
        return;
    }

    const startChap = parseInt(startChapterInput.value, 10);
    const endChap = parseInt(endChapterInput.value, 10);
    const maxChap = chapterList.length;

    if (isNaN(startChap) || isNaN(endChap) || startChap < 1 || endChap < 1 || startChap > maxChap || endChap > maxChap || startChap > endChap) {
        setOverallStatus(`Invalid chapter range (1-${maxChap}).`, true);
        return;
    }

    const startIndex = startChap - 1;
    const endIndex = endChap; // slice end index is exclusive
    const chaptersToDownload = chapterList.slice(startIndex, endIndex);

    if (chaptersToDownload.length === 0) {
        setOverallStatus("No chapters selected in the specified range.", true);
        return;
    }

    isDownloading = true;
    isPaused = false;
    downloadBtn.disabled = true;
    scanChaptersBtn.disabled = true;
    clearChapterProgress();
    hideOverallProgress(); // Hide overall bar initially
    showDownloadControls();
    setOverallStatus(`Starting download for ${chaptersToDownload.length} chapters...`);

    // Pre-populate UI
    chaptersToDownload.forEach(chap => {
        ensureChapterUi({ chapterId: chap.url, chapterName: chap.name });
        updateChapterUi({ chapterId: chap.url, chapterName: chap.name, status: 'pending', message: 'Queued...' });
    });

    console.log(`Requesting download for chapters ${startChap} to ${endChap}`);
    // Send message to the REFFACTORED background script
    chrome.runtime.sendMessage({
        action: "startDownload",
        chapters: chaptersToDownload,
        title: currentManhwaTitle
    }).catch(error => {
         console.error("Error sending startDownload message:", error);
         setOverallStatus(`Error starting download: ${error.message}`, true);
         isDownloading = false;
         isPaused = false;
         hideDownloadControls();
         downloadBtn.style.display = 'flex';
         downloadBtn.disabled = (chapterList.length === 0);
         scanChaptersBtn.disabled = false;
    });
});

pauseBtn.addEventListener('click', () => {
    if (!isDownloading) return;
    
    if (isPaused) {
        chrome.runtime.sendMessage({ action: "resumeDownload" }).catch(err => {
            console.error("Error sending resume message:", err);
        });
    } else {
        chrome.runtime.sendMessage({ action: "pauseDownload" }).catch(err => {
            console.error("Error sending pause message:", err);
        });
    }
});

stopBtn.addEventListener('click', () => {
    if (!isDownloading) return;
    
    if (confirm("Are you sure you want to stop the download? Current chapters will finish, but remaining chapters will be cancelled.")) {
        chrome.runtime.sendMessage({ action: "stopDownload" }).catch(err => {
            console.error("Error sending stop message:", err);
        });
    }
});

// --- Background Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // console.log("Sidepanel received message:", message); // Debug incoming messages
    if (!message || !message.action) return;

    switch (message.action) {
         case "downloadStarted":
             // This message might not be explicitly sent by refactored bg,
             // but we set the initial status in the downloadBtn listener.
             // If bg sends it, update here:
             // setOverallStatus(`Download started for ${message.payload?.totalChapters || '?'} chapters...`);
             break;

        case "updateChapterStatus":
             if(isDownloading) {
                updateChapterUi(message.payload);
             }
            break;

        case "updateProgress": // Now used for overall progress/status text from background
             if(isDownloading) {
                 // Check if it contains zip progress or just a status update
                 const percentMatch = message.payload?.text?.match(/(\d+)%/);
                 if (percentMatch) {
                     updateOverallProgress(message.payload.text, parseInt(percentMatch[1], 10));
                 } else if (message.payload?.text?.toLowerCase().includes("generating zip") || message.payload?.text?.toLowerCase().includes("compressing")) {
                     updateOverallProgress(message.payload.text); // Update text, show bar
                 } else {
                     // General status update during processing phases
                     setOverallStatus(message.payload.text);
                     // Optionally hide overall progress bar if it's not zipping stage
                     if (!message.payload?.text?.toLowerCase().includes("zip")) {
                         hideOverallProgress();
                     }
                 }
             }
            break;

        case "downloadComplete": {
            const { success, message: finalMsg, totalChaptersSucceeded, totalChaptersRequested } = message.payload;
             const displayMsg = finalMsg || (success ? `Download complete (${totalChaptersSucceeded}/${totalChaptersRequested})` : 'Download failed.');
            setOverallStatus(displayMsg, !success, success);
            // Keep overall progress hidden unless it was zipping just before this
            if (!overallStatusMessageEl.textContent.includes("ZIP")) {
                 hideOverallProgress();
            }
            isDownloading = false;
            isPaused = false;
            hideDownloadControls();
            downloadBtn.disabled = (chapterList.length === 0);
            downloadBtn.style.display = 'flex';
            scanChaptersBtn.disabled = false;
            break;
        }
        case "downloadPaused": {
            setPauseState(true);
            break;
        }
        case "downloadResumed": {
            setPauseState(false);
            break;
        }
        case "downloadStopped": {
            const { totalChaptersSucceeded, totalChaptersRequested } = message.payload;
            setOverallStatus(`Download stopped. Completed: ${totalChaptersSucceeded}/${totalChaptersRequested}`, false, false);
            isDownloading = false;
            isPaused = false;
            hideDownloadControls();
            downloadBtn.disabled = (chapterList.length === 0);
            downloadBtn.style.display = 'flex';
            scanChaptersBtn.disabled = false;
            break;
        }
        case "error": // Handle generic error messages from background
             if (isDownloading) {
                 setOverallStatus(`Error: ${message.payload?.message || 'Unknown error'}`, true);
                 // Buttons will be reset by downloadComplete eventually
             } else {
                 // Error happened outside active download (e.g., JSZip load fail)
                  setOverallStatus(`Error: ${message.payload?.message || 'Unknown error'}`, true);
                  downloadBtn.disabled = true;
                  scanChaptersBtn.disabled = false; // Allow rescan potentially
             }
            break;
    }
     return true; // Keep channel open
});

// --- Initial State Setup ---
async function initializePanel() {
     setOverallStatus("Initializing...");
     isDownloading = false;
     isScanning = false;
     manhwaTitleEl.textContent = '---';
     chapterCountEl.textContent = '0';
     startChapterInput.value = 1;
     endChapterInput.value = 1;
     clearChapterProgress();
     hideOverallProgress(); // Ensure hidden initially

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && tab.url.includes("webtoonscan.com/manhwa/")) {
             setOverallStatus("Ready. Click 'Scan'.");
             scanChaptersBtn.disabled = false;
             downloadBtn.disabled = true;
        } else {
             setOverallStatus("Open a webtoonscan.com/manhwa/ page first.", true);
             scanChaptersBtn.disabled = true;
             downloadBtn.disabled = true;
        }
    } catch(e) {
        setOverallStatus("Error getting current tab info.", true);
        console.error("Initialization error:", e);
        scanChaptersBtn.disabled = true;
        downloadBtn.disabled = true;
    }
}

// Help button click handler
document.getElementById('helpBtn').addEventListener('click', () => {
    window.open(chrome.runtime.getURL('docs/wiki.html'), '_blank');
});

// Initialize on load
initializePanel();
// --- END OF FILE sidepanel.js ---