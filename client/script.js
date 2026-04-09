// Global variables
let socket;
let peer;
let localStream;
let remoteStream;
let screenStream;
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

// Call state management
let callState = 'idle'; // idle, calling, ringing, in-call, ended
let incomingCallData = null;
let pendingCallObject = null;

// Media recording variables
let mediaRecorder;
let recordedChunks = [];
let recordingTimer;
let recordingSeconds = 0;
let mediaStream;

// Bootstrap modal instances
let videoModalInstance;
let voiceModalInstance;
let incomingCallModalInstance;

// Audio elements
const ringtone = document.getElementById('ringtone');

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
    const voiceCallBtn = document.getElementById('voiceCallBtn');
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
    const shareScreenBtn = document.getElementById('shareScreenBtn');
    const screenShareIndicator = document.getElementById('screenShareIndicator');
    const callWithUser = document.getElementById('callWithUser');
    const remoteVideoLabel = document.getElementById('remoteVideoLabel');
    const attachFileBtn = document.getElementById('attachFileBtn');
    const emojiBtn = document.getElementById('emojiBtn');
    const fileInput = document.getElementById('fileInput');
    const startRecordingBtn = document.getElementById('startRecordingBtn');
    const stopRecordingBtn = document.getElementById('stopRecordingBtn');
    const sendVoiceBtn = document.getElementById('sendVoiceBtn');
    const recordingTimerElem = document.getElementById('recordingTimer');

    // Call timer elements & state
    const callTimerElem = document.getElementById('callTimer');
    let callTimerInterval = null;
    let callSeconds = 0;

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function startCallTimer() {
        // ensure only one timer runs
        if (callTimerInterval) clearInterval(callTimerInterval);
        callSeconds = 0;
        if (callTimerElem) {
            callTimerElem.textContent = formatTime(callSeconds);
            callTimerElem.style.display = 'inline-block';
        }
        callTimerInterval = setInterval(() => {
            callSeconds++;
            if (callTimerElem) callTimerElem.textContent = formatTime(callSeconds);
        }, 1000);
    }

    function stopCallTimer() {
        if (callTimerInterval) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
        }
    }

    function resetCallTimer() {
        stopCallTimer();
        callSeconds = 0;
        if (callTimerElem) {
            callTimerElem.textContent = formatTime(0);
            callTimerElem.style.display = 'none';
        }
    }

    // Initialize Bootstrap modals
    const videoModalElement = document.getElementById('videoModal');
    const voiceModalElement = document.getElementById('voiceModal');
    const incomingCallModalElement = document.getElementById('incomingCallModal');
    videoModalInstance = new bootstrap.Modal(videoModalElement);
    voiceModalInstance = new bootstrap.Modal(voiceModalElement);
    incomingCallModalInstance = new bootstrap.Modal(incomingCallModalElement);

    // Call state UI elements
    const callerNameElem = document.getElementById('callerName');
    const callerInitialElem = document.getElementById('callerInitial');
    const acceptCallBtn = document.getElementById('acceptCallBtn');
    const rejectCallBtn = document.getElementById('rejectCallBtn');

    acceptCallBtn.addEventListener('click', () => {
        if (incomingCallData) {
            handleAcceptCall();
        }
    });

    rejectCallBtn.addEventListener('click', () => {
        if (incomingCallData) {
            handleRejectCall();
        }
    });

    function playRingtone() {
        const rt = document.getElementById('ringtone');
        if (rt) rt.play().catch(e => console.log('Ringtone play failed:', e));
    }

    function stopRingtone() {
        const rt = document.getElementById('ringtone');
        if (rt) {
            rt.pause();
            rt.currentTime = 0;
        }
    }

    async function handleAcceptCall() {
        stopRingtone();
        incomingCallModalInstance.hide();
        
        socket.emit('answer-call', { to: incomingCallData.from });

        // If caller requested audio-only, prefer audio acquisition
        const wantsAudioOnly = !!(pendingCallObject && pendingCallObject.metadata && pendingCallObject.metadata.audioOnly) || !!incomingCallData?.audioOnly;
        const ok = wantsAudioOnly ? await startLocalAudio() : await startLocalVideo();
        if (!ok) {
            showAlert('Unable to access camera/mic to answer the call', 'danger');
            handleRejectCall();
            return;
        }

        if (pendingCallObject) {
            pendingCallObject.answer(localStream);
            currentCall = pendingCallObject;
            currentCallUser = { socketId: incomingCallData.from, username: incomingCallData.fromUsername };
            callState = 'in-call';

            currentCall.on('stream', (stream) => {
                remoteStream = stream;
                remoteVideo.srcObject = stream;
                videoModalInstance.show();
                remoteVideoLabel.innerHTML = `<i class="fas fa-user me-1"></i>${incomingCallData.fromUsername}`;
                callWithUser.innerHTML = wantsAudioOnly ? `<i class="fas fa-phone me-2"></i>Voice call with ${incomingCallData.fromUsername}` : `<i class="fas fa-video me-2"></i>Call with ${incomingCallData.fromUsername}`;
                startCallTimer();
            });

            currentCall.on('close', () => {
                endCall();
            });
        }
    }

    function handleRejectCall() {
        stopRingtone();
        incomingCallModalInstance.hide();
        
        if (incomingCallData) {
            socket.emit('reject-call', { to: incomingCallData.from });
        }
        
        if (pendingCallObject) {
            pendingCallObject.close();
        }
        
        incomingCallData = null;
        pendingCallObject = null;
        // Reset timer UI
        resetCallTimer();
        callState = 'idle';
    }

    // Initialize Emoji Picker
    if (emojiBtn && typeof EmojiButton !== 'undefined') {
        const picker = new EmojiButton({
            position: 'top-start',
            theme: 'light',
            autoHide: true
        });

        picker.on('emoji', selection => {
            messageInput.value += selection.emoji;
            messageInput.focus();
        });

        emojiBtn.addEventListener('click', () => {
            picker.togglePicker(emojiBtn);
        });
    }
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

    // Initialize Socket.IO with explicit origin and allow polling + websocket transports.
    // This provides a graceful upgrade path but also lets us debug transport errors.
    const serverOrigin = window.location.origin;
    socket = io(serverOrigin, {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        timeout: 20000
    });

    // Extra logging to help diagnose transport issues
    socket.on('error', (err) => {
        console.error('Socket generic error:', err);
    });

    socket.on('connect_error', (err) => {
        console.warn('Socket connect_error:', err && err.message ? err.message : err);
    });

    // If polling repeatedly fails, try forcing websocket transport as a fallback (useful behind some proxies)
    let connectErrorCount = 0;
    socket.on('connect_error', (err) => {
        connectErrorCount++;
        if (connectErrorCount >= 3) {
            console.warn('Multiple connect errors — retrying with websocket-only transport');
            try {
                socket.close();
            } catch (e) {}
            socket = io(serverOrigin, {
                transports: ['websocket'],
                reconnection: true,
                timeout: 20000
            });
        }
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
        // ensure any active call is ended and timer stopped
        try { endCall(); } catch (e) { /* ignore */ }
    });

    // Initialize PeerJS — prefer local peer server at /peerjs when available
    const peerHost = window.location.hostname;
    const peerPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
    peer = new Peer({
        host: peerHost,
        port: peerPort,
        secure: window.location.protocol === 'https:',
        path: '/peerjs'
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
        // Just store the call object, we will answer it when the user clicks Accept in the socket handler
        pendingCallObject = call;
        
        // In case peer call arrives before socket event, or if socket event failed
        if (callState !== 'ringing') {
            console.log('Peer call arrived before socket event');
            // We can wait for socket event or show UI here if we have metadata
            if (call.metadata?.fromUsername) {
                incomingCallData = {
                    from: call.metadata.fromSocketId,
                    fromUsername: call.metadata.fromUsername
                };
                
                callerNameElem.textContent = incomingCallData.fromUsername;
                callerInitialElem.textContent = incomingCallData.fromUsername.charAt(0).toUpperCase();
                incomingCallModalInstance.show();
                playRingtone();
                callState = 'ringing';
            }
        }
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
        if (callState !== 'idle') {
            // Busy, reject or notify
            console.log('Already in a call, ignoring incoming call from:', data.fromUsername);
            return;
        }

        console.log('Incoming call from:', data.fromUsername);
        incomingCallData = data;
        callState = 'ringing';

        callerNameElem.textContent = data.fromUsername;
        callerInitialElem.textContent = data.fromUsername.charAt(0).toUpperCase();
        incomingCallModalInstance.show();
        playRingtone();
    });

    socket.on('call-answered', async (data) => {
        console.log('Call answered');
        callState = 'in-call';
        // When we are the caller, we wait for the PeerJS stream to arrive
        if (currentCall) {
            currentCall.on('stream', (stream) => {
                remoteStream = stream;
                remoteVideo.srcObject = stream;
                videoModalInstance.show();
                remoteVideoLabel.innerHTML = `<i class="fas fa-user me-1"></i>${currentCallUser.username}`;
                callWithUser.innerHTML = `<i class="fas fa-video me-2"></i>Call with ${currentCallUser.username}`;
                startCallTimer();
            });
        }
    });

    socket.on('call-rejected', () => {
        endCall();
    });

    socket.on('call-ended', () => {
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

    // Voice call button (audio-only)
    voiceCallBtn.addEventListener('click', async () => {
        if (!currentChatUser) {
            showAlert('Please select a user to call', 'warning');
            return;
        }
        await startVoiceCall();
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

    shareScreenBtn.addEventListener('click', () => {
        if (screenStream) {
            stopScreenShare();
        } else {
            startScreenShare();
        }
    });

    // Detect screen sharing support and disable button on unsupported devices (common on mobile)
    try {
        const supportsScreenShare = !!(
            (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') ||
            typeof navigator.getDisplayMedia === 'function'
        );
        if (!supportsScreenShare) {
            shareScreenBtn.disabled = true;
            shareScreenBtn.title = 'Screen sharing not supported on this device/browser';
        }
    } catch (e) {
        // feature detection failed — be conservative and disable
        shareScreenBtn.disabled = true;
        shareScreenBtn.title = 'Screen sharing not supported on this device/browser';
    }

    async function startScreenShare() {
        if (!currentCall) return;
        // Many mobile browsers (and in-app webviews) do not support getDisplayMedia.
        // Try both standards and legacy API variants; if unavailable, inform the user.
        let stream = null;
        try {
            if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            } else if (typeof navigator.getDisplayMedia === 'function') {
                stream = await navigator.getDisplayMedia({ video: true });
            } else {
                showAlert('Screen sharing is not supported on this device/browser. Use desktop Chrome/Firefox for screen sharing.', 'warning');
                return;
            }
            screenStream = stream;
            
            // Replace track in PeerConnection
            const videoTrack = screenStream.getVideoTracks()[0];
            if (currentCall && currentCall.peerConnection) {
                const senders = currentCall.peerConnection.getSenders();
                const sender = senders.find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            }
            
            // Update UI
            localVideo.srcObject = screenStream;
            shareScreenBtn.innerHTML = '<i class="fas fa-stop me-1"></i>Stop Sharing';
            shareScreenBtn.classList.replace('btn-info', 'btn-warning');
            screenShareIndicator.style.display = 'block';
            
            // Handle manual stop from browser UI
            videoTrack.onended = () => {
                stopScreenShare();
            };
            
        } catch (err) {
            console.error('Error sharing screen:', err);
            // Friendly messages for common cases
            if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
                showAlert('Screen sharing permission denied or blocked by the browser.', 'warning');
            } else if (err && err.name === 'NotFoundError') {
                showAlert('No screen capture source found.', 'warning');
            } else {
                showAlert('Could not share screen: ' + (err && err.message ? err.message : String(err)), 'danger');
            }
        }
    }

    async function stopScreenShare() {
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        // Switch back to camera
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (currentCall && currentCall.peerConnection && videoTrack) {
                const senders = currentCall.peerConnection.getSenders();
                const sender = senders.find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            }
            localVideo.srcObject = localStream;
        }
        
        // Update UI
        shareScreenBtn.innerHTML = '<i class="fas fa-desktop me-1"></i>Share Screen';
        shareScreenBtn.classList.replace('btn-warning', 'btn-info');
        screenShareIndicator.style.display = 'none';
    }

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
        // show voice call button in header
        if (voiceCallBtn) voiceCallBtn.style.display = 'inline-flex';

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

    let isUploadingFile = false;
    async function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !currentChatUser) {
            fileInput.value = '';
            return;
        }

        if (isUploadingFile) {
            showAlert('Upload already in progress', 'warning');
            fileInput.value = '';
            return;
        }

        const fileType = file.type.split('/')[0];
        const validTypes = ['image', 'video', 'audio'];

        if (!validTypes.includes(fileType)) {
            showAlert('Please select an image, video, or audio file', 'warning');
            fileInput.value = '';
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            showAlert('File size must be less than 50MB', 'warning');
            fileInput.value = '';
            return;
        }

        isUploadingFile = true;
        setAttachUploading(true);
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const fileData = e.target.result;

                // lightweight client-side dedupe key: filename + first 64 chars
                const dedupeKey = file.name + '|' + (typeof file.size === 'number' ? file.size : '') + '|' + (fileData.slice ? fileData.slice(0, 64) : '');

                console.debug('Uploading file', { name: file.name, size: file.size, to: currentChatUser && currentChatUser.socketId });
                const attemptUpload = (attempt = 1) => {
                    socket.emit('file-upload', {
                    fileData: fileData,
                    fileName: file.name,
                    fileType: fileType,
                    username: currentUsername,
                    to: currentChatUser.socketId,
                    toUsername: currentChatUser.username,
                    dedupeKey
                    }, (response) => {
                        console.debug('Upload response', response, 'attempt', attempt);
                        if (response && response.success) {
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
                            isUploadingFile = false;
                            setAttachUploading(false);
                            fileInput.value = '';
                            return;
                        }

                        const err = response && response.error ? response.error : 'unknown_error';
                        // handle duplicate specially
                        if (err === 'duplicate') {
                            showAlert('Duplicate file ignored by server', 'warning');
                            console.info('Server reported duplicate upload');
                            isUploadingFile = false;
                            setAttachUploading(false);
                            fileInput.value = '';
                            return;
                        }

                        // if server reported file too large or invalid type, show message
                        if (err === 'file_too_large') {
                            showAlert('Upload rejected: file is too large', 'danger');
                        } else if (err === 'invalid_type') {
                            showAlert('Upload rejected: invalid file type', 'danger');
                        } else {
                            showAlert('File upload failed: ' + err, 'danger');
                        }

                        // retry once for transient server errors
                        if (attempt < 2 && (err === 'server_error' || err === 'unknown_error')) {
                            console.debug('Retrying upload, attempt', attempt + 1);
                            setTimeout(() => attemptUpload(attempt + 1), 800);
                            return;
                        }

                        isUploadingFile = false;
                        setAttachUploading(false);
                        fileInput.value = '';
                    });
                };

                attemptUpload(1);
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error('File upload error:', err);
            showAlert('Failed to upload file', 'danger');
            isUploadingFile = false;
            setAttachUploading(false);
            fileInput.value = '';
        }
    }

    // UI helper: show small spinner and disable attach while uploading
    function setAttachUploading(active) {
        const attachBtn = document.getElementById('attachFileBtn');
        if (!attachBtn) return;
        attachBtn.disabled = !!active;
        let spinner = document.getElementById('attachSpinner');
        if (active) {
            if (!spinner) {
                spinner = document.createElement('span');
                spinner.id = 'attachSpinner';
                spinner.className = 'spinner-wrapper ms-2';
                spinner.style.width = '16px';
                spinner.style.height = '16px';
                spinner.style.borderWidth = '2px';
                attachBtn.parentNode.insertBefore(spinner, attachBtn.nextSibling);
            }
        } else {
            if (spinner) spinner.remove();
        }
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
            case 'file':
                // Generic file attachment (pdf, docx, zip, etc.)
                content = `
                    <div class="file-attachment d-flex align-items-center gap-2 p-2 rounded bg-white border">
                        <i class="fas fa-file-alt fa-2x text-secondary"></i>
                        <div class="flex-grow-1">
                            <div class="fw-semibold small">${data.mediaName || 'Attachment'}</div>
                            <a href="${data.mediaUrl}" target="_blank" rel="noopener noreferrer" download="${data.mediaName || ''}" class="small text-muted">Open / Download</a>
                        </div>
                    </div>
                `;
                break;
            default:
                // Fallback for unknown media types — render link if available
                if (data.mediaUrl) {
                    content = `
                        <div class="file-attachment d-flex align-items-center gap-2 p-2 rounded bg-white border">
                            <i class="fas fa-file fa-2x text-secondary"></i>
                            <div class="flex-grow-1">
                                <div class="fw-semibold small">${data.mediaName || data.message || 'File'}</div>
                                <a href="${data.mediaUrl}" target="_blank" rel="noopener noreferrer" download class="small text-muted">Open / Download</a>
                            </div>
                        </div>
                    `;
                } else {
                    content = `<div class="message-text">${data.message || 'File'}</div>`;
                }
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

    async function startLocalAudio() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // stop any previous localStream tracks to avoid duplicates
            if (localStream && localStream !== stream) {
                try { localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
            }
            localStream = stream;
            // do not set localVideo for audio-only
            return true;
        } catch (err) {
            console.error('Error accessing microphone:', err);
            if (err && err.name === 'NotAllowedError') {
                showAlert('Microphone permission denied. Please allow microphone access.', 'danger');
            } else if (err && err.name === 'NotFoundError') {
                showAlert('No microphone found on this device.', 'danger');
            } else {
                showAlert('Error accessing microphone: ' + (err && err.message ? err.message : String(err)), 'danger');
            }
            return false;
        }
    }

    async function startCall() {
        if (!currentChatUser) {
            showAlert('Please select a user to call', 'warning');
            return;
        }

        if (callState !== 'idle') return;

        if (!localStream) {
            const success = await startLocalVideo();
            if (!success) return;
        }

        currentCallUser = currentChatUser;
        callState = 'calling';
        showSystemMessage(`Calling ${currentChatUser.username}...`, 'info');

        // include metadata so callee can identify caller and optionally notify back
        const call = peer.call(currentChatUser.peerId, localStream, { metadata: { fromUsername: currentUsername, fromSocketId: socket.id } });
        currentCall = call;

        call.on('stream', (stream) => {
            remoteStream = stream;
            remoteVideo.srcObject = stream;
            videoModalInstance.show();
            remoteVideoLabel.innerHTML = `<i class="fas fa-user me-1"></i>${currentChatUser.username}`;
            callWithUser.innerHTML = `<i class="fas fa-video me-2"></i>Call with ${currentChatUser.username}`;
            callState = 'in-call';
            startCallTimer();
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
            showAlert('Call failed: ' + err.message, 'danger');
            endCall();
        });
        call.on('close', () => {
            endCall();
        });

        socket.emit('call-user', {
            to: currentChatUser.socketId,
            from: socket.id,
            fromUsername: currentUsername,
            fromPeerId: myPeerId
        });
    }

    async function startVoiceCall() {
        if (!currentChatUser) {
            showAlert('Please select a user to call', 'warning');
            return;
        }
        if (callState !== 'idle') return;

        // get microphone only
        const ok = await startLocalAudio();
        if (!ok) return;

        currentCallUser = currentChatUser;
        callState = 'calling';
        showSystemMessage(`Calling ${currentChatUser.username} (voice)...`, 'info');

        const call = peer.call(currentChatUser.peerId, localStream, { metadata: { fromUsername: currentUsername, fromSocketId: socket.id, audioOnly: true } });
        currentCall = call;

        call.on('stream', (stream) => {
            remoteStream = stream;
            // attach to remoteVideo (video element) which can play audio-only streams
            remoteVideo.srcObject = stream;
            videoModalInstance.show();
            remoteVideoLabel.innerHTML = `<i class="fas fa-user me-1"></i>${currentChatUser.username}`;
            callWithUser.innerHTML = `<i class="fas fa-phone me-2"></i>Voice call with ${currentChatUser.username}`;
            callState = 'in-call';
            startCallTimer();
        });

        call.on('error', (err) => {
            console.error('Voice call error:', err);
            showAlert('Call failed: ' + (err && err.message ? err.message : String(err)), 'danger');
            endCall();
        });

        call.on('close', () => {
            endCall();
        });

        socket.emit('call-user', {
            to: currentChatUser.socketId,
            from: socket.id,
            fromUsername: currentUsername,
            fromPeerId: myPeerId,
            audioOnly: true
        });
    }

    function endCall() {
        stopRingtone();
        
        // ensure screen sharing is cleaned up if active
        try { if (screenStream) stopScreenShare(); } catch (e) { console.warn('Error stopping screen share on endCall', e); }

        if (incomingCallModalInstance) {
            incomingCallModalInstance.hide();
        }

        if (videoModalInstance) {
            videoModalInstance.hide();
        }

        const prevState = callState;
        callState = 'idle';

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
        
        if (incomingCallData) {
            socket.emit('end-call', { to: incomingCallData.from });
            incomingCallData = null;
        }

        pendingCallObject = null;
        
        // Reset call timer UI
        resetCallTimer();

        if (prevState === 'calling' || prevState === 'ringing') {
            showSystemMessage('Call Cancelled', 'warning');
        } else if (prevState === 'in-call') {
            showSystemMessage('Call Ended', 'info');
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
        if (voiceCallBtn) voiceCallBtn.style.display = 'none';
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

    // Use Web Audio API to produce a short notification beep (avoids external MP3/CORS issues)
    function playNotificationSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return; // not supported
            const ctx = new AudioCtx();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = 1000; // 1kHz beep
            g.gain.value = 0.0001;
            o.connect(g);
            g.connect(ctx.destination);
            // ramp up and down for pleasant sound
            const now = ctx.currentTime;
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
            o.start(now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
            o.stop(now + 0.2);
            // close context after short delay
            setTimeout(() => {
                try { ctx.close(); } catch (e) { /* ignore */ }
            }, 300);
        } catch (e) {
            console.log('Notification tone failed:', e);
        }
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