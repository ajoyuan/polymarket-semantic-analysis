import React, { useState } from 'react';

export default function DashboardHeader({ catalog, selectedId, onSelect }) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div style={{ marginBottom: '25px', background: '#edf2f7', padding: '20px', borderRadius: '8px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '15px', marginBottom: '15px' }}>
        <h2 style={{ color: '#1a365d', margin: 0 }}>
          Polymarket Analytics Platform
        </h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <label style={{ fontWeight: 'bold', color: '#4a5568' }}>Select Target Market:</label>
        <select 
          value={selectedId} 
          onChange={(e) => onSelect(e.target.value)}
          style={{ padding: '12px', fontSize: '15px', borderRadius: '6px', border: '1px solid #cbd5e0', cursor: 'pointer' }}
        >
          {catalog.length === 0 && <option>-- Loading Pipeline --</option>}
          {catalog.map(market => (
            <option key={market.id} value={market.id}>
              [{market.predicted_label}] {market.question}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}