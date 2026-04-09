import React from 'react';
import { PhoneIcon, XMarkIcon, CheckIcon } from '@heroicons/react/24/solid';

const IncomingCallModal = ({ caller, onAccept, onReject }) => {
  if (!caller) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-2xl shadow-xl w-80 overflow-hidden transform transition-all scale-110 animate-pulse">
        <div className="bg-green-500 p-6 flex flex-col items-center justify-center text-white">
          <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mb-4">
            <span className="text-4xl font-bold">{caller.username?.charAt(0).toUpperCase()}</span>
          </div>
          <h3 className="text-xl font-semibold mb-1">{caller.username}</h3>
          <p className="text-sm text-green-100">Incoming Voice Call...</p>
        </div>
        
        <div className="flex p-4 gap-4">
          <button
            onClick={onReject}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
            Reject
          </button>
          <button
            onClick={onAccept}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500 hover:bg-green-600 text-white font-medium transition-colors"
          >
            <CheckIcon className="h-6 w-6" />
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;
