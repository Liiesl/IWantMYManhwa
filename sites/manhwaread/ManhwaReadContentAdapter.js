'use strict';

class ManhwaReadContentAdapter extends SiteAdapter {
    constructor(siteConfig = {}) {
        super({
            name: 'ManhwaRead',
            domains: ['manhwaread.com'],
            ...siteConfig
        });
    }

    getChapterListSelectors() {
        return [
            'a.chapter-item[href*="/chapter-"]',
            'ul.chapters li a'
        ];
    }

    getTitleSelectors() {
        return ['h1.series-title', '.manga-title h1'];
    }

    getImageSelectors() {
        return ['img.reading-image'];
    }

    isChapterUrl(url) {
        if (!url) return false;

        try {
            const chapterUrl = new URL(url);
            return this.matchesUrl(url) && /\/chapter-[^/]+\/?$/i.test(chapterUrl.pathname);
        } catch (error) {
            return false;
        }
    }

    isValidChapterLink(link, url) {
        return !!url && this.isChapterUrl(url) && !!link.textContent?.trim();
    }

    getChapters() {
        const chapters = [];
        const uniqueUrls = new Set();

        for (const selector of this.getChapterListSelectors()) {
            for (const link of document.querySelectorAll(selector)) {
                const url = link.href?.trim();
                if (!url || !this.isValidChapterLink(link, url) || uniqueUrls.has(url)) continue;

                chapters.push({
                    name: this.cleanChapterName(
                        link.querySelector('.chapter-item__name')?.textContent || link.textContent
                    ),
                    url
                });
                uniqueUrls.add(url);
            }
        }

        return this.sortChapters(chapters);
    }
}

// Make available globally
if (typeof window !== 'undefined') window.ManhwaReadContentAdapter = ManhwaReadContentAdapter;
if (typeof globalThis !== 'undefined') globalThis.ManhwaReadContentAdapter = ManhwaReadContentAdapter;
if (typeof self !== 'undefined') self.ManhwaReadContentAdapter = ManhwaReadContentAdapter;
