import React from 'react';

export default function RulesPage() {
  return (
    <div className="box" style={{ maxWidth: '900px', margin: '0 auto', lineHeight: '1.6' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
         <h1 style={{ color: '#f26822', fontSize: '28px', textTransform: 'uppercase', letterSpacing: '2px' }}>Olympus Marketplace Rules</h1>
         <div style={{ fontSize: '12px', color: '#666' }}>Private commerce policy</div>
      </div>

      <section style={{ marginBottom: '30px' }}>
         <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', color: '#ccc' }}>1. Marketplace Purpose</h3>
         <p style={{ color: '#888', fontSize: '14px' }}>
            Olympus is a private marketplace for lawful goods, digital products, and professional services.
            Privacy features protect users from phishing, account takeover, and unnecessary data exposure.
         </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
         <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', color: '#ccc' }}>2. Prohibited Material</h3>
         <p style={{ color: '#888', fontSize: '14px' }}>
            To maintain the longevity of the platform, the following are strictly prohibited:
         </p>
         <ul style={{ color: '#d9534f', fontSize: '13px', fontWeight: 'bold' }}>
            <li>Illegal drugs, controlled substances, or related paraphernalia.</li>
            <li>Weapons, explosives, or materials intended to harm people.</li>
            <li>Stolen data, fraud tools, counterfeit documents, or financial abuse.</li>
            <li>Malware, botnets, exploit kits, credential theft, or unauthorized access services.</li>
            <li>Counterfeit goods, pirated material, or items that violate intellectual property rights.</li>
         </ul>
         <p style={{ fontSize: '11px', color: '#555' }}>
            Violations may result in listing removal, account suspension, refunds, and preservation of records required for compliance.
         </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
         <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', color: '#ccc' }}>3. Advanced Security Protocol</h3>
         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="box" style={{ backgroundColor: '#0c0c0e', border: '1px solid #222' }}>
               <strong style={{ color: '#f26822' }}>🛡️ Anti-Phishing Anchor</strong><br/>
               <p style={{ fontSize: '11px', color: '#777' }}>
                  Your personal phrase is shown on your dashboard. If the phrase is missing or incorrect, you are on a phishing mirror. Exit immediately.
               </p>
            </div>
            <div className="box" style={{ backgroundColor: '#0c0c0e', border: '1px solid #222' }}>
               <strong style={{ color: '#f26822' }}>Minimal Client Exposure</strong><br/>
               <p style={{ fontSize: '11px', color: '#777' }}>
                  Sensitive operations run server-side and account actions require session validation.
               </p>
            </div>
         </div>
      </section>

      <section style={{ marginBottom: '30px' }}>
         <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', color: '#ccc' }}>4. Financial Intelligence (Escrow)</h3>
         <p style={{ color: '#888', fontSize: '14px' }}>
            All trades are protected by the Olympus Escrow System.
         </p>
         <ul style={{ fontSize: '13px', color: '#aaa' }}>
            <li><strong>Standard Escrow:</strong> 4% Market Commission. Finalized by buyer or auto-timer.</li>
            <li><strong>Auto-Finalize:</strong> Shipped orders auto-release after 14 days if no dispute is raised.</li>
         </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
         <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', color: '#ccc' }}>5. Dispute Adjudication</h3>
         <p style={{ color: '#888', fontSize: '14px' }}>
            In case of conflicts, a Staff member will review PGP logs and tracking evidence.
            The Staff's decision is final. Rude or uncooperative behavior during a dispute may influence the outcome against you.
         </p>
      </section>

      <hr style={{ borderColor: '#222', margin: '40px 0' }}/>

      <div style={{ textAlign: 'center', fontSize: '12px', color: '#444' }}>
         <footer>
            OLYMPUS PRIVATE MARKETPLACE<br/>
            [ <a href="/market" style={{ color: '#f26822' }}>RETURN TO TERMINAL</a> ]
         </footer>
      </div>
    </div>
  );
}
