# WhatsApp Clone (Node, Express, Socket.IO, PeerJS)

A small WhatsApp-like clone demonstrating real-time chat, PeerJS video calling (WebRTC), and automatic message expiry (24 hours). Built with plain HTML/CSS/Bootstrap and vanilla JavaScript on the frontend, and Node.js + Express + Socket.IO + PeerJS on the backend.

This repository is intended as a compact demo and learning project. It uses an in-memory store for messages (suitable for development). See "Production / Persistence" below for migration notes.

---

## Features

- Real-time private messaging via Socket.IO
- Messages stored with a timestamp and automatically deleted after 24 hours (background job)
- Message history per conversation (username-based)
- File/voice messages (Data URLs) persisted to in-memory history
- Peer-to-peer video calling via PeerJS (WebRTC) with accept/reject, mute/disable video, and end-call handling
- Resilient Socket.IO client using polling fallback (avoids WebSocket frame issues)
- Health endpoint for quick checks: `GET /health`

---

## Quick Start (Local)

1. Clone the repo (you already have it locally).
2. Install dependencies and run:

```powershell
cd d:\React\whatsapp-clone
npm install
npm start
```

3. Open the app in your browser:

- http://localhost:3000 (login page -> chat.html)

Notes:
- If you see WebSocket frame/header errors in the browser console, the client is configured to use long-polling as a fallback (this keeps the app working). See "Troubleshooting" for WebSocket debugging tips.

---

## Files of Interest

- Server: `server.js` — Express + Socket.IO + PeerJS server and in-memory message store
- Client: `client/script.js` — chat UI, Socket.IO client, PeerJS handling
- Client HTML: `client/chat.html`, `client/index.html`
- Styles: `client/style.css`

---

## Socket / API Reference (Socket.IO)

Useful socket events used by the client and server:

- `user-join` — register a user (payload: `{ username, room, peerId }`)
- `user-list` — server → client: list of online users
- `private-message` — send/receive a message (server persists with `expiresAt`)
  - Message payload includes: `id, senderSocket, receiverSocket, senderUsername, receiverUsername, message, type, username, timestamp, expiresAt, from` (legacy `from` is socket id)
- `fetch-messages` — client requests history for conversation: `{ withUsername }` → server replies `message-history` with messages (expired messages filtered)
- `message-history` — server → client: `{ with: username, messages: [...] }`
- `message-deleted` — server → client: `{ id }` (notifies both participants that a message was deleted/expired)
- `delete-message` — client → server (manual deletion): `{ id, withUsername }`
- Call flow (signalling via server): `call-user`, `incoming-call`, `answer-call`, `reject-call`, `call-answered`, `call-rejected`, `end-call`

---

## Message Expiry (24 hours)

- Messages are saved in-memory with an `expiresAt` millisecond timestamp.
- The server runs an initial cleanup on start and a cleanup every minute to remove expired messages and notify participants via `message-deleted`.
- When clients request history (`fetch-messages`), expired messages are filtered before returning.

To change expiry duration, edit `server.js` where `expiresAt` is set (currently `Date.now() + 24 * 60 * 60 * 1000`). For production, use a DB TTL index instead (see below).

---

## Production / Persistence (recommended)

The project currently uses an in-memory store — this is lost on server restart and not suitable for production. Recommended migration path:

- Use MongoDB and a TTL index on the `expiresAt` field to automatically remove expired messages.
  - Example schema (Mongoose):

```js
const messageSchema = new mongoose.Schema({
  senderSocket: String,
  receiverSocket: String,
  senderUsername: String,
  receiverUsername: String,
  message: String,
  type: String,
  mediaUrl: String,
  timestamp: Date,
  expiresAt: Date
});
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

- Save messages in a `messages` collection. The DB will remove expired documents automatically.
- Make sure to update server logic to query DB for history and emit socket events based on DB operations.

---

## Debugging WebSocket / "Invalid frame header"

If the browser console shows errors like `Invalid frame header` or `connection interrupted`:

1. Proxy issues: If you run behind nginx/IIS/another reverse proxy, ensure it forwards WebSocket upgrades. For nginx example:

```nginx
location /socket.io/ {
  proxy_pass http://127.0.0.1:3000/socket.io/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "Upgrade";
  proxy_set_header Host $host;
}
```

2. TLS mismatch: If your page is served over HTTPS, use `wss://` for Socket.IO and ensure the server supports TLS (or terminate TLS at the proxy).
3. Other services: confirm nothing else is listening on port 3000 that returns non-WebSocket frames.
4. Logs: server now logs `upgrade` headers and engine connection errors to help diagnose. Reproduce the error and inspect your server console for `📡 Upgrade request headers:` entries.
5. Quick workaround: The client is configured to use polling (`transports: ['polling']`) to remain functional until the root cause is fixed.

---

## Free Deployment Options

- Fly.io — easy Node deployments, supports WebSockets and PeerJS. Free tier available.
- Render — free tier for web services, supports WebSocket on paid plans (verify free tier limitations).
- Replit — simple, free development hosting (may sleep). Websockets generally work.
- Vercel / Netlify — ideal for frontend only; pair with a Render/Fly backend for Socket.IO + PeerJS.

Quick Fly example:

```bash
# install flyctl and login
fly auth login
fly launch --name whatsapp-clone --no-deploy
# ensure package.json has "start": "node server.js"
fly deploy
```

---

## Troubleshooting & Next Steps

- To enable true WebSocket transport, reproduce the failure and paste your server `upgrade` logs here — I can suggest exact proxy settings.
- To persist messages across restarts, I can convert the in-memory store to MongoDB (add migration, TTL index, and updated socket flows).
- To show expired messages as placeholders (instead of removing), I can change the client behavior.
- To improve call reliability, we can move PeerJS server to a dedicated host or host it behind a proxy that supports websockets.

---

## License

MIT — feel free to adapt for learning and demo purposes.

---

If you want, I can:
- Add a `docker-compose` and `Dockerfile` for easier deployment.
- Implement MongoDB persistence and TTL migration.
- Provide an nginx config snippet tailored to your hosting environment.

Tell me which of these you'd like next.