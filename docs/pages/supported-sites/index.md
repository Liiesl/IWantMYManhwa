---
title: "Site List"
category: "Supported Sites"
order: 1
---

# Supported Sites

This extension works with various manhwa and manhua sites. Below is the current list of supported sites.

## Currently Supported

### WebtoonScan
- **Domain**: webtoonscan.com
- **Content**: Manhwa, Manhua, Manga
- **Status**: Fully supported
- **Pattern**: `/manhwa/[series-name]/`

### Asura Scans
- **Domain**: asuracomic.net (and beta.asuracomic.net)
- **Content**: Manhwa, Manhua
- **Status**: Fully supported
- **Pattern**: `/series/[series-name]/`

## Requesting New Sites

If your favorite site isn't supported:

1. Click the **Request Site** button when on an unsupported site
2. This will open a GitHub issue with the site URL pre-filled
3. Submit the issue to request support

## Site Support Status

| Site | Status | Notes |
|------|--------|-------|
| WebtoonScan | Working | Primary testing site |
| Asura Scans | Working | Both main and beta |

## Technical Details

Sites are supported through an adapter system. Each site needs:
- CSS selectors for chapter lists
- CSS selectors for images
- URL pattern matching rules

If you're a developer, you can add support for new sites by creating adapters. See the Development Guide for details.

## Reporting Issues

If a previously working site stops functioning:

1. Note the series title and chapter number
2. Click **Report Issue** in the extension
3. Include what went wrong and what you expected

Site structures change frequently, so occasional breakage is expected.