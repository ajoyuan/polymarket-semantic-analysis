import React, { useState } from 'react';

// Standardized KPI style card template
// WHY: Decoupling this from the main grid prevents massive code duplication. 
// standardizes the hover-state logic so the custom tooltips behave identically across all metrics.
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
      {/* Mouse Tracking
        Minor mouse tracking element to the Toolbox, makes it so the tooltip hitbox feels less restrictive and more dynamic
      */}
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

export default function KPIGrid({ stats, currentLabel, certainty }) {
  // Global tooltip state shared by all KPI Card components
  const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });

  // ==========================================
  // ARIMAX Baseline coefficient logic
  // ==========================================
  // Hardcodes the universal ARIMAX momentum weights based on the active market's semantic category.
  // WHY: Because ARIMAX coefficients are global structural constants derived from our Colab model, 
  // they are tied to the semantic label rather than the individual market's localized timeline data.
  let arimaxVal = "0.002";
  let arimaxColor = "#718096";
  let arimaxText = "The market moves randomly regardless of past data.";

  if (currentLabel === 'Decision-Agent') {
    arimaxVal = "0.1543";
    arimaxColor = "#e53e3e";
    arimaxText = "Volatility is based mostly on previous market momentum.";
  } else if (currentLabel === 'Objective Outcome') {
    arimaxVal = "0.0836";
    arimaxColor = "#3182ce";
    arimaxText = "Volatility is anchored to predictable external events";
  }

  // ==========================================
  // IMPLEMENTATION CONSIDERATION: Defensive Programming
  // ==========================================
  // Strict undefined checks with safe fallback values ("0", "0%") because the frontend renders faster than the DuckDB backend can calculate Z-scores, 
  // Checks prevent the React app from crashing with a "Cannot read property of undefined" error during initial data loads.
  const safeTrades = stats?.totalTrades !== undefined ? stats.totalTrades.toLocaleString() : 0;
  const safeMaxZ = stats?.maxZ !== undefined ? `${stats.maxZ} σ` : "0 σ";
  const safeAnomaly = stats?.anomalyPct !== undefined ? stats.anomalyPct : "0%";

  // ==========================================
  // TWAP CERTAINTY SCORING
  // ==========================================
  // WHAT: Converts a raw 0.0 to 1.0 certainty float into human-readable sentiment buckets.
  const twapScore = certainty?.uncertainty_twap;
  const hasTwap = twapScore !== undefined && twapScore !== null;
  const safeTwap = hasTwap ? twapScore.toFixed(4) : "—";
  
  let twapColor = "#a0aec0";
  let twapText = "No certainty data";
  
  if (hasTwap) {
    // WHY: We use statistical thirds to categorize the market. 
    // >0.66 implies a decided market, <0.33 implies total chaos/coin-flip.
    if (twapScore >= 0.66) {
      twapColor = "#38a169";
      twapText = "Market is largely decided on the predictions";
    } else if (twapScore >= 0.33) {
      twapColor = "#dd6b20";
      twapText = "Market is contested on the predictions";
    } else {
      twapColor = "#e53e3e";
      twapText = "Near coin-flip on the predictions";
    }
  }

  return (
    <>
      {/* KPI cards: Total transactions, ARIMAX coefficient, Max Z-score, Anomaly percentage, TWAP score*/}
      {/* Defines the title, value, the subtext, color, and the tooltip function that pops up the help bubble*/}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <Card 
          title="Total transactions" 
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
          explanation="The baseline predictive momentum mathematically calculated for this specific sematic category."
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
          explanation="The percentage of the market's lifespan spent in a hyper-volatile state (Z-score >1.96σ)."
          setTooltip={setTooltip}
        />
        <Card 
          title="TWAP Certainty" 
          value={safeTwap} 
          subtext={twapText} 
          color={twapColor} 
          explanation="A time-weighted measure of market certainty score ranges from 0 to 1. High values indicate a market that has been largely decided for most of its life (majority YES or NO). Low value indicates a market are undecided on the outcome during the trading period."
          setTooltip={setTooltip}
        />
      </div>

      {/*
        Tooltip element for the KPI bars, lets users see the explination portion of the card and prevents it from clipping with other KPI card boxes.
      */}
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