// Global variables
let socket;
let peer;
let localStream;
let remoteStream;
let currentCall;
let currentUsername;
let currentRoom;
let myPeerId;
let currentChatUser = null;
let currentCallUser = null;
let isAudioMuted = false;
let isVideoDisabled = false;
// prevent concurrent camera startups
let isStartingLocalVideo = false;

// Media recording variables
let mediaRecorder;
let recordedChunks = [];
let recordingTimer;
let recordingSeconds = 0;
let mediaStream;

// Bootstrap modal instances
let videoModalInstance;
let voiceModalInstance;

// DOM Elements
const loginForm = document.getElementById('login-form');

// Handle login
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const room = document.getElementById('room').value.trim();

        if (username && room) {
            localStorage.setItem('username', username);
            localStorage.setItem('room', room);
            window.location.href = 'chat.html';
        } else {
            showAlert('Please enter both username and room name', 'warning');
        }
    });
}

// Chat page initialization
if (window.location.pathname.includes('chat.html')) {
    currentUsername = localStorage.getItem('username');
    currentRoom = localStorage.getItem('room');

    if (!currentUsername || !currentRoom) {
        window.location.href = 'index.html';
    }

    initializeChat();
}

async function initializeChat() {
    // DOM Elements
    const currentUsernameElem = document.getElementById('currentUsername');
    const currentRoomElem = document.getElementById('currentRoom');
    const userInitial = document.getElementById('userInitial');
    const usersList = document.getElementById('usersList');
    const chatMessages = document.getElementById('chatMessages');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const startCallBtn = document.getElementById('startCallBtn');
    const voiceMessageBtn = document.getElementById('voiceMessageBtn');
    const chatWithUser = document.getElementById('chatWithUser');
    const userStatus = document.getElementById('userStatus');
    const chatInitial = document.getElementById('chatInitial');
    const chatInputContainer = document.getElementById('chatInputContainer');
    const logoutBtn = document.getElementById('logoutBtn');
    const onlineCount = document.getElementById('onlineCount');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const endCallBtn = document.getElementById('endCallBtn');
    const muteAudioBtn = document.getElementById('muteAudioBtn');
    const disableVideoBtn = document.getElementById('disableVideoBtn');
    const callWithUser = document.getElementById('callWithUser');
    const remoteVideoLabel = document.getElementById('remoteVideoLabel');
    const attachFileBtn = document.getElementById('attachFileBtn');
    const fileInput = document.getElementById('fileInput');
    const startRecordingBtn = document.getElementById('startRecordingBtn');
    const stopRecordingBtn = document.getElementById('stopRecordingBtn');
    const sendVoiceBtn = document.getElementById('sendVoiceBtn');
    const recordingTimerElem = document.getElementById('recordingTimer');

    // Initialize Bootstrap modals
    const videoModalElement = document.getElementById('videoModal');
    const voiceModalElement = document.getElementById('voiceModal');
    videoModalInstance = new bootstrap.Modal(videoModalElement);
    voiceModalInstance = new bootstrap.Modal(voiceModalElement);

    // Mobile sidebar toggle controls
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    const menuOverlay = document.getElementById('menuOverlay');
    const sidebar = document.getElementById('sidebar');
    const backToUsersBtn = document.getElementById('backToUsersBtn');

    function openSidebar() {
        sidebar.classList.add('open');
        if (menuOverlay) menuOverlay.classList.add('active');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        if (menuOverlay) menuOverlay.classList.remove('active');
    }

    menuToggleBtn?.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
    });

    menuOverlay?.addEventListener('click', closeSidebar);

    backToUsersBtn?.addEventListener('click', () => {
        // show sidebar again on mobile
        openSidebar();
    });

    // Close video modal on end call
    videoModalElement.addEventListener('hidden.bs.modal', () => {
        if (currentCall) {
            endCall();
        }
    });

    // Update header
    currentUsernameElem.textContent = currentUsername;
    currentRoomElem.textContent = `Room: ${currentRoom}`;
    userInitial.textContent = currentUsername.charAt(0).toUpperCase();

    // Initialize Socket.IO using long-polling first to avoid WebSocket "Invalid frame header" errors
    // If you need true WebSocket transport, check server/proxy TLS and upgrade handling.
    socket = io({
        transports: ['polling'], // force polling to avoid websocket frame errors
        reconnection: true,
        reconnectionAttempts: Infinity,
        timeout: 20000
    });

    // Connection error handling
    socket.on('connect_error', (err) => {
        console.warn('Socket connect_error:', err && err.message);
        showSystemMessage('Connection error. Retrying...', 'warning');
    });

    socket.on('reconnect_attempt', () => {
        showSystemMessage('Reconnecting...', 'info');
    });

    socket.on('reconnect', (attempt) => {
        showSystemMessage('Reconnected to server', 'success');
    });

    socket.on('disconnect', (reason) => {
        if (reason === 'io client disconnect') return; // manual disconnect
        console.warn('Socket disconnected:', reason);
        showSystemMessage('Disconnected from server', 'warning');
    });

    // Initialize PeerJS
    peer = new Peer({
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/'
    });

    // PeerJS events
    peer.on('open', (id) => {
        myPeerId = id;
        console.log('My Peer ID:', myPeerId);

        socket.emit('user-join', {
            username: currentUsername,
            room: currentRoom,
            peerId: myPeerId
        });
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        showSystemMessage('Camera/Video error. Please check permissions.', 'error');
    });

    // Handle incoming PeerJS call (MediaConnection)
    peer.on('call', async (call) => {
        // show a simple accept/reject prompt
        const fromUsername = call.metadata?.fromUsername || 'Unknown';
        const accept = confirm(`${fromUsername} is calling you. Accept?`);

        if (!accept) {
            try { call.close(); } catch (e) { /* ignore */ }
            // try to notify caller via socket if metadata includes socket id
            if (call.metadata?.fromSocketId) {
                socket.emit('reject-call', { to: call.metadata.fromSocketId });
            }
            return;
        }

        const ok = await startLocalVideo();
        if (!ok) {
            showAlert('Unable to access camera/mic to answer the call', 'danger');
            return;
        }

        // answer the call with our local stream
        call.answer(localStream);
        currentCall = call;

        call.on('stream', (stream) => {
            remoteStream = stream;
            remoteVideo.srcObject = stream;
            videoModalInstance.show();
            remoteVideoLabel.innerHTML = `<i class="fas fa-user me-1"></i>${fromUsername}`;
            callWithUser.innerHTML = `<i class="fas fa-video me-2"></i>Call with ${fromUsername}`;
        });

        call.on('close', () => {
            endCall();
        });
    });

    // Socket.IO event handlers
    socket.on('user-list', (users) => {
        updateUserList(users);
    });

    socket.on('user-connected', (data) => {
        console.log('User connected:', data && data.username ? data.username : data);
        showSystemMessage(`${data.username} joined the chat`, 'info');
        showNotification(data.username, 'joined the chat');
    });

    socket.on('user-disconnected', (data) => {
        console.log('User disconnected:', data);
        showSystemMessage(`${data.username} left the chat`, 'info');

        if (currentChatUser && currentChatUser.socketId === data.userId) {
            clearCurrentChat();
        }

        if (currentCallUser && currentCallUser.socketId === data.userId) {
            endCall();
            showSystemMessage(`${data.username} ended the call`, 'warning');
        }
    });

    // Private message handler
    socket.on('private-message', (data) => {
        displayMediaMessage(data);

        if (!data.isOwn && (!currentChatUser || currentChatUser.socketId !== data.from)) {
            showNotification(data.username, data.message);
            playNotificationSound();
        }
    });

    // Message history response
    socket.on('message-history', (payload) => {
        if (!payload || !payload.messages) return;
        // If the history is for the currently selected user, render it
        if (!currentChatUser || payload.with !== currentChatUser.socketId) return;

        chatMessages.innerHTML = '';
        payload.messages.forEach(m => displayMediaMessage({
            ...m,
            isOwn: m.sender === socket.id
        }));
    });

    // Message deleted handler
    socket.on('message-deleted', (payload) => {
        if (!payload || !payload.id) return;
        // find message element by data-message-id and remove it
        const msgEl = chatMessages.querySelector(`[data-message-id="${payload.id}"]`);
        if (msgEl) {
            msgEl.remove();
            showSystemMessage('A message expired and was removed', 'info');
        }
    });

    // Video call notification (lightweight). Actual PeerJS call object handled in peer.on('call')
    socket.on('incoming-call', async (data) => {
        console.log('Incoming call from:', data.fromUsername);
        showSystemMessage(`${data.fromUsername} is calling...`, 'info');
    });

    socket.on('call-answered', async (data) => {
        console.log('Call answered');
        if (currentCall) {
            currentCall.on('stream', (stream) => {
                remoteStream = stream;
                remoteVideo.srcObject = stream;
                videoModalInstance.show();
                remoteVideoLabel.innerHTML = `<i class="fas fa-user me-1"></i>${currentCallUser.username}`;
                callWithUser.innerHTML = `<i class="fas fa-video me-2"></i>Call with ${currentCallUser.username}`;
            });
        }
    });

    socket.on('call-rejected', () => {
        showSystemMessage('Call rejected', 'warning');
        endCall();
    });

    socket.on('call-ended', () => {
        showSystemMessage('Call ended', 'info');
        endCall();
    });

    // Logout button
    logoutBtn.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = 'index.html';
    });

    // Send message
    sendBtn.addEventListener('click', sendPrivateMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendPrivateMessage();
        }
    });

    // Start call button
    startCallBtn.addEventListener('click', async () => {
        if (currentChatUser) {
            await startCall();
        }
    });

    // Voice message button
    voiceMessageBtn.addEventListener('click', () => {
        if (currentChatUser) {
            voiceModalInstance.show();
        }
    });

    // Close voice modal handler
    document.getElementById('closeVoiceBtn')?.addEventListener('click', () => {
        voiceModalInstance.hide();
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        }
    });

    // Start recording
    startRecordingBtn.addEventListener('click', startRecording);
    stopRecordingBtn.addEventListener('click', stopRecording);
    sendVoiceBtn.addEventListener('click', sendVoiceMessage);

    // Attach file button
    attachFileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    // File input change handler
    fileInput.addEventListener('change', handleFileUpload);

    // Video call controls
    endCallBtn.addEventListener('click', () => {
        endCall();
        videoModalInstance.hide();
    });

    muteAudioBtn.addEventListener('click', () => {
        if (localStream) {
            const audioTracks = localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                isAudioMuted = !isAudioMuted;
                audioTracks[0].enabled = !isAudioMuted;
                muteAudioBtn.innerHTML = isAudioMuted ?
                    '<i class="fas fa-microphone-slash me-1"></i>Unmute' :
                    '<i class="fas fa-microphone me-1"></i>Mute';
            }
        }
    });

    disableVideoBtn.addEventListener('click', () => {
        if (localStream) {
            const videoTracks = localStream.getVideoTracks();
            if (videoTracks.length > 0) {
                isVideoDisabled = !isVideoDisabled;
                videoTracks[0].enabled = !isVideoDisabled;
                disableVideoBtn.innerHTML = isVideoDisabled ?
                    '<i class="fas fa-video-slash me-1"></i>Enable' :
                    '<i class="fas fa-video me-1"></i>Disable';
            }
        }
    });

    function updateUserList(users) {
        const otherUsers = users.filter(user => user.socketId !== socket.id);
        onlineCount.textContent = `${otherUsers.length} online`;

        if (otherUsers.length === 0) {
            usersList.innerHTML = `
                <div class="text-center py-4 text-muted">
                    <i class="fas fa-user-friends fa-2x mb-2"></i>
                    <p class="mb-0">No other users online</p>
                </div>
            `;
            return;
        }

        usersList.innerHTML = '';
        otherUsers.forEach(user => {
            const userElement = createUserElement(user);
            usersList.appendChild(userElement);
        });
    }

    function createUserElement(user) {
        const div = document.createElement('div');
        div.className = 'user-item';
        if (currentChatUser && currentChatUser.socketId === user.socketId) {
            div.classList.add('active');
        }

        const initial = user.username.charAt(0).toUpperCase();
        const colors = ['#075e54', '#128c7e', '#25d366', '#34b7f1', '#dcf8c6'];
        const colorIndex = user.username.length % colors.length;

        div.innerHTML = `
            <div class="user-avatar" style="background: ${colors[colorIndex]}">
                ${initial}
            </div>
            <div class="user-info-text">
                <div class="user-name fw-semibold">${escapeHtml(user.username)}</div>
                <div class="user-status">
                    <i class="fas fa-circle text-success me-1" style="font-size: 8px;"></i>
                    Online
                </div>
            </div>
        `;

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            selectUser(user, e);
        });

        return div;
    }

    function selectUser(user, e) {
        currentChatUser = user;

        document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));

        if (e && e.currentTarget) {
            e.currentTarget.classList.add('active');
        } else if (e && e.target) {
            const item = e.target.closest('.user-item');
            if (item) item.classList.add('active');
        }

        chatWithUser.textContent = user.username;
        userStatus.innerHTML = `<i class="fas fa-circle text-success me-1" style="font-size: 8px;"></i>Online`;
        chatInitial.textContent = user.username.charAt(0).toUpperCase();

        chatInputContainer.style.display = 'block';
        startCallBtn.style.display = 'flex';
        voiceMessageBtn.style.display = 'flex';

        chatMessages.innerHTML = '';
        // request chat history with selected user
        socket.emit('fetch-messages', { withUsername: user.username });
        // on small devices, close the sidebar so chat is visible
        if (window.innerWidth <= 768) {
            const sb = document.getElementById('sidebar');
            const overlay = document.getElementById('menuOverlay');
            sb && sb.classList.remove('open');
            overlay && overlay.classList.remove('active');
        }
        showSystemMessage(`You are now chatting with ${user.username}`, 'success');
        messageInput.focus();
    }

    function sendPrivateMessage() {
        const message = messageInput.value.trim();
        if (message && currentChatUser) {
            const timestamp = new Date().toLocaleTimeString();

            socket.emit('private-message', {
                to: currentChatUser.socketId,
                message: message,
                username: currentUsername,
                toUsername: currentChatUser.username,
                timestamp: timestamp,
                type: 'text'
            });

            // Don't locally display here — the server will emit the
            // `private-message` back to the sender (isOwn: true) which
            // is handled in the socket listener and will display the
            // message once. This avoids duplicate messages in the UI.

            messageInput.value = '';
        } else if (!currentChatUser) {
            showSystemMessage('Please select a user to chat with', 'warning');
        }
    }

    async function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !currentChatUser) return;

        const fileType = file.type.split('/')[0];
        const validTypes = ['image', 'video', 'audio'];

        if (!validTypes.includes(fileType)) {
            showAlert('Please select an image, video, or audio file', 'warning');
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            showAlert('File size must be less than 50MB', 'warning');
            return;
        }

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const fileData = e.target.result;

                socket.emit('file-upload', {
                    fileData: fileData,
                    fileName: file.name,
                    fileType: fileType,
                    username: currentUsername,
                    to: currentChatUser.socketId,
                    toUsername: currentChatUser.username
                }, (response) => {
                    if (response.success) {
                        const timestamp = new Date().toLocaleTimeString();
                        displayMediaMessage({
                            message: `<i class="fas fa-paperclip me-1"></i>${fileType.toUpperCase()}: ${file.name}`,
                            username: currentUsername,
                            timestamp: timestamp,
                            isOwn: true,
                            type: fileType,
                            mediaUrl: response.url,
                            mediaName: file.name
                        });
                        showAlert('File uploaded successfully!', 'success');
                    } else {
                        showAlert('File upload failed: ' + response.error, 'danger');
                    }
                });
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error('File upload error:', err);
            showAlert('Failed to upload file', 'danger');
        }

        fileInput.value = '';
    }

    function displayMediaMessage(data) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${data.isOwn ? 'sent' : 'received'} mb-2`;
        if (data.id) messageDiv.setAttribute('data-message-id', data.id);

        let content = '';

        switch (data.type) {
            case 'text':
                content = `<div class="message-text">${data.message}</div>`;
                break;

            case 'image':
                content = `
                    <div class="message-text">${data.message}</div>
                    <div class="media-message mt-2" onclick="window.open('${data.mediaUrl}', '_blank')">
                        <img src="${data.mediaUrl}" alt="${data.mediaName}" class="img-fluid rounded">
                    </div>
                `;
                break;

            case 'video':
                content = `
                    <div class="message-text">${data.message}</div>
                    <div class="media-message mt-2">
                        <video controls class="w-100 rounded">
                            <source src="${data.mediaUrl}" type="video/mp4">
                        </video>
                    </div>
                `;
                break;

            case 'audio':
                content = `
                    <div class="message-text">${data.message}</div>
                    <audio controls class="audio-player w-100 mt-2">
                        <source src="${data.mediaUrl}" type="audio/mpeg">
                    </audio>
                `;
                break;

            case 'voice':
                content = `
                    <div class="voice-message">
                        <button class="play-voice-btn btn btn-sm btn-success rounded-circle" onclick="this.nextElementSibling.play()">
                            <i class="fas fa-play"></i>
                        </button>
                        <audio style="display: none;">
                            <source src="${data.mediaUrl}" type="audio/webm">
                        </audio>
                        <div class="voice-duration ms-2">${data.duration || '0:00'}</div>
                    </div>
                `;
                break;
        }

        // format timestamp if ISO provided
        let timeLabel = '';
        try {
            timeLabel = data.timestamp ? new Date(data.timestamp).toLocaleString() : '';
        } catch (e) {
            timeLabel = data.timestamp || '';
        }

        messageDiv.innerHTML = `
            <div class="message-header d-flex justify-content-between align-items-center mb-1">
                <span class="message-username fw-semibold">${data.isOwn ? 'You' : escapeHtml(data.username)}</span>
                <span class="message-time small text-muted ms-2">${timeLabel}</span>
            </div>
            ${content}
        `;

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        const welcomeMsg = chatMessages.querySelector('.text-center');
        if (welcomeMsg && welcomeMsg.classList.contains('text-center')) {
            welcomeMsg.remove();
        }
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStream = stream;

            mediaRecorder = new MediaRecorder(stream);
            recordedChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onloadend = () => {
                    const audioData = reader.result;
                    window.recordedAudio = {
                        data: audioData,
                        duration: recordingSeconds
                    };
                    sendVoiceBtn.style.display = 'block';
                    startRecordingBtn.style.display = 'none';
                };
                reader.readAsDataURL(blob);
            };

            mediaRecorder.start();
            startRecordingBtn.style.display = 'none';
            stopRecordingBtn.style.display = 'block';

            // Start timer
            recordingSeconds = 0;
            recordingTimer = setInterval(() => {
                recordingSeconds++;
                const minutes = Math.floor(recordingSeconds / 60);
                const seconds = recordingSeconds % 60;
                recordingTimerElem.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }, 1000);

        } catch (err) {
            console.error('Error starting recording:', err);
            showAlert('Could not access microphone', 'danger');
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
            }
            clearInterval(recordingTimer);
            stopRecordingBtn.style.display = 'none';
        }
    }

    function sendVoiceMessage() {
        if (window.recordedAudio && currentChatUser) {
            const timestamp = new Date().toLocaleTimeString();

            socket.emit('voice-message', {
                to: currentChatUser.socketId,
                audioData: window.recordedAudio.data,
                username: currentUsername,
                toUsername: currentChatUser.username,
                timestamp: timestamp,
                duration: recordingTimerElem.textContent
            });

            // The server will emit the voice message back to the sender
            // (isOwn: true). Avoid showing it locally here to prevent
            // duplicate messages appearing in the sender UI.

            // Reset
            window.recordedAudio = null;
            sendVoiceBtn.style.display = 'none';
            startRecordingBtn.style.display = 'block';
            voiceModalInstance.hide();
            recordingTimerElem.textContent = '0:00';
        }
    }

    async function startLocalVideo() {
        if (isStartingLocalVideo) {
            // already trying — return whether we have a stream
            return !!localStream;
        }

        isStartingLocalVideo = true;
        try {
            // try progressively degraded constraints to reduce chance of timeout
            const constraintsList = [
                { video: true, audio: true },
                { video: { width: { ideal: 640 } }, audio: true },
                { video: false, audio: true }
            ];

            let lastErr = null;
            for (const constraints of constraintsList) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia(constraints);
                    localStream = stream;
                    localVideo.srcObject = stream;
                    isStartingLocalVideo = false;
                    return true;
                } catch (err) {
                    lastErr = err;
                    console.warn('getUserMedia attempt failed:', err && err.name, err && err.message);
                    // if permissions denied, don't keep retrying
                    if (err && err.name === 'NotAllowedError') break;
                }
            }

            // if we fall through, throw last error to be handled below
            throw lastErr;
        } catch (err) {
            console.error('Error accessing camera:', err);
            if (err && err.name === 'NotAllowedError') {
                showAlert('Camera permission denied. Please allow camera access.', 'danger');
            } else if (err && err.name === 'NotFoundError') {
                showAlert('No camera found on this device.', 'danger');
            } else if (err && err.name === 'AbortError') {
                showAlert('Timeout starting video source. Close other apps using the camera and try again.', 'danger');
            } else {
                showAlert('Error accessing camera: ' + (err && err.message ? err.message : String(err)), 'danger');
            }
            isStartingLocalVideo = false;
            return false;
        }
    }

    async function startCall() {
        if (!currentChatUser) {
            showAlert('Please select a user to call', 'warning');
            return;
        }

        if (!localStream) {
            const success = await startLocalVideo();
            if (!success) return;
        }

        currentCallUser = currentChatUser;

        // include metadata so callee can identify caller and optionally notify back
        const call = peer.call(currentChatUser.peerId, localStream, { metadata: { fromUsername: currentUsername, fromSocketId: socket.id } });
        currentCall = call;

        call.on('stream', (stream) => {
            remoteStream = stream;
            remoteVideo.srcObject = stream;
            videoModalInstance.show();
            remoteVideoLabel.innerHTML = `<i class="fas fa-user me-1"></i>${currentChatUser.username}`;
            callWithUser.innerHTML = `<i class="fas fa-video me-2"></i>Call with ${currentChatUser.username}`;
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
            showAlert('Call failed: ' + err.message, 'danger');
            endCall();
        });

        socket.emit('call-user', {
            to: currentChatUser.socketId,
            from: socket.id,
            fromUsername: currentUsername,
            fromPeerId: myPeerId,
            signal: call
        });
    }

    function endCall() {
        if (currentCall) {
            currentCall.close();
            currentCall = null;
        }

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        if (remoteStream) {
            remoteStream.getTracks().forEach(track => track.stop());
            remoteStream = null;
        }

        localVideo.srcObject = null;
        remoteVideo.srcObject = null;

        isAudioMuted = false;
        isVideoDisabled = false;
        muteAudioBtn.innerHTML = '<i class="fas fa-microphone me-1"></i>Mute';
        disableVideoBtn.innerHTML = '<i class="fas fa-video me-1"></i>Disable';

        if (currentCallUser) {
            socket.emit('end-call', { to: currentCallUser.socketId });
            currentCallUser = null;
        }
    }

    function showSystemMessage(message, type = 'info') {
        const systemDiv = document.createElement('div');
        systemDiv.className = 'system-message text-center mb-2';

        let icon = '';
        switch (type) {
            case 'success': icon = '<i class="fas fa-check-circle text-success me-1"></i>'; break;
            case 'warning': icon = '<i class="fas fa-exclamation-triangle text-warning me-1"></i>'; break;
            case 'error': icon = '<i class="fas fa-times-circle text-danger me-1"></i>'; break;
            default: icon = '<i class="fas fa-info-circle text-info me-1"></i>';
        }

        systemDiv.innerHTML = `${icon}${message}`;
        chatMessages.appendChild(systemDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        setTimeout(() => {
            systemDiv.remove();
        }, 3000);
    }

    function showAlert(message, type = 'info') {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show custom-alert`;
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alertDiv);

        setTimeout(() => {
            alertDiv.remove();
        }, 3000);
    }

    function clearCurrentChat() {
        currentChatUser = null;
        chatWithUser.textContent = 'Select a user to chat';
        userStatus.innerHTML = `<i class="fas fa-circle text-secondary me-1" style="font-size: 8px;"></i>Click on a user to start chatting`;
        chatInitial.textContent = '?';
        chatInputContainer.style.display = 'none';
        startCallBtn.style.display = 'none';
        voiceMessageBtn.style.display = 'none';
        chatMessages.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-comments fa-3x text-muted mb-3"></i>
                <p class="text-muted">👋 Welcome to WhatsApp Clone!<br>Select a user from the sidebar to start chatting.</p>
            </div>
        `;
    }

    function showNotification(username, message) {
        if (Notification.permission === 'granted') {
            new Notification(`${username} sent a message`, {
                body: message,
                icon: 'https://cdn-icons-png.flaticon.com/512/733/733585.png'
            });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    function playNotificationSound() {
        const audio = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3');
        audio.volume = 0.3;
        audio.play().catch(e => console.log('Audio play failed:', e));
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Request notification permission
    if ('Notification' in window) {
        Notification.requestPermission();
    }
}