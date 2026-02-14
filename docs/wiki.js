// Wiki documentation system
// Dynamically loads markdown files with YAML frontmatter

(function() {
    'use strict';

    // Configuration
    const PAGES_DIR = 'pages';
    const DEFAULT_PAGE = 'getting-started/index';

    // List of markdown files to scan (since we can't directory scan via HTTP)
    const MARKDOWN_FILES = [
        'getting-started/index.md',
        'getting-started/quick-start.md',
        'features/index.md',
        'troubleshooting/index.md',
        'supported-sites/index.md',
        'development/index.md',
        'development/api-reference.md'
    ];

    // Navigation structure - built dynamically from frontmatter
    let navStructure = [];

    // Initialize
    document.addEventListener('DOMContentLoaded', async () => {
        await buildNavigation();
        loadPageFromHash();
    });

    // Handle hash changes
    window.addEventListener('hashchange', loadPageFromHash);

    /**
     * Parse YAML frontmatter from markdown content
     * Returns { frontmatter: {}, content: string }
     */
    function parseFrontmatter(markdown) {
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
        const match = markdown.match(frontmatterRegex);

        if (!match) {
            return { frontmatter: {}, content: markdown };
        }

        const yamlText = match[1];
        const content = match[2];
        const frontmatter = {};

        // Simple YAML parser for basic key-value pairs
        yamlText.split('\n').forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();
                
                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                
                // Parse numbers
                if (/^\d+$/.test(value)) {
                    value = parseInt(value, 10);
                }
                
                frontmatter[key] = value;
            }
        });

        return { frontmatter, content };
    }

    /**
     * Build navigation by scanning markdown files and parsing frontmatter
     */
    async function buildNavigation() {
        const pages = [];

        // Load all markdown files and parse frontmatter
        for (const file of MARKDOWN_FILES) {
            try {
                const response = await fetch(`${PAGES_DIR}/${file}`);
                if (response.ok) {
                    const markdown = await response.text();
                    const { frontmatter } = parseFrontmatter(markdown);
                    
                    if (frontmatter.title && frontmatter.category) {
                        pages.push({
                            file: file,
                            folder: file.split('/')[0],
                            filename: file.split('/').pop(),
                            title: frontmatter.title,
                            category: frontmatter.category,
                            order: frontmatter.order || 999
                        });
                    }
                }
            } catch (error) {
                console.error(`Error loading ${file}:`, error);
            }
        }

        // Group by category
        const categories = {};
        pages.forEach(page => {
            if (!categories[page.category]) {
                categories[page.category] = [];
            }
            categories[page.category].push(page);
        });

        // Build navigation structure
        navStructure = Object.keys(categories).map(category => {
            const catPages = categories[category].sort((a, b) => a.order - b.order);
            return {
                id: catPages[0].folder,
                title: category,
                folder: catPages[0].folder,
                pages: catPages.map(page => ({
                    id: `${page.folder}-${page.filename.replace('.md', '')}`,
                    title: page.title,
                    file: page.file,
                    order: page.order
                }))
            };
        });

        // Sort categories by minimum order in each
        navStructure.sort((a, b) => {
            const aMin = Math.min(...a.pages.map(p => p.order));
            const bMin = Math.min(...b.pages.map(p => p.order));
            return aMin - bMin;
        });

        renderSidebar();
    }

    /**
     * Render the sidebar navigation
     */
    function renderSidebar() {
        const nav = document.getElementById('sidebarNav');
        nav.innerHTML = '';

        navStructure.forEach(section => {
            const sectionEl = document.createElement('div');
            sectionEl.className = 'nav-section';

            // Section header
            const header = document.createElement('div');
            header.className = 'nav-section-header';
            header.textContent = section.title;
            sectionEl.appendChild(header);

            // Pages in section
            const pagesList = document.createElement('ul');
            pagesList.className = 'nav-pages';

            section.pages.forEach(page => {
                const li = document.createElement('li');
                const link = document.createElement('a');
                link.href = `#/${page.file.replace('.md', '')}`;
                link.className = 'nav-link';
                link.dataset.path = page.file;
                link.textContent = page.title;
                link.addEventListener('click', (e) => {
                    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                });

                li.appendChild(link);
                pagesList.appendChild(li);
            });

            sectionEl.appendChild(pagesList);
            nav.appendChild(sectionEl);
        });
    }

    /**
     * Load page based on URL hash
     */
    function loadPageFromHash() {
        let hash = window.location.hash;
        
        // Remove leading #/
        if (hash.startsWith('#/')) {
            hash = hash.substring(2);
        } else if (hash.startsWith('#')) {
            hash = hash.substring(1);
        }

        // Default to getting started
        if (!hash) {
            hash = DEFAULT_PAGE;
        }

        const path = `${PAGES_DIR}/${hash}.md`;
        loadMarkdown(path);
        updateBreadcrumbs(hash);
        highlightActiveLink(path);
    }

    /**
     * Load and render a markdown file
     */
    async function loadMarkdown(path) {
        const contentEl = document.getElementById('content');
        
        try {
            const response = await fetch(path);
            
            if (!response.ok) {
                throw new Error(`Failed to load ${path}`);
            }

            const markdown = await response.text();
            const { content } = parseFrontmatter(markdown);
            const html = marked.parse(content);
            
            contentEl.innerHTML = html;
            
            // Apply syntax highlighting
            contentEl.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });

            // Update page title
            const h1 = contentEl.querySelector('h1');
            if (h1) {
                document.title = `${h1.textContent} - Manhwa Downloader Docs`;
            }

        } catch (error) {
            contentEl.innerHTML = `
                <div class="error-message">
                    <h2>Page Not Found</h2>
                    <p>Could not load documentation page.</p>
                    <p><code>${path}</code></p>
                </div>
            `;
            console.error('Error loading markdown:', error);
        }
    }

    /**
     * Update breadcrumb navigation
     */
    function updateBreadcrumbs(hash) {
        const breadcrumbsEl = document.getElementById('breadcrumbs');
        const parts = hash.split('/');
        
        let html = '<a href="#/getting-started/index">Docs</a>';
        
        // Find section info from navStructure
        const section = navStructure.find(s => s.folder === parts[0]);
        if (section) {
            html += ` <span class="separator">/</span> <a href="#/${parts[0]}/index">${section.title}</a>`;
        }
        
        if (parts.length >= 2 && parts[1] !== 'index') {
            const page = section?.pages.find(p => p.file === `${parts[0]}/${parts[1]}.md`);
            if (page) {
                html += ` <span class="separator">/</span> <span class="current">${page.title}</span>`;
            }
        }
        
        breadcrumbsEl.innerHTML = html;
    }

    /**
     * Highlight the active link in the sidebar
     */
    function highlightActiveLink(path) {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.path === path.replace(`${PAGES_DIR}/`, '')) {
                link.classList.add('active');
            }
        });
    }
})();