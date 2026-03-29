// Simple Node/Express + Socket.IO server for WhatsApp-clone

const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ✅ CORS Fix (important for frontend issues)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static client files
app.use(express.static(path.join(__dirname, 'client')));

// PeerJS server
const peerServer = ExpressPeerServer(server, { debug: false });
app.use('/peerjs', peerServer);

// health endpoint
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// Log HTTP upgrade attempts to help debug WebSocket upgrade failures
server.on('upgrade', (req, socket, head) => {
  try {
    console.log('📡 Upgrade request headers:', {
      url: req.url,
      upgrade: req.headers.upgrade,
      'sec-websocket-protocol': req.headers['sec-websocket-protocol']
    });
  } catch (e) {
    console.warn('Upgrade log error', e && e.message);
  }
});

// engine.io connection errors (low-level) — log for debugging
if (io && io.engine) {
  io.engine.on && io.engine.on('connection_error', (err) => {
    console.warn('⚠️ Engine connection_error:', err && err.message);
  });
}

// In-memory user store
const users = new Map(); // ✅ better than object
// In-memory messages store: key = conversationId (sorted sender:receiver), value = array of messages
// Message schema: { id, sender, receiver, message, type, username, timestamp, expiresAt }
const messages = new Map();

function getConversationKey(a, b) {
  const ids = [a, b].sort();
  return ids.join(':');
}

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id);

  // ================= USER JOIN =================
  socket.on('user-join', (data) => {
    if (!data?.username || !data?.room) return;

    users.set(socket.id, {
      socketId: socket.id,
      username: data.username,
      room: data.room,
      peerId: data.peerId || null
    });

    // Broadcast updated list
    io.emit('user-list', Array.from(users.values()));

    socket.broadcast.emit('user-connected', {
      username: data.username,
      userId: socket.id
    });
  });

  // ================= PRIVATE MESSAGE =================
  socket.on('private-message', (data) => {
    try {
      if (!data?.to || !data?.message) return;

      const targetSocket = io.sockets.sockets.get(data.to);

      if (!targetSocket) {
        console.warn("⚠️ User not found:", data.to);
        // still store the message so it can be delivered later when user comes online
      }

      // build canonical message object (use usernames as conversation keys)
      const timestamp = new Date().toISOString();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const senderUsername = data.username || (users.get(socket.id) && users.get(socket.id).username) || 'Unknown';
      const receiverUsername = data.toUsername || (users.get(data.to) && users.get(data.to).username) || data.to;

      const msgObj = {
        id,
        senderSocket: socket.id,
        receiverSocket: data.to,
        senderUsername,
        receiverUsername,
        message: data.message,
        type: data.type || 'text',
        username: senderUsername,
        timestamp,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
      };

      // persist in-memory by username conversation
      const convKey = getConversationKey(senderUsername, receiverUsername);
      const arr = messages.get(convKey) || [];
      arr.push(msgObj);
      messages.set(convKey, arr);

      const messagePayload = {
        ...msgObj,
        // legacy compatibility
        from: socket.id
      };

      // Send to receiver (if connected)
      if (targetSocket) {
        targetSocket.emit('private-message', {
          ...messagePayload,
          isOwn: false
        });
      }

      // Send to sender
      socket.emit('private-message', {
        ...messagePayload,
        isOwn: true
      });

    } catch (err) {
      console.error("❌ Message error:", err.message);
    }
  });

  // ================= FETCH MESSAGE HISTORY =================
  socket.on('fetch-messages', (data) => {
    try {
      // client should send `withUsername` (the other user's username)
      if (!data?.withUsername) return;
      const myUsername = (users.get(socket.id) && users.get(socket.id).username) || null;
      if (!myUsername) return;

      const convKey = getConversationKey(myUsername, data.withUsername);
      let arr = messages.get(convKey) || [];

      // filter expired messages and persist remaining
      const now = Date.now();
      const remaining = arr.filter(m => m.expiresAt > now);
      if (remaining.length !== arr.length) {
        if (remaining.length > 0) messages.set(convKey, remaining);
        else messages.delete(convKey);
        arr = remaining;
      }

      // send back history to requester only
      socket.emit('message-history', { with: data.withUsername, messages: arr });
    } catch (err) {
      console.error('❌ Fetch messages error:', err.message);
    }
  });

  // ================= DELETE MESSAGE (manual) =================
  socket.on('delete-message', (data) => {
    try {
      if (!data?.id || !data?.withUsername) return;
      const myUsername = (users.get(socket.id) && users.get(socket.id).username) || null;
      if (!myUsername) return;

      const convKey = getConversationKey(myUsername, data.withUsername);
      let arr = messages.get(convKey) || [];
      const remaining = arr.filter(m => m.id !== data.id);
      if (remaining.length !== arr.length) {
        if (remaining.length > 0) messages.set(convKey, remaining);
        else messages.delete(convKey);

        // notify both participants
        const findSocketByUsername = (username) => {
          for (const u of users.values()) {
            if (u.username === username) return io.sockets.sockets.get(u.socketId);
          }
          return null;
        };
        const aSocket = findSocketByUsername(myUsername);
        const bSocket = findSocketByUsername(data.withUsername);
        if (aSocket) aSocket.emit('message-deleted', { id: data.id });
        if (bSocket) bSocket.emit('message-deleted', { id: data.id });
      }
    } catch (err) {
      console.error('❌ Delete message error:', err.message);
    }
  });

  // ================= FILE UPLOAD =================
  socket.on('file-upload', (payload, cb) => {
    try {
      if (!payload?.to || !payload?.fileData) return;

      const toSocket = io.sockets.sockets.get(payload.to);
      const url = payload.fileData;

      // persist file message
      const timestamp = new Date().toISOString();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const msgObj = {
        id,
        sender: socket.id,
        receiver: payload.to,
        message: `📎 ${payload.fileType?.toUpperCase() || "FILE"}: ${payload.fileName}`,
        type: payload.fileType || 'file',
        username: payload.username || 'Unknown',
        mediaUrl: url,
        mediaName: payload.fileName,
        timestamp,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      };

      const senderUsername = payload.username || (users.get(socket.id) && users.get(socket.id).username) || 'Unknown';
      const receiverUsername = payload.toUsername || (users.get(payload.to) && users.get(payload.to).username) || payload.to;
      const convKey = getConversationKey(senderUsername, receiverUsername);
      const arr = messages.get(convKey) || [];
      arr.push(msgObj);
      messages.set(convKey, arr);

      const messagePayload = { ...msgObj, from: msgObj.sender };

      if (toSocket) {
        toSocket.emit('private-message', { ...messagePayload, isOwn: false });
      }

      socket.emit('private-message', { ...messagePayload, isOwn: true });

      cb?.({ success: true, url });

    } catch (err) {
      console.error("❌ File error:", err.message);
      cb?.({ success: false });
    }
  });

  // ================= VOICE MESSAGE =================
  socket.on('voice-message', (payload) => {
    try {
      if (!payload?.to || !payload?.audioData) return;

      const toSocket = io.sockets.sockets.get(payload.to);

      // persist voice message
      const timestamp = new Date().toISOString();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const msgObj = {
        id,
        sender: socket.id,
        receiver: payload.to,
        message: '🎤 Voice message',
        username: payload.username || 'Unknown',
        timestamp,
        type: 'voice',
        mediaUrl: payload.audioData,
        duration: payload.duration,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      };

      const senderUsername = payload.username || (users.get(socket.id) && users.get(socket.id).username) || 'Unknown';
      const receiverUsername = payload.toUsername || (users.get(payload.to) && users.get(payload.to).username) || payload.to;
      const convKey = getConversationKey(senderUsername, receiverUsername);
      const arr = messages.get(convKey) || [];
      arr.push(msgObj);
      messages.set(convKey, arr);

      const messagePayload = { ...msgObj, from: msgObj.sender };

      if (toSocket) {
        toSocket.emit('private-message', { ...messagePayload, isOwn: false });
      }

      socket.emit('private-message', { ...messagePayload, isOwn: true });

    } catch (err) {
      console.error("❌ Voice error:", err.message);
    }
  });

  // ================= CALL EVENTS =================
  socket.on('call-user', (data) => {
    const toSocket = io.sockets.sockets.get(data.to);
    if (toSocket) {
      toSocket.emit('incoming-call', {
        from: socket.id,
        fromUsername: data.fromUsername,
        fromPeerId: data.fromPeerId
      });
    }
  });

  socket.on('answer-call', (data) => {
    io.to(data.to).emit('call-answered', { from: socket.id });
  });

  socket.on('reject-call', (data) => {
    io.to(data.to).emit('call-rejected', { from: socket.id });
  });

  socket.on('end-call', (data) => {
    io.to(data.to).emit('call-ended', { from: socket.id });
  });

  // ================= DISCONNECT =================
  socket.on('disconnect', () => {
    const user = users.get(socket.id);

    if (user) {
      users.delete(socket.id);

      io.emit('user-disconnected', {
        username: user.username,
        userId: socket.id
      });

      io.emit('user-list', Array.from(users.values()));
    }

    console.log('❌ Disconnected:', socket.id);
  });
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;

// Background cleanup job: remove expired messages every minute
// run initial cleanup immediately then every minute
const runCleanup = () => {
  try {
    const now = Date.now();
    for (const [convKey, arr] of messages.entries()) {
      const remaining = arr.filter(m => m.expiresAt > now);
      const expired = arr.filter(m => m.expiresAt <= now);

      if (expired.length > 0) {
        // save remaining
        if (remaining.length > 0) {
          messages.set(convKey, remaining);
        } else {
          messages.delete(convKey);
        }

        // notify participants (convKey is usernames joined by ':')
        const parts = convKey.split(':');
        const [userA, userB] = parts;

        // resolve current socket ids for those usernames
        const findSocketByUsername = (username) => {
          for (const u of users.values()) {
            if (u.username === username) return io.sockets.sockets.get(u.socketId);
          }
          return null;
        };

        const aSocket = findSocketByUsername(userA);
        const bSocket = findSocketByUsername(userB);

        expired.forEach(m => {
          if (aSocket) aSocket.emit('message-deleted', { id: m.id });
          if (bSocket) bSocket.emit('message-deleted', { id: m.id });
        });
      }
    }
  } catch (err) {
    console.error('❌ Cleanup job error:', err.message);
  }
};

// initial run
runCleanup();

// scheduled run
setInterval(runCleanup, 60 * 1000);

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});