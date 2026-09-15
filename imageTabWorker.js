'use strict';

// JSZip will be injected by background.js before this script

const IMAGE_FETCH_TIMEOUT_MS = 45000;
const IMAGE_FETCH_RETRIES = 3;
const IMAGE_RETRY_DELAY_MS = 1000;
const ZIP_COMPRESSION_LEVEL = 6;
const ZIP_PROGRESS_THROTTLE_PERCENT = 5;

function sendProgress(payload) {
    chrome.runtime.sendMessage({ action: "chapterImageProgress", payload })
        .catch(() => { });
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFilename(name, allowSpaces = false) {
    if (!name) return 'unknown';
    let sanitized = String(name).trim();
    sanitized = sanitized.replace(/[\\/:\*\?"<>\|]/g, '_').replace(/[\x00-\x1F]/g, '');
    if (!allowSpaces) {
        sanitized = sanitized.replace(/\s+/g, '_');
    } else {
        sanitized = sanitized.replace(/\s{2,}/g, ' ');
    }
    sanitized = sanitized.replace(/[\.\_\s]{2,}/g, '_').replace(/^[\.\_\s]+|[\.\_\s]+$/g, '');
    sanitized = sanitized.substring(0, 100);
    return sanitized || 'sanitized_name';
}

function padNumber(num, length = 3) {
    const numStr = String(num);
    const parts = numStr.split('.');
    const integerPart = parts[0];
    const decimalPart = parts.length > 1 ? '.' + parts[1] : '';
    return integerPart.padStart(length, '0') + decimalPart;
}

function extractChapterNumber(name, index) {
    if (!name) return index + 1;
    
    // First, clean the name by removing dates to avoid false positives
    // Remove month names and 4-digit years which might be part of date strings
    const cleanedName = name
        .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, ' ')
        .replace(/\b\d{4}\b/g, ' ')
        .trim();
    
    const patterns = [
        /Chapter\s*([\d\.]+)/i,
        /Ch\.?\s*([\d\.]+)/i,
        /(?:^|\s|\W)([\d\.]+)(?:$|\s|\W,:|-)/
    ];
    
    for (const pattern of patterns) {
        const match = cleanedName.match(pattern);
        if (match && match[1]) {
            const numStr = match[1];
            // Validate that it's a pure numeric chapter number (no letters)
            if (/^[\d\.]+$/.test(numStr) && !isNaN(parseFloat(numStr))) {
                return numStr;
            }
        }
    }
    
    // Fallback: extract first pure number sequence (avoiding dates with letters)
    const digits = cleanedName.match(/\b\d+(?:\.\d+)?\b/);
    if (digits) {
        return digits[0];
    }
    
    return index + 1;
}

async function fetchSingleImage(imageUrl, logPrefix, timeoutMs = IMAGE_FETCH_TIMEOUT_MS, retryCount = IMAGE_FETCH_RETRIES, retryDelayMs = IMAGE_RETRY_DELAY_MS, fetchOptions = {}) {
    let retries = retryCount;
    let delay = retryDelayMs;
    let lastError = null;

    while (retries >= 0) {
        const attempt = retryCount - retries + 1;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(imageUrl, {
                mode: 'cors',
                signal: controller.signal,
                // Hotlink-protected CDNs (e.g. wfwf's image host) reject requests
                // without a site Referer. `referrer` may be cross-origin here;
                // `unsafe-url` guarantees the full URL is sent regardless of the
                // embedding page's own Referrer-Policy (e.g. Cloudflare block pages).
                ...(fetchOptions.referrer ? { referrer: fetchOptions.referrer, referrerPolicy: 'unsafe-url' } : {})
            });
            clearTimeout(timeoutId);

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
                console.warn(`${logPrefix} Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`);
                await sleep(delay);
                delay *= 2;
                retries--;
            } else {
                console.error(`${logPrefix} Final fetch failed after ${attempt} attempts: ${error.message}`);
                return null;
            }
        }
    }
    console.error(`${logPrefix} Fetch failed with no retries: ${lastError?.message}`);
    return null;
}

async function processChapter(data) {
    const { imageUrls, seriesTitle, chapterName, chapterIndex, imageFetchTimeoutMs, imageFetchRetries, imageRetryDelayMs, referrer } = data;
    const logPrefix = `[ImageTab Worker Ch${chapterIndex + 1}]`;
    const fetchOptions = referrer ? { referrer } : {};
    console.log(`${logPrefix} Referrer for image fetches: ${referrer || '(none — hotlink-protected CDNs may 403)'}`);

    console.log(`${logPrefix} Starting. ${imageUrls.length} images to process.`);

    if (!imageUrls || imageUrls.length === 0) {
        console.error(`${logPrefix} No image URLs provided.`);
        return { status: 'failed', error: 'No image URLs' };
    }

    const chapterNumberStr = extractChapterNumber(chapterName, chapterIndex);
    const sanitizedSeriesTitle = sanitizeFilename(seriesTitle || 'WebtoonScan_Download', true);
    const sanitizedChapterNamePart = sanitizeFilename(chapterName || 'unknown', false);
    const zipFilename = `${sanitizedSeriesTitle}_Ch_${chapterNumberStr}_(${sanitizedChapterNamePart}).zip`;

    const chapterZip = new JSZip();
    const numberedFolder = chapterZip.folder(chapterNumberStr);

    let downloadedCount = 0;
    let failedImageCount = 0;

    sendProgress({ type: 'image', downloadedCount: 0, failedCount: 0, total: imageUrls.length });

    for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const imageLogPrefix = `${logPrefix} Img ${i + 1}/${imageUrls.length}`;

        sendProgress({ type: 'image', downloadedCount, failedCount: failedImageCount, total: imageUrls.length });

        const blob = await fetchSingleImage(imageUrl, imageLogPrefix, imageFetchTimeoutMs, imageFetchRetries, imageRetryDelayMs, fetchOptions);

        if (blob) {
            let fileExtension = 'jpg';
            if (blob.type && blob.type.startsWith('image/')) {
                const subtype = blob.type.split('/')[1];
                if (subtype && ['jpeg', 'png', 'gif', 'webp', 'bmp'].includes(subtype)) {
                    fileExtension = subtype === 'jpeg' ? 'jpg' : subtype;
                }
            } else {
                try {
                    const urlPath = new URL(imageUrl).pathname;
                    const lastDot = urlPath.lastIndexOf('.');
                    if (lastDot > 0 && lastDot < urlPath.length - 1) {
                        const ext = urlPath.substring(lastDot + 1).toLowerCase();
                        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
                            fileExtension = ext === 'jpeg' ? 'jpg' : ext;
                        }
                    }
                } catch (urlParseError) { }
            }

            const imageFilename = `${padNumber(i + 1, 3)}.${fileExtension}`;

            try {
                numberedFolder.file(imageFilename, blob, { binary: true });
                downloadedCount++;
                console.log(`${imageLogPrefix} Downloaded: ${imageFilename}`);
            } catch (zipFileError) {
                console.error(`${imageLogPrefix} Error adding file to zip: ${zipFileError}`);
                failedImageCount++;
            }
        } else {
            failedImageCount++;
            console.error(`${imageLogPrefix} Failed to fetch.`);
        }

        sendProgress({ type: 'image', downloadedCount, failedCount: failedImageCount, total: imageUrls.length });
    }

    if (downloadedCount === 0 && imageUrls.length > 0) {
        console.error(`${logPrefix} All images failed to download.`);
        return { status: 'failed', error: 'All images failed' };
    }

    console.log(`${logPrefix} Creating ZIP: ${zipFilename}`);
    let lastZipPercent = 0;
    const zipBlob = await chapterZip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: ZIP_COMPRESSION_LEVEL }
    }, (metadata) => {
        const percent = Math.floor(metadata.percent);
        if (percent >= 100 || percent - lastZipPercent >= ZIP_PROGRESS_THROTTLE_PERCENT) {
            lastZipPercent = percent;
            sendProgress({ type: 'zip', percent });
        }
    });

    // Use FileReader to convert blob to data URL for download
    const zipDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read ZIP blob"));
        reader.readAsDataURL(zipBlob);
    });

    // Trigger download via anchor click
    const a = document.createElement('a');
    a.href = zipDataUrl;
    a.download = zipFilename;
    a.click();

    console.log(`${logPrefix} Download triggered: ${zipFilename}`);
    return { status: 'success', failedImages: failedImageCount };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "processImages") {
        processChapter(message.data)
            .then(result => {
                chrome.runtime.sendMessage({
                    action: "imageTabDone",
                    payload: result
                }).catch(e => console.error("Failed to send done message:", e));
            });
        return false;
    }
    return false;
});

console.log("[ImageTab Worker] Ready");
