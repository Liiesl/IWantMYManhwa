'use strict';

class WfwfContentAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'Wfwf',
            domains: ['wfwf499.com'],
            ...siteConfig
        });
    }

    matchesUrl(url) {
        if (!url) return false;
        return /https?:\/\/([^\/]*\.)?wfwf\d*\.com/i.test(url);
    }

    isChapterListingPage(url) {
        if (!url) return false;
        if (!this.matchesUrl(url)) return false;
        return url.includes('/list') && url.includes('toon=') && !this.isChapterUrl(url);
    }

    getChapterListSelectors() {
        return [
            'a.ep-item[href*="/view?toon="]',
            'a.ep-item',
            '.list-sec a[href*="/view?"]'
        ];
    }

    getTitleSelectors() {
        return [
            'h1.w-title',
            '.vt-name'
        ];
    }

    getImageSelectors() {
        return [
            '#vimg-area img[data-src]',
            '#vimg-area img'
        ];
    }

    isChapterUrl(url) {
        if (!url) return false;
        if (!this.matchesUrl(url)) return false;

        try {
            const urlObj = new URL(url);
            if (!urlObj.pathname.includes('/view')) return false;
            const toon = urlObj.searchParams.get('toon');
            const num = urlObj.searchParams.get('num');
            return !!toon && num !== null && /^\d+$/.test(num);
        } catch (e) {
            return false;
        }
    }

    isValidChapterLink(link, url) {
        if (!url || !url.includes('/view')) return false;
        if (!url.includes('toon=')) return false;
        // ep-item IS the <a> itself (not inside an <li>), so accept by class or href
        if (link.classList && link.classList.contains('ep-item')) return true;
        if (link.closest && link.closest('a.ep-item')) return true;
        const text = link.textContent?.trim();
        if (!text || text.length === 0) return false;
        return true;
    }

    extractChapterNumberFromUrl(url) {
        if (!url) return null;

        try {
            const urlObj = new URL(url);
            const num = urlObj.searchParams.get('num');
            if (num !== null && /^\d+(\.\d+)?$/.test(num)) {
                return parseFloat(num);
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

                // Prefer data-num attribute (exact), fall back to cleaned title text
                const dataNum = link.dataset?.num || link.getAttribute?.('data-num');
                let name;
                if (dataNum && /^\d+(\.\d+)?$/.test(dataNum.trim())) {
                    name = dataNum.trim();
                } else {
                    const titleEl = link.querySelector?.('.ep-title');
                    name = this.cleanChapterName(titleEl?.textContent || link.textContent);
                }
                chapters.push({ name, url });
                uniqueUrls.add(url);
            }

            if (chapters.length > 0) break;
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
                if (!url) continue;
                // Exclude placeholders / ads: /assets/, sprite.png, ad networks
                if (url.includes('/assets/')) continue;
                if (url.includes('sprite.png')) continue;
                if (url.includes('iabn101.net')) continue;
                if (url.includes('jads.co')) continue;
                if (url.includes('juicyads')) continue;
                images.push(url);
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

        // Wfwf titles look like "귀접 [리디] 30화(완결)", "29화", "귀접 [리디] 21화"
        // Extract the trailing "<number>화" -> return just the number for consistency
        const hwaMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*화/);
        if (hwaMatch && hwaMatch[1]) {
            return hwaMatch[1];
        }

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

        return trimmed.replace(/^chapter\s+/i, '').replace(/^ch\.?\s*/i, '').trim();
    }
}

if (typeof window !== 'undefined') window.WfwfContentAdapter = WfwfContentAdapter;
if (typeof globalThis !== 'undefined') globalThis.WfwfContentAdapter = WfwfContentAdapter;
if (typeof self !== 'undefined') self.WfwfContentAdapter = WfwfContentAdapter;
