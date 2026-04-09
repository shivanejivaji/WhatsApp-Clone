import React, { useEffect, useState, useRef } from 'react';
import { MicrophoneIcon, MicrophoneSlashIcon, PhoneXMarkIcon } from '@heroicons/react/24/solid';

const OngoingCallScreen = ({ user, status, duration, isMuted, onMute, onEndCall, remoteStream }) => {
  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-gray-900 text-white p-8">
      <div className="flex flex-col items-center mt-12">
        <div className="w-32 h-32 rounded-full bg-blue-500 flex items-center justify-center mb-6 text-4xl font-bold shadow-2xl">
          {user?.username?.charAt(0).toUpperCase()}
        </div>
        <h2 className="text-3xl font-semibold mb-2">{user?.username}</h2>
        <div className="text-xl font-medium text-gray-400 mb-1">
          {status === 'calling' && 'Calling...'}
          {status === 'ringing' && 'Ringing...'}
          {status === 'connected' && 'Connected'}
          {status === 'ended' && 'Call Ended'}
        </div>
        {status === 'connected' && (
          <div className="text-2xl font-mono text-green-400">
            {formatTime(duration)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-12 mb-12">
        <button
          onClick={onMute}
          className={`p-6 rounded-full transition-all flex items-center justify-center ${
            isMuted ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          {isMuted ? (
            <MicrophoneSlashIcon className="h-10 w-10" />
          ) : (
            <MicrophoneIcon className="h-10 w-10" />
          )}
        </button>

        <button
          onClick={onEndCall}
          className="p-6 rounded-full bg-red-600 text-white hover:bg-red-700 transition-all flex items-center justify-center transform active:scale-90"
        >
          <PhoneXMarkIcon className="h-12 w-12" />
        </button>
      </div>
      {/* Hidden audio element to play remote stream */}
      <audio
        style={{ display: 'none' }}
        autoPlay
        ref={(el) => {
          if (!el) return;
          try {
            if (remoteStream && el.srcObject !== remoteStream) {
              el.srcObject = remoteStream;
            }
          } catch (e) {
            // ignore attach errors
          }
        }}
      />
    </div>
  );
};

export default OngoingCallScreen;
