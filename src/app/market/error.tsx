'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Market Runtime Error:', error);
  }, [error]);

  return (
    <div style={{
      padding: '40px',
      textAlign: 'center',
      backgroundColor: '#050505',
      color: '#fff',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: 'monospace'
    }}>
      <div style={{ border: '1px solid #f44336', padding: '30px', maxWidth: '600px', width: '100%' }}>
        <h2 style={{ color: '#f44336', margin: '0 0 10px 0' }}>⚠️ CRITICAL SECURITY / RENDER EXCEPTION</h2>
        <p style={{ color: '#888', fontSize: '14px' }}>
          The Olympus Marketplace engine was unable to render this node.
          This might be due to a database sync failure or an invalid terminal state.
        </p>

        <div style={{
          margin: '20px 0',
          padding: '15px',
          backgroundColor: '#000',
          border: '1px solid #222',
          textAlign: 'left',
          fontSize: '12px',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word'
        }}>
          <strong style={{ color: '#555' }}>TECHNICAL TRACE:</strong><br/>
          <span style={{ color: '#ffeb3b' }}>{error.message || "Unspecified runtime fault"}</span>
          {error.digest && (
             <div style={{ color: '#444', marginTop: '5px', fontSize: '10px' }}>
                TRACE_ID: {error.digest}
             </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            onClick={() => reset()}
            style={{
              padding: '10px 20px',
              background: '#111',
              border: '1px solid #444',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            RETRY NODE CONNECTION
          </button>
          <a
            href="/auth/login"
            style={{
              padding: '10px 20px',
              background: '#000',
              border: '1px solid #444',
              color: '#888',
              textDecoration: 'none',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            RETURN TO ACCESS GATE
          </a>
        </div>
      </div>
    </div>
  );
}
