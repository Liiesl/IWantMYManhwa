// sites/WebtoonscanContentAdapter.js
// Content script adapter - scraping only (no download logic)
// Used by content.js

'use strict';

class WebtoonscanContentAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'Webtoonscan',
            domains: ['webtoonscan.com', 'cdn4.webtoonscan.com'],
            ...siteConfig
        });
    }

    isChapterListingPage(url) {
        if (!url) return false;
        return url.includes('webtoonscan.com/manhwa/') && !this.isChapterUrl(url);
    }

    getChapterListSelectors() {
        return [
            'div.page-content-listing.single-page ul.main.version-chap li.wp-manga-chapter a',
            'div.listing-chapters_wrap ul li a',
            'div.version-chap ul li a',
            'ul.version-chap li a'
        ];
    }

    getTitleSelectors() {
        return [
            'h1.post-title',
            '.post-title h1',
            '.post-title h3',
            '.entry-title',
            '.main-info .container h1'
        ];
    }

    getImageSelectors() {
        return [
            'div.reading-content div.page-break img.wp-manga-chapter-img',
            'div.read-container img.viewer-image'
        ];
    }

    isChapterUrl(url) {
        if (!url) return false;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            const lastSegment = pathSegments.pop();

            if (lastSegment) {
                const isChapterPattern = /^chapter-[\d\.]+$/i.test(lastSegment) || 
                                        /^[\d\.]+$/.test(lastSegment);
                return isChapterPattern && url.includes('webtoonscan.com');
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    isValidChapterLink(link, url) {
        const parent = link.closest('li.wp-manga-chapter, li');
        if (!parent) return false;
        const text = link.textContent?.trim();
        if (!text || text.length === 0) return false;
        return true;
    }

    extractChapterNumberFromUrl(url) {
        if (!url) return null;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            const lastSegment = pathSegments.pop();

            if (lastSegment) {
                const chapterMatch = lastSegment.match(/^chapter-([\d\.]+)/i);
                if (chapterMatch) return parseFloat(chapterMatch[1]);
                if (/^[\d\.]+$/.test(lastSegment)) return parseFloat(lastSegment);
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    getChapters() {
        const chapters = [];
        const selectors = this.getChapterListSelectors();
        const uniqueUrls = new Set();

        for (const selector of selectors) {
            const links = document.querySelectorAll(selector);
            
            for (const link of links) {
                const url = link.href?.trim();
                if (!url) continue;
                if (!this.isChapterUrl(url)) continue;
                if (!this.isValidChapterLink(link, url)) continue;
                if (uniqueUrls.has(url)) continue;

                const name = this.cleanChapterName(link.textContent);
                chapters.push({ name, url });
                uniqueUrls.add(url);
            }
        }

        return this.sortChapters(chapters);
    }

    getChapterImages() {
        const images = [];
        const selectors = this.getImageSelectors();

        for (const selector of selectors) {
            const imageElements = document.querySelectorAll(selector);
            
            for (const img of imageElements) {
                const url = this.getImageUrl(img);
                if (url) {
                    images.push(url);
                }
            }

            if (images.length > 0) break;
        }

        return images;
    }

    sortChapters(chapters) {
        return chapters.sort((a, b) => {
            const numA = this.extractChapterNumberFromUrl(a.url);
            const numB = this.extractChapterNumberFromUrl(b.url);

            if (numA !== null && numB !== null) {
                return numA - numB;
            }

            const nameNumA = parseFloat(a.name.match(/^[\d\.]+/)?.[0]);
            const nameNumB = parseFloat(b.name.match(/^[\d\.]+/)?.[0]);

            if (!isNaN(nameNumA) && !isNaN(nameNumB)) {
                return nameNumA - nameNumB;
            }

            return a.name.localeCompare(b.name);
        });
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.WebtoonscanContentAdapter = WebtoonscanContentAdapter;
}

if (typeof globalThis !== 'undefined') {
    globalThis.WebtoonscanContentAdapter = WebtoonscanContentAdapter;
}

if (typeof self !== 'undefined') {
    self.WebtoonscanContentAdapter = WebtoonscanContentAdapter;
}
