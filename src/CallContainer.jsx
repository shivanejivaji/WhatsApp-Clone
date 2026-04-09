import React from 'react';
import { useSocket } from './context/SocketContext';
import { useWebRTC } from './hooks/useWebRTC';
import CallButton from './components/CallButton';
import IncomingCallModal from './components/IncomingCallModal';
import OngoingCallScreen from './components/OngoingCallScreen';

const CallContainer = ({ targetUser, currentUsername }) => {
  const socket = useSocket();
  const {
    callStatus,
    remoteUser,
    isMuted,
    callDuration,
    remoteStream,
    initiateCall,
    answerCall,
    rejectCall,
    endCall,
    toggleMute,
  } = useWebRTC(socket, currentUsername);

  return (
    <>
      {/* This button should be rendered in the Chat Header */}
      <CallButton
        user={targetUser}
        onInitiateCall={initiateCall}
      />

      {callStatus === 'ringing' && (
        <IncomingCallModal
          caller={remoteUser}
          onAccept={() => answerCall(remoteUser?.socketId)}
          onReject={rejectCall}
        />
      )}

      {(callStatus === 'calling' || callStatus === 'connected') && (
        <OngoingCallScreen
          user={remoteUser}
          status={callStatus}
          duration={callDuration}
          isMuted={isMuted}
          remoteStream={remoteStream}
          onMute={toggleMute}
          onEndCall={endCall}
        />
      )}
    </>
  );
};

export default CallContainer;
