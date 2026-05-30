import React from 'react';

export default function KPIGrid({ stats, currentLabel }) {
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

  const Card = ({ title, value, subtext, color = '#2b6cb0', explanation }) => (
    <div 
      title={explanation} 
      style={{ 
        border: '1px solid #e2e8f0', 
        borderTop: `4px solid ${color}`, 
        padding: '20px', 
        borderRadius: '8px', 
        textAlign: 'center', 
        background: '#fafafa',
        cursor: 'help', 
        position: 'relative',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
      }}
    >
      <h4 style={{ margin: '0 0 8px 0', color: '#a0aec0', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {title} <span style={{fontSize: '13px', color: '#cbd5e0'}}>ⓘ</span>
      </h4>
      <p style={{ margin: 0, fontSize: '26px', fontWeight: 'bold', color }}>{value}</p>
      <span style={{ fontSize: '11px', display: 'block', marginTop: '5px', fontWeight: 500, color: '#4a5568' }}>{subtext}</span>
    </div>
  );

  const safeTrades = stats?.totalTrades !== undefined ? stats.totalTrades : 0;
  const safeMaxZ = stats?.maxZ !== undefined ? `${stats.maxZ} σ` : "0 σ";
  const safeAnomaly = stats?.anomalyPct !== undefined ? stats.anomalyPct : "0%";

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '30px' }}>
      <Card 
        title="Transactions recorded" 
        value={safeTrades} 
        subtext="Total individual transactions" 
        color="#a0aec0" 
        explanation="The total number of executed trades. High numbers indicate a thick order book and strong crowd consensus."
      />
      <Card 
        title="Global ARIMAX Impact" 
        value={arimaxVal} 
        subtext={arimaxText} 
        color={arimaxColor} 
        explanation="The baseline predictive momentum mathematically calculated for this specific market category."
      />
      <Card 
        title="Maxmimum Z-score" 
        value={safeMaxZ} 
        subtext="Max Volatility Deviation" 
        color="#e53e3e" 
        explanation="The absolute maximum standard deviation from baseline volatility. Anything above 1.96σ is a massive mathematical shock."
      />
      <Card 
        title="Lifespan Anomaly %" 
        value={safeAnomaly} 
        subtext="Time Spent in Instability" 
        color="#fc8181" 
        explanation="The percentage of the market's lifespan spent in a hyper-volatile state (>1.96σ). Indicates a chaotic, news-driven timeline."
      />
    </div>
  );
}