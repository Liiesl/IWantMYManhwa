// content.js (Revised for Dual URL Patterns)
'use strict';
console.log("WebtoonScan Downloader: Content script loaded.");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "getChapters") {
        console.log("[Content Script] Received request: getChapters");
        try {
            const chapterList = [];
            // Use the broader selector strategy from previous attempts, adjust if needed
            let chapterLinks = document.querySelectorAll(
                'div.page-content-listing.single-page ul.main.version-chap li.wp-manga-chapter a, div.listing-chapters_wrap ul li a, div.version-chap ul li a, ul.version-chap li a'
            );

            console.log(`[Content Script] Found ${chapterLinks.length} potential chapter link elements.`);

            const uniqueUrls = new Set(); // Prevent duplicates

            chapterLinks.forEach((link, index) => {
                const url = link.href?.trim();

                if (!url) return; // Skip if no URL

                // --- REVISED URL PATTERN CHECK ---
                let isValidChapterPattern = false;
                try {
                    const pathSegments = new URL(url).pathname.split('/').filter(s => s.length > 0); // Get non-empty path parts
                    const lastSegment = pathSegments.pop(); // Get the last part (e.g., "chapter-88" or "87")

                    if (lastSegment) {
                        // Check if it starts with "chapter-" followed by a number
                        // OR if it consists only of digits (and potentially a decimal point)
                        isValidChapterPattern = lastSegment.startsWith('chapter-') || /^\d+(\.\d+)?$/.test(lastSegment);
                    }
                } catch (e) {
                    // Invalid URL, ignore
                    console.warn(`[Content Script] Skipping invalid URL: ${url}`, e);
                    return;
                }
                // --- END REVISED URL PATTERN CHECK ---


                // --- Filter based on pattern AND context ---
                const looksLikeChapter = isValidChapterPattern &&
                                         link.closest('li.wp-manga-chapter, li') && // Check parent is a list item (esp. wp-manga-chapter)
                                         link.textContent?.trim().length > 0;

                if (looksLikeChapter && !uniqueUrls.has(url)) {
                    let name = link.textContent?.trim() || `Chapter Link ${index + 1}`;
                    name = name.replace(/^chapter\s+/i, '').trim();
                    name = name.replace(/^ch\.\s*/i, '').trim();

                    chapterList.push({ name, url });
                    uniqueUrls.add(url);

                } else if (isValidChapterPattern && !uniqueUrls.has(url)) {
                     // Log URLs that matched the pattern but failed other checks (e.g., context)
                     // console.warn(`[Content Script] Potential chapter link skipped by filters: ${url} (Text: ${link.textContent?.trim()}, Context: ${link.closest('li.wp-manga-chapter, li') ? 'OK' : 'Failed'})`);
                }
            });

            // --- GET TITLE (Keep existing logic) ---
            let title = document.querySelector('h1.post-title, .post-title h1, .post-title h3, .entry-title, .post-title, .main-info .container h1')
                             ?.textContent?.trim()
                         || document.title.split(/[-–—\|]/)[0].trim();
            if (!title || title.length < 2) {
                 title = "Unknown Title";
                 console.warn("[Content Script] Could not reliably determine Manhwa title.");
            }

            // --- REVISED SORTING (Handles both URL patterns) ---
            const extractNumberFromUrl = (urlString) => {
                try {
                    const pathSegments = new URL(urlString).pathname.split('/').filter(s => s.length > 0);
                    const lastSegment = pathSegments.pop();

                    if (!lastSegment) return NaN;

                    // Try matching "chapter-NUMBER" pattern
                    const matchChapterDash = lastSegment.match(/^chapter-(\d+(\.\d+)?)/);
                    if (matchChapterDash?.[1]) return parseFloat(matchChapterDash[1]);

                    // Try matching pure "NUMBER" pattern
                    if (/^\d+(\.\d+)?$/.test(lastSegment)) return parseFloat(lastSegment);

                } catch (e) { /* Invalid URL */ }

                return NaN; // Return NaN if no number found in expected formats
            };

            chapterList.sort((a, b) => {
                 const numA = extractNumberFromUrl(a.url);
                 const numB = extractNumberFromUrl(b.url);

                 // Fallback: Try extracting leading number from name
                 const nameNumA = parseFloat(a.name.match(/^[\d\.]+/)?.[0]);
                 const nameNumB = parseFloat(b.name.match(/^[\d\.]+/)?.[0]);

                 // Prioritize URL number, then name number
                 const finalNumA = !isNaN(numA) ? numA : (!isNaN(nameNumA) ? nameNumA : -Infinity);
                 const finalNumB = !isNaN(numB) ? numB : (!isNaN(nameNumB) ? nameNumB : -Infinity);

                 // Sort numerically DESCENDING (newest first as typically listed)
                 // sidepanel.js will sort ASCENDING later.
                 if (finalNumA !== -Infinity && finalNumB !== -Infinity && finalNumA !== finalNumB) {
                     return finalNumB - finalNumA;
                 }

                 // Final fallback: Locale comparison on name
                 return a.name.localeCompare(b.name);
            });
            // --- END SORTING ---

            console.log(`[Content Script] Processed links. Sending response: ${chapterList.length} unique chapters found and sorted. Title: ${title}`);
            sendResponse({
                action: "chaptersFound",
                chapters: chapterList,
                title: title
            });

        } catch (error) {
            console.error("[Content Script] Error finding chapters:", error);
            sendResponse({ action: "error", message: `Content Script Error: ${error.message}` });
        }
        return true; // Indicate async response
    }
    return false;
});