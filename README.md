# IWantMYManhwa - Multi-Site Manhwa/Manhua/Manga Downloader

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) A Manifest V3 Chrome extension using the **Side Panel** API to simplify downloading chapters from your favorite Manhwa, Manhua, or Manga websites. Download entire series or selected chapters in bulk via a persistent side interface.

**Now with multi-site support!** Easily add support for new sites by creating simple adapter files.

## Table of Contents

- [IWantMYManhwa - Manhwa/Manhua/Manga Downloader](#iwantmymanhwa---manhwamanhuamanga-downloader)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Supported Websites](#supported-websites)
  - [Installation](#installation)
  - [How to Use](#how-to-use)
  - [Disclaimer](#disclaimer)
  - [Contributing](#contributing)
  - [License](#license)

## Features
* **Multi-Site Support:** Extensible adapter system allows easy addition of new sites
* **Bulk Downloading:** Download multiple chapters simultaneously.
* **Side Panel Interface:** Utilizes Chrome's Side Panel for an easily accessible and persistent UI while Browse.
* **Simple Controls:** Easy selection of chapters and download initiation within the side panel.
* **Manifest V3:** Built using the latest Chrome extension platform standards for improved security, performance, and privacy.
* **Auto-Detection:** Automatically detects supported sites and adapts scraping logic

## Supported Websites

Compatibility with websites can change over time due to updates on their end. We categorize support as follows:

* **Currently Supported:** Websites the extension is actively tested against and expected to work on.
* **Deprecated:** Websites that were previously supported but are known to no longer work reliably due to site changes or other issues. They may or may not be fixed in the future.
* **Planned:** Websites we aim to support in future updates.

*Note: Website structures change frequently. While we strive to maintain compatibility, support even for "Currently Supported" sites may break without notice. Please report issues if you encounter problems.*

<details>
<summary><strong>Currently Supported (Click to expand)</strong></summary>

* `[Webtoonscan | https://webtoonscan.com]`
</details>

<details>
<summary><strong>Deprecated (Click to expand)</strong></summary>

* `[Nothing to see here yet]`

</details>

<details>
<summary><strong>Planned / Future Support (Click to expand)</strong></summary>

* `[Bato]`
* `[Mangadex]`
* `[Mgeko]`

</details>

## Installation

*This extension is not yet available on the Chrome Web Store.*

You need to install it manually using Developer Mode:

1.  **Download or Clone:**
    * Download the repository ZIP file from GitHub (`Code` button -> `Download ZIP`) and extract it to a permanent location on your computer.
    * OR Clone the repository using Git: `git clone https://github.com/[your-username]/[your-repo-name].git`
2.  **Open Chrome Extensions:** Open Google Chrome, type `chrome://extensions` in the address bar, and press Enter.
3.  **Enable Developer Mode:** Toggle the "Developer mode" switch, usually located in the top-right corner. Make sure it's turned ON.
4.  **Load Unpacked:**
    * Click the "Load unpacked" button that appears (usually top-left).
    * Navigate to the directory where you extracted or cloned the repository files in step 1.
    * Select the main folder that contains the `manifest.json` file (do not select the `manifest.json` file itself, select the folder it's inside).
    * Click "Select Folder".
5.  The extension should now be installed. Pin its icon to your toolbar for easy access (click the puzzle piece icon in Chrome's toolbar and then the pin icon next to the extension's name).

## How to Use

1.  Navigate to a website listed under [Currently Supported](#supported-websites).
2.  Go to the main page of a specific series you want to download.
3.  Click the **IWantMYManhwa** icon in your Chrome toolbar. This will open the extension's interface in the **Chrome Side Panel**. (Alternatively, you might need to open the Side Panel manually via the Chrome toolbar button and select **IWantMYManhwa** from the dropdown).
4.  The Side Panel will display the extension's interface, typically showing the list of available chapters for the current series page.
5.  Within the **Side Panel**, select the chapters you wish to download (e.g., using checkboxes, a range selector, or a "select all" button - *describe your specific UI here*).
6.  Click the "Download" or "Start Download" button located **within the Side Panel**.
7.  Chapters will be downloaded, usually into your default Chrome downloads folder, often organized into subfolders per chapter. *[Specify download location/organization if unique]*. The Side Panel may remain open during the download process.

## Disclaimer

* **Copyright:** This tool is intended for personal use and convenience (e.g., offline reading). Downloading copyrighted material may infringe on the rights of owners and publishers. Please respect copyright laws and support creators by reading on official platforms. The developers of this extension are not responsible for user misuse.
* **Website Compatibility:** Websites frequently change their structure, which can break the extension's functionality. We cannot guarantee permanent compatibility with any specific site. Support status reflects the latest testing but can become outdated quickly.
* **Use At Your Own Risk:** This extension interacts with third-party websites. While developed with care, unforeseen issues or conflicts could arise. Use this extension at your own discretion and risk. Excessive downloading might also lead to temporary IP bans from the source websites.

## Adding New Site Support

The extension uses an **adapter pattern** for multi-site support. To add a new site:

1. **Create a new adapter** in `sites/YourSiteAdapter.js` extending `SiteAdapter`
2. **Implement required methods:** `getChapterListSelectors()`, `getTitleSelectors()`, `getImageSelectors()`, `isChapterUrl()`
3. **Register the adapter** in `sites/SiteRegistry.js`
4. **Update `manifest.json`** with new host permissions
5. **Add adapter script** to `sidepanel.html`

See [`sites/README.md`](sites/README.md) for detailed documentation and examples.

### Quick Example

```javascript
// sites/ExampleAdapter.js
class ExampleAdapter extends SiteAdapter {
    constructor() {
        super({ name: 'Example', domains: ['example.com'] });
    }
    
    getChapterListSelectors() {
        return ['div.chapters a'];
    }
    
    getTitleSelectors() {
        return ['h1.title'];
    }
    
    getImageSelectors() {
        return ['div.reader img'];
    }
    
    isChapterUrl(url) {
        return /example\.com\/chapter\//.test(url);
    }
}
```

## Contributing

Contributions are welcome! If you'd like to help improve IWantMYManhwa:

1.  **Fork** the repository.
2.  Create a new **branch** (`git checkout -b feature/your-feature-name`).
3.  Make your changes and **commit** them (`git commit -am 'Add some feature'`).
4.  **Push** to the branch (`git push origin feature/your-feature-name`).
5.  Open a **Pull Request**.

Please report bugs or suggest features using the GitHub Issues tab. Make sure to specify which website(s) are affected if reporting a compatibility issue.

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.