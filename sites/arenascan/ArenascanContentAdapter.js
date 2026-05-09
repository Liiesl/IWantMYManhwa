'use strict';

class ArenascanContentAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'Arenascan',
            domains: ['arenascan.com', 'cdn.arenascan.com'],
            ...siteConfig
        });
    }

    isChapterListingPage(url) {
        if (!url) return false;
        return url.includes('/manga/') && !this.isChapterUrl(url);
    }

    getChapterListSelectors() {
        return [
            'div.eplister ul li div.eph-num a',
            'div.eplister ul li a'
        ];
    }

    getTitleSelectors() {
        return [
            'h1.entry-title'
        ];
    }

    getImageSelectors() {
        return [
            '#readerarea img:not([src*="readerarea.svg"])',
            'img[src*="cdn.arenascan.com"]'
        ];
    }

    isChapterUrl(url) {
        if (!url) return false;
        
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            
            if (pathname.includes('/manga/')) return false;
            
            return /\-chapter\-\d+/i.test(pathname) || /\-\d+\/?$/.test(pathname);
        } catch (e) {
            return false;
        }
    }

    isValidChapterLink(link, url) {
        const parent = link.closest('li');
        if (!parent) return false;
        const text = link.textContent?.trim();
        if (!text || text.length === 0) return false;
        return true;
    }

    extractChapterNumberFromUrl(url) {
        if (!url) return null;
        
        try {
            const match = url.match(/\-chapter\-(\d+)/i);
            if (match) return parseFloat(match[1]);
            
            const match2 = url.match(/\-(\d+)\/?$/);
            if (match2) return parseFloat(match2[1]);
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
                if (url && url.includes('cdn.arenascan.com')) {
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

    cleanChapterName(text) {
        if (!text) return 'Unknown Chapter';
        
        const trimmed = text.trim();
        
        const patterns = [
            /^chapter\s+(\d+(?:\.\d+)?)/i,
            /^ch\.?\s*(\d+(?:\.\d+)?)/i,
            /^(\d+(?:\.\d+)?)/
        ];
        
        for (const pattern of patterns) {
            const match = trimmed.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }
        
        const cleaned = trimmed
            .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, '')
            .replace(/\b\d{4}\b/g, '')
            .trim();
        
        const numberMatch = cleaned.match(/^(\d+(?:\.\d+)?)/);
        if (numberMatch) {
            return numberMatch[1];
        }
        
        return trimmed.replace(/^chapter\s+/i, '').replace(/^ch\.?\s*/i, '').trim();
    }
}

if (typeof window !== 'undefined') window.ArenascanContentAdapter = ArenascanContentAdapter;
if (typeof globalThis !== 'undefined') globalThis.ArenascanContentAdapter = ArenascanContentAdapter;
if (typeof self !== 'undefined') self.ArenascanContentAdapter = ArenascanContentAdapter;
