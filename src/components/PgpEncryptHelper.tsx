"use client";

import { useState } from "react";
import * as openpgp from "openpgp";

interface Props {
  vendorPublicKey: string;
  targetTextareaId: string;
}

export default function PgpEncryptHelper({ vendorPublicKey, targetTextareaId }: Props) {
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEncrypt = async () => {
    const textarea = document.getElementById(targetTextareaId) as HTMLTextAreaElement;
    if (!textarea) return;

    const plaintext = textarea.value.trim();
    if (!plaintext) {
      setError("Please write your shipping instructions first.");
      return;
    }

    // Don't encrypt if it looks like it's already PGP
    if (plaintext.includes("-----BEGIN PGP MESSAGE-----")) {
      setError("Text appears to be already encrypted.");
      return;
    }

    setIsEncrypting(true);
    setError(null);

    try {
      const publicKey = await openpgp.readKey({ armoredKey: vendorPublicKey });
      const message = await openpgp.createMessage({ text: plaintext });

      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
      });

      textarea.value = encrypted as string;
    } catch (err: any) {
      console.error("PGP Encryption Error:", err);
      setError("Encryption failed: " + err.message);
    } finally {
      setIsEncrypting(false);
    }
  };

  return (
    <div style={{ marginTop: '10px' }}>
      <button
        type="button"
        onClick={handleEncrypt}
        disabled={isEncrypting}
        style={{
          width: '100%',
          padding: '8px',
          backgroundColor: '#1a3333',
          color: '#00bcd4',
          border: '1px solid #00bcd4',
          cursor: isEncrypting ? 'not-allowed' : 'pointer',
          fontSize: '11px',
          fontWeight: 'bold'
        }}
      >
        {isEncrypting ? "🛡️ SHIELDING DATA..." : "🛡️ ENCRYPT FOR VENDOR (LOCAL)"}
      </button>
      {error && <div style={{ color: '#ff8c8c', fontSize: '10px', marginTop: '5px', textAlign: 'center' }}>{error}</div>}
    </div>
  );
}
