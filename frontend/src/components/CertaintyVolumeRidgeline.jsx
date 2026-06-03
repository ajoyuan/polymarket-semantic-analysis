import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const COLORS = {
  'Stochastic': '#1f77b4',
  'Objective Outcome': '#ff7f0e',
  'Decision-Agent': '#2ca02c',
};
const OVERLAP = 1.7;

export default function CertaintyVolumeRidgeline({ data, error }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!data) return;

    const { x, peak, bands, types, cells } = data;
    const cellMap = new Map(cells.map(c => [`${c.type}|${c.band}`, c]));
    const totalByType = new Map(types.map(t => [
      t, d3.sum(cells.filter(c => c.type === t), c => c.n),
    ]));

    const width = 1200;
    const height = 745;
    const margin = { top: 95, right: 25, bottom: 50, left: 110 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const nBands = bands.length;
    const rowH = innerH / nBands;
    const colGap = 36;
    const colW = (innerW - colGap * (types.length - 1)) / types.length;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`).style('width', '100%').style('height', '100%');

    // Tooltip
    d3.select(svgRef.current.parentNode).selectAll('.ridge-tooltip').remove();
    const tip = d3.select(svgRef.current.parentNode).append('div')
      .attr('class', 'ridge-tooltip')
      .style('position', 'absolute').style('display', 'none')
      .style('background', 'rgba(255,255,255,0.98)').style('border', '1px solid #cbd5e0')
      .style('border-radius', '6px').style('padding', '8px 10px')
      .style('font-size', '12px').style('color', '#2d3748')
      .style('box-shadow', '0 4px 15px rgba(0,0,0,0.1)').style('pointer-events', 'none')
      .style('z-index', 100);

    // baseline(i): y of band i's zero line; i=0 (smallest volume) sits at the bottom.
    const baseline = i => margin.top + innerH - i * rowH;
    const colX = j => margin.left + j * (colW + colGap);

    // Title + per-column type headers.
    svg.append('text').attr('x', width / 2).attr('y', 28).attr('text-anchor', 'middle')
      .style('font-size', '17px').style('font-weight', 'bold').style('fill', '#2d3748')
      .text('Certainty (TWAP) by traded-volume band, per market type');

    types.forEach((type, j) => {
      const x0 = colX(j);
      const xScale = d3.scaleLinear().domain([0, 1]).range([x0, x0 + colW]);

      svg.append('text').attr('x', x0 + colW / 2).attr('y', margin.top - 26)
        .attr('text-anchor', 'middle').style('font-size', '14px').style('font-weight', 'bold')
        .style('fill', COLORS[type]).text(type);

      svg.append('text').attr('x', x0 + colW / 2).attr('y', margin.top - 11)
        .attr('text-anchor', 'middle').style('font-size', '11px').style('fill', '#718096')
        .text(`${(totalByType.get(type) || 0).toLocaleString()} markets`);

      bands.forEach((band, i) => {
        const base = baseline(i);

        svg.append('line').attr('x1', x0).attr('x2', x0 + colW)
          .attr('y1', base).attr('y2', base).attr('stroke', '#e2e8f0').attr('stroke-width', 0.8);

        const cell = cellMap.get(`${type}|${band.label}`);
        const n = cell ? cell.n : 0;

        if (cell && cell.density) {
          const pts = cell.density.map((d, k) => ({
            x: xScale(x[k]),
            y: base - (d / peak) * OVERLAP * rowH,
          }));
          const area = d3.area().x(p => p.x).y0(base).y1(p => p.y).curve(d3.curveBasis);
          const line = d3.line().x(p => p.x).y(p => p.y).curve(d3.curveBasis);

          svg.append('path').datum(pts).attr('d', area)
            .attr('fill', COLORS[type]).attr('fill-opacity', 0.6).attr('stroke', 'none')
            .style('cursor', 'help')
            .on('mousemove', (event) => {
              const [mx, my] = d3.pointer(event, svgRef.current.parentNode);
              tip.style('display', 'block').style('left', `${mx + 14}px`).style('top', `${my + 14}px`)
                .html(`<strong style="color:${COLORS[type]}">${type}</strong><br/>volume ${band.label}<br/>n = ${n.toLocaleString()} markets`);
            })
            .on('mouseout', () => tip.style('display', 'none'));
          svg.append('path').datum(pts).attr('d', line)
            .attr('fill', 'none').attr('stroke', 'white').attr('stroke-width', 1).attr('pointer-events', 'none');
        }

        svg.append('text').attr('x', x0 + colW - 4).attr('y', base - rowH * 0.18)
          .attr('text-anchor', 'end').style('font-size', '10px').style('fill', '#4a4f55')
          .text(`n=${n.toLocaleString()}`);
      });

      svg.append('g').attr('transform', `translate(0,${margin.top + innerH})`)
        .call(d3.axisBottom(xScale).ticks(5)).attr('color', '#a0aec0');
      svg.append('text').attr('x', x0 + colW / 2).attr('y', margin.top + innerH + 40)
        .attr('text-anchor', 'middle').style('font-size', '12px').style('fill', '#718096')
        .text('Certainty (TWAP)  |p − 0.5| × 2');
    });

    bands.forEach((band, i) => {
      svg.append('text').attr('x', margin.left - 12).attr('y', baseline(i) - 4)
        .attr('text-anchor', 'end').style('font-size', '11px').style('font-weight', 'bold')
        .style('fill', '#4a5568').text(band.label);
    });
    svg.append('text').attr('transform', `translate(22,${margin.top + innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle').style('font-size', '12px').style('fill', '#718096')
      .text('Traded-volume band');
  }, [data]);

  if (error) return (
    <div style={{ height: '720px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e53e3e' }}>
      Failed to load ridgeline: {error}
    </div>
  );
  if (!data) return (
    <div style={{ height: '720px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a0aec0' }}>
      Computing certainty distributions…
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', background: 'white', borderRadius: '8px', padding: '10px 0' }}>
      <svg ref={svgRef}></svg>
    </div>
  );
}
