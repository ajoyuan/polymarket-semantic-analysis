import React, { useState } from 'react';

const Card = ({ title, value, subtext, color = '#2b6cb0', explanation, setTooltip }) => (
  <div 
    onMouseLeave={() => setTooltip(prev => ({ ...prev, visible: false }))}
    style={{ 
      border: '1px solid #e2e8f0', 
      borderTop: `4px solid ${color}`, 
      padding: '20px', 
      borderRadius: '8px', 
      textAlign: 'center', 
      background: '#fafafa',
      position: 'relative',
      boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
    }}
  >
    <h4 style={{ margin: '0 0 8px 0', color: '#a0aec0', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {title}{' '}
      <span 
        onMouseEnter={(e) => setTooltip({ visible: true, content: explanation, x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setTooltip(prev => ({ ...prev, x: e.clientX, y: e.clientY }))}
        onMouseLeave={() => setTooltip(prev => ({ ...prev, visible: false }))}
        style={{
          display: 'inline-block', 
          fontSize: '13px', 
          color: '#cbd5e0', 
          cursor: 'help', 
          padding: '4px 8px', 
          margin: '-4px -8px' 
        }}
      >
        ⓘ
      </span>
    </h4>
    <p style={{ margin: 0, fontSize: '26px', fontWeight: 'bold', color }}>{value}</p>
    <span style={{ fontSize: '11px', display: 'block', marginTop: '5px', fontWeight: 500, color: '#4a5568' }}>{subtext}</span>
  </div>
);

export default function KPIGrid({ stats, currentLabel }) {
  const [tooltip, setTooltip] = useState({
    visible: false,
    content: '',
    x: 0,
    y: 0
  });

  let arimaxVal = "0.002";
  let arimaxColor = "#718096";
  let arimaxText = "Trend is highly randomized";

  if (currentLabel === 'Decision-Agent') {
    arimaxVal = "0.1543";
    arimaxColor = "#e53e3e";
    arimaxText = "Trend is highly speculative";
  } else if (currentLabel === 'Objective Outcome') {
    arimaxVal = "0.0836";
    arimaxColor = "#3182ce";
    arimaxText = "Trend can be predicted";
  }

  const safeTrades = stats?.totalTrades !== undefined ? stats.totalTrades.toLocaleString() : 0;
  const safeMaxZ = stats?.maxZ !== undefined ? `${stats.maxZ} σ` : "0 σ";
  const safeAnomaly = stats?.anomalyPct !== undefined ? stats.anomalyPct : "0%";

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <Card 
          title="Transactions recorded" 
          value={safeTrades} 
          subtext="Total individual transactions" 
          color="#a0aec0" 
          explanation="The total number of executed trades. High numbers indicate a thick order book and strong crowd consensus."
          setTooltip={setTooltip}
        />
        <Card 
          title="Global ARIMAX Impact" 
          value={arimaxVal} 
          subtext={arimaxText} 
          color={arimaxColor} 
          explanation="The baseline predictive momentum mathematically calculated for this specific market category."
          setTooltip={setTooltip}
        />
        <Card 
          title="Maxmimum Z-score" 
          value={safeMaxZ} 
          subtext="Max Volatility Deviation" 
          color="#e53e3e" 
          explanation="The absolute maximum standard deviation from baseline volatility. Anything above 1.96σ is a massive mathematical shock."
          setTooltip={setTooltip}
        />
        <Card 
          title="Lifespan Anomaly %" 
          value={safeAnomaly} 
          subtext="Time Spent in Instability" 
          color="#fc8181" 
          explanation="The percentage of the market's lifespan spent in a hyper-volatile state (>1.96σ). Indicates a chaotic, news-driven timeline."
          setTooltip={setTooltip}
        />
      </div>

      {tooltip.visible && (
        <div style={{
          position: 'fixed',
          top: tooltip.y + 15,
          left: tooltip.x + 15,
          background: 'rgba(255, 255, 255, 0.98)',
          border: '1px solid #cbd5e0',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#2d3748',
          maxWidth: '220px',
          pointerEvents: 'none',
          zIndex: 9999
        }}>
          {tooltip.content}
        </div>
      )}
    </>
  );
}