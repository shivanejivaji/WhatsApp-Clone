import { useEffect, useRef, useState, useCallback } from 'react';

const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const CALL_STATUS = {
  IDLE: 'idle',
  CALLING: 'calling',
  RINGING: 'ringing',
  CONNECTED: 'connected',
  ENDED: 'ended',
};

export const useWebRTC = (socket, currentUserId) => {
  const [callStatus, setCallStatus] = useState(CALL_STATUS.IDLE);
  const [remoteUser, setRemoteUser] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  
  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteStream = useRef(new MediaStream());
  const timerRef = useRef(null);

  const endCall = useCallback(() => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    
    setCallStatus(CALL_STATUS.ENDED);
    setRemoteUser(null);
    clearInterval(timerRef.current);
    setCallDuration(0);
    
    setTimeout(() => setCallStatus(CALL_STATUS.IDLE), 3000);
  }, []);

  const startTimer = () => {
    clearInterval(timerRef.current);
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const createPeerConnection = useCallback((targetId) => {
    const pc = new RTCPeerConnection(STUN_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          to: targetId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.current.addTrack(track);
      });
    };

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current);
      });
    }

    peerConnection.current = pc;
    return pc;
  }, [socket]);

  const initiateCall = async (targetUser) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      setRemoteUser(targetUser);
      setCallStatus(CALL_STATUS.CALLING);

      const pc = createPeerConnection(targetUser.socketId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('call-user', {
        to: targetUser.socketId,
        fromUsername: currentUserId, // Replace with actual username
        offer: offer, // We'll combine signaling if needed, or send separately
      });

      // Handle timeout
      setTimeout(() => {
        if (callStatus === CALL_STATUS.CALLING || callStatus === CALL_STATUS.RINGING) {
          socket.emit('end-call', { to: targetUser.socketId });
          endCall();
        }
      }, 30000);

    } catch (err) {
      console.error('Failed to get media stream', err);
      alert('Microphone access denied or connection failed');
    }
  };

  const answerCall = async (callerId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      
      const pc = peerConnection.current;
      if (!pc) {
        throw new Error('Peer connection not initialized. Offer might have been missed.');
      }

      // Add tracks to the already existing peer connection
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current);
      });
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('answer', {
        to: callerId,
        answer: answer,
      });

      setCallStatus(CALL_STATUS.CONNECTED);
      startTimer();
    } catch (err) {
      console.error('Failed to answer call', err);
      endCall();
    }
  };

  useEffect(() => {
    if (!socket) return;

    socket.on('incoming-call', async (data) => {
      setRemoteUser({ socketId: data.from, username: data.fromUsername });
      setCallStatus(CALL_STATUS.RINGING);
      
      if (data.offer) {
        const pc = createPeerConnection(data.from);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      }
    });

    socket.on('offer', async (data) => {
      const pc = createPeerConnection(data.from);
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      // Usually offer comes with incoming-call or shortly after
    });

    socket.on('answer', async (data) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        setCallStatus(CALL_STATUS.CONNECTED);
        startTimer();
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (peerConnection.current) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error('Error adding ice candidate', e);
        }
      }
    });

    socket.on('call-rejected', () => {
      alert('Call Declined');
      endCall();
    });

    socket.on('call-ended', () => {
      endCall();
    });

    return () => {
      socket.off('incoming-call');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('call-rejected');
      socket.off('call-ended');
    };
  }, [socket, createPeerConnection, endCall]);

  const toggleMute = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  return {
    callStatus,
    remoteUser,
    isMuted,
    callDuration,
    remoteStream: remoteStream.current,
    initiateCall,
    answerCall,
    rejectCall: () => {
      socket.emit('reject-call', { to: remoteUser?.socketId });
      endCall();
    },
    endCall: () => {
      socket.emit('end-call', { to: remoteUser?.socketId });
      endCall();
    },
    toggleMute,
  };
};
