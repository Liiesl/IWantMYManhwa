'use strict';

class AsuraScansContentAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'AsuraScans',
            domains: ['asuracomic.net', 'beta.asuracomic.net'],
            ...siteConfig
        });
    }

    isChapterListingPage(url) {
        if (!url) return false;
        return url.includes('/series/') && !this.isChapterUrl(url);
    }

    getChapterListSelectors() {
        return [
            'div[class*="space-y-"] a[href*="/chapter/"]',
            'div.max-h-\\[20rem\\] a[href*="/chapter/"]'
        ];
    }

    getTitleSelectors() {
        return [
            'span.text-xl.font-bold',
            'h1.text-xl.font-bold'
        ];
    }

    getImageSelectors() {
        return [
            'div.py-8 img.object-cover',
            'div.py-8 img'
        ];
    }

    isChapterUrl(url) {
        if (!url) return false;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            
            // Pattern: /series/{slug}/chapter/{number}
            const chapterIndex = pathSegments.indexOf('chapter');
            if (chapterIndex !== -1 && chapterIndex + 1 < pathSegments.length) {
                const chapterNum = pathSegments[chapterIndex + 1];
                return /^\d+$/.test(chapterNum) && url.includes('asuracomic.net');
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    isValidChapterLink(link, url) {
        if (!url || !url.includes('/chapter/')) return false;
        const text = link.textContent?.trim();
        return text && text.length > 0;
    }

    extractChapterNumberFromUrl(url) {
        if (!url) return null;
        
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
            const chapterIndex = pathSegments.indexOf('chapter');
            
            if (chapterIndex !== -1 && chapterIndex + 1 < pathSegments.length) {
                return parseFloat(pathSegments[chapterIndex + 1]);
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
                    // Filter out end page image
                    if (!url.includes('EndDesign')) {
                        images.push(url);
                    }
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
                return numB - numA; // Descending (newest first)
            }

            const nameNumA = parseFloat(a.name.match(/^[\d\.]+/)?.[0]);
            const nameNumB = parseFloat(b.name.match(/^[\d\.]+/)?.[0]);

            if (!isNaN(nameNumA) && !isNaN(nameNumB)) {
                return nameNumB - nameNumA;
            }

            return a.name.localeCompare(b.name);
        });
    }
}

if (typeof window !== 'undefined') window.AsuraScansContentAdapter = AsuraScansContentAdapter;
if (typeof globalThis !== 'undefined') globalThis.AsuraScansContentAdapter = AsuraScansContentAdapter;
if (typeof self !== 'undefined') self.AsuraScansContentAdapter = AsuraScansContentAdapter;
