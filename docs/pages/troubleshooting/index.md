---
title: "Common Issues"
category: "Troubleshooting"
order: 1
---

# Troubleshooting

Common issues and solutions for the Manhwa Downloader extension.

## Extension Not Working

### "Site not supported" message
Make sure you're on a supported website. The extension works with:
- webtoonscan.com
- asuracomic.net
- arenascan.com
- wfwfNNN.com (Wfwf / 늑대닷컴 — the number changes periodically; if the
  panel says "not supported" right after a rotation, the adapter's explicit
  domain needs a bump — report it via **Request Site**)

If you see this message on a supported site, try clicking **Re-check**.

### Nothing happens when clicking Scan
1. Wait for the page to fully load
2. Ensure you're on a series page (not a chapter page)
3. Check that the URL contains `/manhwa/`, `/series/`, or `/list?toon=`
4. Try refreshing the page

## Download Issues

### All images fail with 403 (Wfwf)
Wfwf's image CDN only serves requests carrying a wfwf `Referer`. The
extension forces this header at the network layer, but the rule follows
the adapter's explicit domain — right after a domain rotation it may
point at the old number until the adapter is updated. Reload the
extension and retry; if it persists, report the current domain.

### Downloads start but fail immediately
- Check your internet connection
- The site may be temporarily down
- Try again in a few minutes

### Some chapters fail to download
- Individual chapter failures are normal
- Failed chapters will be marked in the progress list
- You can retry specific chapters by selecting their range again

### ZIP file is empty or corrupted
- Ensure you have enough disk space
- Try downloading fewer chapters at once
- Check your browser's download settings

## Performance Issues

### Extension is slow
- Close unnecessary browser tabs
- Avoid downloading too many chapters at once (50+ at a time is recommended max)
- The site may be experiencing high traffic

### Browser becomes unresponsive
- This can happen during the final ZIP creation phase
- Wait for the process to complete
- For very large downloads, consider splitting into smaller batches

## Getting Help

If you continue to experience issues:

1. Check that you're using the latest version of the extension
2. Try reloading the extension in `chrome://extensions/`
3. Clear your browser cache and try again
4. Report the issue using the **Report Issue** button in the extension