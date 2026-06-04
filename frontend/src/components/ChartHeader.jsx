import React from 'react';

export default function ChartHeader({ title, description, howTo }) {
  return (
    <div style={{
      background: '#ebf8ff',
      borderLeft: '4px solid #3182ce',
      padding: '20px 25px',
      borderRadius: '8px',
      marginBottom: '25px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
    }}>
      <h2 style={{ margin: '0 0 10px 0', color: '#2b6cb0', fontSize: '20px' }}>
        {title}
      </h2>
      <p style={{ margin: '0 0 10px 0', color: '#2d3748', fontSize: '15px', lineHeight: '1.6' }}>
        {description}
      </p>
      <p style={{ margin: 0, color: '#4a5568', fontSize: '14px', fontStyle: 'italic' }}>
        <strong>How to use this page:</strong> {howTo}
      </p>
    </div>
  );
}
