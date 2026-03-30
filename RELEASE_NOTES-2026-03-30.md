# Release Notes — 2026-03-30

## Version
- Bumped project notes for today: `v1.0.1` (document-only, no package.json change)

## Summary
This update implements a real-time call duration timer, fixes file upload duplication, and addresses several runtime resource loading errors (MIME/CORS). Changes focus on frontend JS and server-side lightweight dedupe.

## Files changed
- `client/chat.html`
  - Added `#callTimer` element in the video modal header.
  - Switched emoji picker CDN to jsDelivr to avoid MIME type issues.

- `client/style.css`
  - Added `.call-timer` styling (minimal, pill-style) and wrapped scrollbar CSS in `@supports` to avoid selector issues.

- `client/script.js`
  - Implemented call timer logic: `startCallTimer()`, `stopCallTimer()`, `resetCallTimer()` and wired to PeerJS/Socket lifecycle events.
  - Added client-side upload guard (`isUploadingFile`) and `dedupeKey` in `handleFileUpload()` to prevent duplicate document sends.
  - Replaced external MP3 notification playback with Web Audio API beep to avoid OpaqueResponseBlocking/CORS issues.
  - Minor robustness fixes: clear file input after uploads, stop calls on socket disconnect.

- `server.js`
  - Added `recentUploads` in-memory map and lightweight dedupe based on `dedupeKey` to ignore rapid duplicate file uploads (within 5s).

## Notes & How to test
1. Start server:

```bash
npm run start
# or
node server.js
```

2. Open two clients and log in as different users.
3. Start a video call — verify timer appears at top of the video modal and advances in MM:SS.
4. Upload a file from the sender — ensure only one message appears and sender UI shows upload success. Rapidly re-send same file to test dedupe (should return duplicate error).
5. Observe console/network: emoji picker should load from jsDelivr; no MIME or audio blocking errors should appear.

## Follow-ups (suggested)
- Optional: bump `package.json` version to `1.0.1` and commit the change.
- Add upload spinner/disabled state for the attach button while uploading.
- Replace ringtone external audio with local asset to avoid similar blocking problems.

---
Generated on 2026-03-30 by development assistant.