// sites/SiteRegistry.js
// Registry for managing site adapters

'use strict';

/**
 * Registry for managing site adapters
 * Provides methods to register adapters and detect which adapter handles a URL
 */
class SiteRegistry {
    constructor() {
        this.adapters = new Map();
        this.defaultAdapter = null;
    }

    /**
     * Register a site adapter
     * @param {string} name - Unique name for the site
     * @param {SiteAdapter} adapter - The adapter instance
     * @param {boolean} isDefault - Whether this is the default adapter
     */
    register(name, adapter, isDefault = false) {
        if (!name || !adapter) {
            throw new Error('SiteRegistry: name and adapter are required');
        }

        this.adapters.set(name, adapter);
        
        if (isDefault || !this.defaultAdapter) {
            this.defaultAdapter = adapter;
        }

        console.log(`[SiteRegistry] Registered adapter: ${name}`);
    }

    /**
     * Get an adapter by name
     * @param {string} name 
     * @returns {SiteAdapter|null}
     */
    get(name) {
        return this.adapters.get(name) || null;
    }

    /**
     * Find the adapter that handles a given URL
     * @param {string} url 
     * @returns {SiteAdapter|null}
     */
    findAdapterForUrl(url) {
        if (!url) return null;

        for (const [name, adapter] of this.adapters) {
            if (adapter.matchesUrl(url)) {
                return adapter;
            }
        }

        return null;
    }

    /**
     * Check if a URL is supported by any registered adapter
     * @param {string} url 
     * @returns {boolean}
     */
    isSupported(url) {
        return this.findAdapterForUrl(url) !== null;
    }

    /**
     * Get all registered adapter names
     * @returns {string[]}
     */
    getRegisteredSites() {
        return Array.from(this.adapters.keys());
    }

    /**
     * Get adapter for chapter listing page
     * @param {string} url 
     * @returns {SiteAdapter|null}
     */
    getAdapterForChapterList(url) {
        const adapter = this.findAdapterForUrl(url);
        if (adapter && typeof adapter.isChapterListingPage === 'function') {
            if (adapter.isChapterListingPage(url)) {
                return adapter;
            }
        }
        return null;
    }

    /**
     * Get adapter for chapter reader page
     * @param {string} url 
     * @returns {SiteAdapter|null}
     */
    getAdapterForChapter(url) {
        const adapter = this.findAdapterForUrl(url);
        if (adapter && adapter.isChapterUrl(url)) {
            return adapter;
        }
        return null;
    }

    /**
     * Initialize registry with default adapters
     * Called once on extension load
     */
    initialize() {
        // Clear existing
        this.adapters.clear();
        
        // Register Webtoonscan adapter
        if (typeof WebtoonscanAdapter !== 'undefined') {
            this.register('webtoonscan', new WebtoonscanAdapter(), true);
        }

        console.log('[SiteRegistry] Initialized with adapters:', this.getRegisteredSites());
    }
}

// Create singleton instance
const siteRegistry = new SiteRegistry();

// Make available globally - try multiple methods for content script compatibility
try {
    if (typeof window !== 'undefined') {
        window.SiteRegistry = SiteRegistry;
        window.siteRegistry = siteRegistry;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.SiteRegistry = SiteRegistry;
        globalThis.siteRegistry = siteRegistry;
    }
    if (typeof self !== 'undefined') {
        self.SiteRegistry = SiteRegistry;
        self.siteRegistry = siteRegistry;
    }
} catch (e) {
    console.error("[SiteRegistry] Failed to set global:", e);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SiteRegistry, siteRegistry };
}