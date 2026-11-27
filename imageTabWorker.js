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

async function preparePdfImage(blob) {
    const bitmap = await createImageBitmap(blob);
    // Cap oversized source images to stay below common PDF page-size limits.
    const scale = Math.min(1, 14400 / Math.max(bitmap.width, bitmap.height));
    const pixelWidth = Math.max(1, Math.round(bitmap.width * scale));
    const pixelHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare an image for the PDF.');
        context.drawImage(bitmap, 0, 0, pixelWidth, pixelHeight);
        // Normalize formats such as WebP to JPEG, which pdf-lib can embed directly.
        const jpegBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => result
                ? resolve(result)
                : reject(new Error('Could not encode an image for the PDF.')), 'image/jpeg', 0.94);
        });
        const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
        return {
            jpegBytes,
            pageWidth: pixelWidth * 0.75,
            pageHeight: pixelHeight * 0.75
        };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
        bitmap.close();
    }
}

async function addImageToPdf(pdf, blob) {
    const { jpegBytes, pageWidth, pageHeight } = await preparePdfImage(blob);
    const image = await pdf.embedJpg(jpegBytes);
    // Give every source image its own page and preserve its aspect ratio.
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
}

async function sendCombinedPdfPage(blob, chapterIndex, imageIndex) {
    const { jpegBytes, pageWidth, pageHeight } = await preparePdfImage(blob);
    let binary = '';
    for (let offset = 0; offset < jpegBytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...jpegBytes.subarray(offset, offset + 0x8000));
    }

    const response = await chrome.runtime.sendMessage({
        action: 'combinedPdfPage',
        payload: {
            imageData: btoa(binary),
            pageWidth,
            pageHeight,
            chapterIndex,
            imageIndex
        }
    });
    if (!response?.success) {
        throw new Error(response?.error || 'Could not add an image to the combined PDF.');
    }
}

function triggerBlobDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    // Let Chrome begin reading the blob before releasing its temporary URL.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
    const outputFormat = data.outputFormat || 'zip';
    const logPrefix = `[ImageTab Worker Ch${chapterIndex + 1}]`;
    const fetchOptions = referrer ? { referrer } : {};
    console.log(`${logPrefix} Referrer for image fetches: ${referrer || '(none — hotlink-protected CDNs may 403)'}`);

    if (!['zip', 'pdf', 'pdf-combined'].includes(outputFormat)) {
        return { status: 'failed', error: `Unsupported download format: ${outputFormat}` };
    }
    if (!imageUrls || imageUrls.length === 0) {
        console.error(`${logPrefix} No image URLs provided.`);
        return { status: 'failed', error: 'No image URLs' };
    }
    console.log(`${logPrefix} Starting. ${imageUrls.length} images to process.`);
    if (outputFormat !== 'zip' && (typeof PDFLib === 'undefined' || typeof PDFLib.PDFDocument?.create !== 'function')) {
        return { status: 'failed', error: 'PDF library is not loaded.' };
    }
    if (outputFormat === 'zip' && typeof JSZip !== 'function') {
        return { status: 'failed', error: 'ZIP library is not loaded.' };
    }

    const chapterNumberStr = extractChapterNumber(chapterName, chapterIndex);
    const sanitizedSeriesTitle = sanitizeFilename(seriesTitle || 'WebtoonScan_Download', true);
    const sanitizedChapterNamePart = sanitizeFilename(chapterName || 'unknown', false);
    const extension = outputFormat === 'zip' ? 'zip' : 'pdf';
    const filename = `${sanitizedSeriesTitle}_Ch_${chapterNumberStr}_(${sanitizedChapterNamePart}).${extension}`;

    const chapterZip = outputFormat === 'zip' ? new JSZip() : null;
    const numberedFolder = chapterZip?.folder(chapterNumberStr);
    const pdf = outputFormat === 'pdf' ? await PDFLib.PDFDocument.create() : null;

    let downloadedCount = 0;
    let failedImageCount = 0;

    sendProgress({ type: 'image', downloadedCount: 0, failedCount: 0, total: imageUrls.length });

    // Process in source order so the PDF page order matches the chapter.
    for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const imageLogPrefix = `${logPrefix} Img ${i + 1}/${imageUrls.length}`;

        sendProgress({ type: 'image', downloadedCount, failedCount: failedImageCount, total: imageUrls.length });

        const blob = await fetchSingleImage(imageUrl, imageLogPrefix, imageFetchTimeoutMs, imageFetchRetries, imageRetryDelayMs, fetchOptions);

        if (blob) {
            if (pdf) {
                try {
                    await addImageToPdf(pdf, blob);
                    downloadedCount++;
                    console.log(`${imageLogPrefix} Added page to PDF.`);
                } catch (pdfError) {
                    failedImageCount++;
                    console.error(`${imageLogPrefix} Error adding image to PDF:`, pdfError);
                }
                sendProgress({ type: 'image', downloadedCount, failedCount: failedImageCount, total: imageUrls.length });
                continue;
            }

            if (outputFormat === 'pdf-combined') {
                try {
                    // Await each page append so the background PDF retains image order.
                    await sendCombinedPdfPage(blob, chapterIndex, i);
                    downloadedCount++;
                    console.log(`${imageLogPrefix} Added page to combined PDF.`);
                } catch (pdfError) {
                    failedImageCount++;
                    console.error(`${imageLogPrefix} Error adding image to combined PDF:`, pdfError);
                }
                sendProgress({ type: 'image', downloadedCount, failedCount: failedImageCount, total: imageUrls.length });
                continue;
            }

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

    if (outputFormat === 'pdf-combined') {
        console.log(`${logPrefix} Added ${downloadedCount} pages to the combined PDF.`);
        return { status: 'success', failedImages: failedImageCount };
    }

    console.log(`${logPrefix} Creating ${outputFormat.toUpperCase()}: ${filename}`);
    let lastZipPercent = 0;
    let outputBlob;
    if (pdf) {
        sendProgress({ type: 'pdf', percent: 0 });
        // Keep the background's idle-response timer alive while a large PDF is serialized.
        const progressHeartbeat = setInterval(() => sendProgress({ type: 'pdf', percent: 0 }), 10000);
        let pdfBytes;
        try {
            pdfBytes = await pdf.save({
                updateFieldAppearances: false,
                objectsPerTick: 50
            });
        } finally {
            clearInterval(progressHeartbeat);
        }
        outputBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        sendProgress({ type: 'pdf', percent: 100 });
    } else {
        outputBlob = await chapterZip.generateAsync({
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
    }

    triggerBlobDownload(outputBlob, filename);
    console.log(`${logPrefix} Download triggered: ${filename}`);
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
            })
            .catch(error => {
                console.error("[ImageTab Worker] Chapter processing failed:", error);
                chrome.runtime.sendMessage({
                    action: "imageTabDone",
                    payload: { status: 'failed', error: error.message }
                }).catch(sendError => console.error("Failed to send failure message:", sendError));
            });
        return false;
    }
    return false;
});

console.log("[ImageTab Worker] Ready");
