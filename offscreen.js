'use strict';

const blobChannel = new BroadcastChannel('iwantmymanhwa-download-blobs');
const objectUrls = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target === 'offscreen' && message.action === 'ping') {
        sendResponse({ success: true });
    }
});

blobChannel.addEventListener('message', event => {
    const { action, requestId, blob } = event.data || {};
    if (typeof requestId !== 'string') return;

    if (action === 'createObjectUrl') {
        try {
            if (!(blob instanceof Blob)) {
                throw new Error('Invalid PDF data received.');
            }

            const previousUrl = objectUrls.get(requestId);
            if (previousUrl) URL.revokeObjectURL(previousUrl);

            const objectUrl = URL.createObjectURL(blob);
            objectUrls.set(requestId, objectUrl);
            blobChannel.postMessage({
                action: 'objectUrlCreated',
                requestId,
                objectUrl,
                success: true
            });
        } catch (error) {
            blobChannel.postMessage({
                action: 'objectUrlCreated',
                requestId,
                error: error.message,
                success: false
            });
        }
    } else if (action === 'revokeObjectUrl') {
        const objectUrl = objectUrls.get(requestId);
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrls.delete(requestId);
        }
        blobChannel.postMessage({
            action: 'objectUrlRevoked',
            requestId,
            success: true
        });
    }
});
