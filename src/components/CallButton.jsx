import React from 'react';
import { PhoneIcon } from '@heroicons/react/24/solid';

const CallButton = ({ onInitiateCall, user }) => {
  return (
    <button
      onClick={() => onInitiateCall(user)}
      className="p-2 rounded-full hover:bg-gray-200 transition-all text-gray-600 focus:outline-none"
      title="Voice Call"
    >
      <PhoneIcon className="h-6 w-6" />
    </button>
  );
};

export default CallButton;
