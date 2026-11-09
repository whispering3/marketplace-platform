export default function Notices() {
  return (
    <div className="box">
      <h2 className="warning">Administration Notices & PGP Canary</h2>
      <hr/>

      <div className="notice" style={{ marginBottom: '20px' }}>
         <p><strong>[!] URGENT: PHISHING SCAMS [!]</strong></p>
         <small>Published by <i>Admin</i> on 2026-04-09</small>
         <p>
            Multiple fake mirrors (.onion) are spoofing our Gateway. Always verify the signed address and NEVER input your private key in the browser or share your 6-digit PIN created during identity registration. Moderation will never ask for this.
         </p>
      </div>

      <div className="box" style={{ borderColor: '#4caf50' }}>
         <h3 className="success">PGP Assurance Canary (Proof of Life)</h3>
         <p>We are in control of our infrastructure. The server has not been compromised by law enforcement agents or hostile actors.</p>
         <textarea
            readOnly
            rows={10}
            value={`-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA512

We attest that on April 09, 2026, we have not received any judicial gag orders and hold full control of our administrative private keys.
-----BEGIN PGP SIGNATURE-----
Version: GnuPG v1

iQEcBAEBCgAGBQJkT...
[ADMINISTRATOR SIGNATURE HERE]
-----END PGP SIGNATURE-----`}
         />
      </div>
    </div>
  );
}
