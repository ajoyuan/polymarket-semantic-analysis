import React, { useMemo, useState } from 'react';
import * as d3 from 'd3';

export default function BoxPlotChart({ data, types }) {
  const width = 800;
  const height = 450;
  const margin = { top: 40, right: 30, bottom: 50, left: 50 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const hasData = data && data.length > 0;

  const [hoveredCategory, setHoveredCategory] = useState(null);
  const [tooltip, setTooltip] = useState({ 
    visible: false, 
    x: 0, 
    y: 0, 
    content: null 
  });

  const orderedTypes = useMemo(() => {
    if (!types) return [];
    const targetOrder = ["Stochastic", "Objective Outcome", "Decision-Agent"];
    return types.sort((a, b) => targetOrder.indexOf(a) - targetOrder.indexOf(b));
  }, [types]);

  const boxStats = useMemo(() => {
    if (!hasData) return [];

    const grouped = d3.group(data, d => d.predicted_label);

    return Array.from(grouped, ([category, values]) => {
      const sorted = values.map(v => v.local_peak_shock).sort(d3.ascending);
      
      const q1 = d3.quantile(sorted, 0.25);
      const median = d3.quantile(sorted, 0.5);
      const q3 = d3.quantile(sorted, 0.75);
      const iqr = q3 - q1;

      const minLimit = q1 - 1.5 * iqr;
      const maxLimit = q3 + 1.5 * iqr;

      const nonOutliers = sorted.filter(v => v >= minLimit && v <= maxLimit);
      const min = nonOutliers.length > 0 ? d3.min(nonOutliers) : q1;
      const max = nonOutliers.length > 0 ? d3.max(nonOutliers) : q3;

      const outliers = values
        .filter(v => v.local_peak_shock < minLimit || v.local_peak_shock > maxLimit)
        .map(point => ({
          ...point,
          jitterRatio: (Math.random() - 0.5) * 0.2 
        }));

      return { category, q1, median, q3, min, max, outliers, totalPoints: values.length };
    });
  }, [data, hasData]);

  const xScale = useMemo(() => {
    return d3.scaleBand()
      .domain(orderedTypes)
      .range([0, innerWidth])
      .paddingInner(0.6)
      .paddingOuter(0.3);
  }, [orderedTypes, innerWidth]);

  const yScale = useMemo(() => {
    const maxVal = hasData ? d3.max(data, d => d.local_peak_shock) : 4;
    return d3.scaleLinear()
      .domain([0, Math.max(maxVal + 1, 3)])
      .range([innerHeight, 0])
      .nice();
  }, [data, hasData, innerHeight]);

  const colorScale = (name) => {
    if (name === 'Decision-Agent') return '#e53e3e';
    if (name === 'Objective Outcome') return '#3182ce';
    if (name === 'Stochastic') return '#718096';
    return '#4a5568';
  };

  const handleMouseMove = (e) => {
    setTooltip(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
  };

  const handleMouseLeave = () => {
    setHoveredCategory(null);
    setTooltip({ visible: false, x: 0, y: 0, content: null });
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ 
        background: 'white', 
        padding: '20px', 
        borderRadius: '8px', 
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)', 
        display: 'flex', 
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: `${height + 40}px`,
        position: 'relative'
      }}>
        {!hasData ? (
          <div style={{ color: '#a0aec0', fontSize: '16px' }}>Loading Box Plot Data...</div>
        ) : (
          <svg width={width} height={height} style={{ background: '#ffffff', borderRadius: '8px' }}>
            <g transform={`translate(${margin.left},${margin.top})`}>
              
              <line x1={0} x2={innerWidth} y1={yScale(1.96)} y2={yScale(1.96)} stroke="#EF4444" strokeWidth="2" strokeDasharray="5,5" />
              <text x={innerWidth - 5} y={yScale(1.96) + 14} fill="#EF4444" textAnchor="end" fontSize="12" fontWeight="bold">
                Anomaly Threshold (Z = 1.96)
              </text>

              {boxStats.map((stat) => {
                const x = xScale(stat.category);
                const bw = xScale.bandwidth(); 
                const boxColor = colorScale(stat.category);
                
                const isFaded = hoveredCategory && hoveredCategory !== stat.category;
                const opacity = isFaded ? 0.2 : 1;

                return (
                  <g 
                    key={stat.category} 
                    transform={`translate(${x}, 0)`}
                    style={{ transition: 'opacity 0.3s ease', opacity: opacity }}
                  >
                    <line x1={bw/2} x2={bw/2} y1={yScale(stat.min)} y2={yScale(stat.max)} stroke={boxColor} strokeWidth={2} />
                    
                    <line x1={bw*0.25} x2={bw*0.75} y1={yScale(stat.min)} y2={yScale(stat.min)} stroke={boxColor} strokeWidth={2} />
                    <line x1={bw*0.25} x2={bw*0.75} y1={yScale(stat.max)} y2={yScale(stat.max)} stroke={boxColor} strokeWidth={2} />

                    <rect
                      x={0} y={yScale(stat.q3)} width={bw} height={yScale(stat.q1) - yScale(stat.q3)}
                      fill={boxColor} fillOpacity={0.2} stroke={boxColor} strokeWidth={2}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        setHoveredCategory(stat.category);
                        setTooltip({
                          visible: true, x: e.clientX, y: e.clientY,
                          content: (
                            <div>
                              <strong style={{ color: boxColor, display: 'block', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px' }}>{stat.category}</strong>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                                <span>Total Markets:</span> <strong>{stat.totalPoints}</strong>
                                <span>Upper Quartile (Q3):</span> <strong>{stat.q3.toFixed(2)}</strong>
                                <span>Median:</span> <strong>{stat.median.toFixed(2)}</strong>
                                <span>Lower Quartile (Q1):</span> <strong>{stat.q1.toFixed(2)}</strong>
                                <span>Anomalies:</span> <strong>{stat.outliers.length}</strong>
                              </div>
                            </div>
                          )
                        });
                      }}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                    />

                    <line x1={0} x2={bw} y1={yScale(stat.median)} y2={yScale(stat.median)} stroke={boxColor} strokeWidth={3} style={{ pointerEvents: 'none' }} />

                    {stat.outliers.map((point, idx) => {
                      const jitter = point.jitterRatio * bw; 
                      return (
                        <circle
                          key={point.market_id || idx}
                          cx={(bw / 2) + jitter}
                          cy={yScale(point.local_peak_shock)}
                          r={5} 
                          fill={boxColor}
                          fillOpacity={0.8}
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          style={{ cursor: 'pointer', transition: 'r 0.2s' }}
                          onMouseEnter={(e) => {
                            setHoveredCategory(stat.category);
                            e.target.setAttribute('r', 8); 
                            setTooltip({
                              visible: true, x: e.clientX, y: e.clientY,
                              content: (
                                <div>
                                  <strong style={{ color: '#e53e3e', display: 'block', marginBottom: '4px' }}>Extreme Anomaly Detected</strong>
                                  <div>Market ID: <strong>{point.market_id}</strong></div>
                                  <div>Peak Shock: <strong>{point.local_peak_shock.toFixed(2)} σ</strong></div>
                                </div>
                              )
                            });
                          }}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={(e) => {
                            e.target.setAttribute('r', 5); 
                            handleMouseLeave();
                          }}
                        />
                      );
                    })}
                  </g>
                );
              })}

              <g>
                <line x1={0} y1={0} x2={0} y2={innerHeight} stroke="#cbd5e0" />
                {yScale.ticks(5).map(tick => (
                  <g key={tick} transform={`translate(0, ${yScale(tick)})`}>
                    <line x1={-5} x2={0} stroke="#cbd5e0" />
                    <text x={-10} y={4} textAnchor="end" fontSize="12" fill="#4a5568">{tick}</text>
                  </g>
                ))}
                <text x={0} y={-15} fill="#718096" fontSize="12" textAnchor="middle">Max Z-score</text>
              </g>

              <g transform={`translate(0, ${innerHeight})`}>
                <line x1={0} y1={0} x2={innerWidth} y2={0} stroke="#cbd5e0" />
                {orderedTypes.map(type => (
                  <g key={type} transform={`translate(${xScale(type) + xScale.bandwidth() / 2}, 0)`}>
                    <line x1={0} y1={0} x2={0} y2={5} stroke="#cbd5e0" />
                    <text x={0} y={20} textAnchor="middle" fontSize="13" fill="#2d3748" fontWeight="bold">{type}</text>
                  </g>
                ))}
              </g>
            </g>
          </svg>
        )}

        {tooltip.visible && (
          <div style={{
            position: 'fixed', 
            left: tooltip.x + 15, 
            top: tooltip.y + 15,
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid #cbd5e0',
            borderRadius: '8px',
            padding: '12px 16px',
            boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
            fontSize: '13px',
            color: '#2d3748',
            pointerEvents: 'none', 
            zIndex: 1000,
            minWidth: '200px'
          }}>
            {tooltip.content}
          </div>
        )}
      </div>
    </div>
  );
}