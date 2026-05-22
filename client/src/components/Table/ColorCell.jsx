import React from 'react';

export default function ColorCell({ className, children }) {
  return (
    <span className={`deal-tone-pill ${className || ''}`.trim()}>
      {children}
    </span>
  );
}
