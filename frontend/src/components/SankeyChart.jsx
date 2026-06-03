import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey';

export default function SankeyChart({ catalog, selectedGenre, selectedCategory, onNodeClick, onLinkClick }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!catalog || catalog.length === 0) return;
    
    d3.select(svgRef.current.parentNode).selectAll(".sankey-tooltip").remove();
    
    const tooltip = d3.select(svgRef.current.parentNode)
      .append("div")
      .attr("class", "sankey-tooltip")
      .style("position", "absolute")
      .style("display", "none")
      .style("background", "rgba(255, 255, 255, 0.98)")
      .style("border", "1px solid #cbd5e0")
      .style("border-radius", "8px")
      .style("padding", "12px")
      .style("box-shadow", "0 4px 15px rgba(0,0,0,0.1)")
      .style("font-size", "12px")
      .style("line-height", "1.5")
      .style("color", "#2d3748")
      .style("pointer-events", "none") 
      .style("z-index", 100);

    const totalMarkets = catalog.length;
    const flowCounts = {};
    catalog.forEach(market => {
      const source = market.category || 'Unknown';
      const target = market.predicted_label || 'Unclassified';
      const key = `${source}|${target}`;
      flowCounts[key] = (flowCounts[key] || 0) + 1;
    });

    const nodesMap = new Map();
    let nodeIndex = 0;
    
    const getNodeIdx = (name) => {
      if (!nodesMap.has(name)) {
        nodesMap.set(name, { name, id: nodeIndex++ });
      }
      return nodesMap.get(name).id;
    };

    const links = [];
    const nodeRealTotals = new Map();

    Object.entries(flowCounts).forEach(([key, value]) => {
      const [sourceName, targetName] = key.split('|');
      
      nodeRealTotals.set(sourceName, (nodeRealTotals.get(sourceName) || 0) + value);
      nodeRealTotals.set(targetName, (nodeRealTotals.get(targetName) || 0) + value);

      links.push({ 
        source: getNodeIdx(sourceName), 
        target: getNodeIdx(targetName), 
        realValue: value,               
        value: Math.sqrt(value)         
      });
    });

    const nodes = Array.from(nodesMap.values()).map(n => ({ name: n.name }));
    const data = { nodes, links };

    const width = 800;
    const height = 400;
    const margin = { top: 20, right: 20, bottom: 20, left: 20 };

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); 
    svg.attr("viewBox", `0 0 ${width} ${height}`).style("width", "100%").style("height", "auto");

    const sankeyGenerator = sankey()
      .nodeWidth(20)
      .nodePadding(25)
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
      .nodeAlign(sankeyJustify); 

    const { nodes: graphNodes, links: graphLinks } = sankeyGenerator(data);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
    const getTargetColor = (name) => {
      if (name === 'Decision-Agent') return '#e53e3e'; 
      if (name === 'Objective Outcome') return '#3182ce'; 
      if (name === 'Stochastic') return '#718096'; 
      return colorScale(name);
    };

    const getLinkOpacity = (d) => {
      if (selectedGenre === 'All' && selectedCategory === 'All') return 0.35;
      const matchesGenre = selectedGenre === 'All' || d.source.name === selectedGenre;
      const matchesCategory = selectedCategory === 'All' || d.target.name === selectedCategory;
      return (matchesGenre && matchesCategory) ? 0.8 : 0.05; 
    };

    const linkGroup = svg.append("g")
      .attr("fill", "none")
      .selectAll("g")
      .data(graphLinks)
      .enter()
      .append("g")
      .style("mix-blend-mode", "multiply");

    linkGroup.append("path")
      .attr("d", sankeyLinkHorizontal())
      .attr("stroke", d => getTargetColor(d.target.name))
      .attr("stroke-width", d => Math.max(1, d.width)) 
      .attr("stroke-opacity", d => getLinkOpacity(d)) 
      .style("transition", "stroke-opacity 0.4s ease") 
      .style("cursor", "pointer") 
      .on("mouseover", function(event, d) { 
        d3.select(this).attr("stroke-opacity", 0.9);
        
        const rawPercent = (d.realValue / totalMarkets) * 100;
        const displayPercent = rawPercent < 0.1 ? rawPercent.toFixed(3) : rawPercent.toFixed(1);
        
        tooltip.style("display", "block").html(`
          <strong>${d.source.name} → ${d.target.name}</strong><br/>
          <span style="color:#718096;">${d.realValue} Markets (${displayPercent}% of the collected markets)</span>
        `);

        const [x, y] = d3.pointer(event, svgRef.current.parentNode);
        tooltip.style("left", (x + 15) + "px").style("top", (y + 15) + "px");
      })
      .on("mousemove", function(event) {
        const [x, y] = d3.pointer(event, svgRef.current.parentNode);
        tooltip.style("left", (x + 15) + "px").style("top", (y + 15) + "px");
      })
      .on("mouseout", function(event, d) { 
        d3.select(this).attr("stroke-opacity", getLinkOpacity(d)); 
        tooltip.style("display", "none"); 
      })
      .on("click", (event, d) => {
        tooltip.style("display", "none"); 
        if (onLinkClick) onLinkClick(d.source.name, d.target.name);
      });

    const nodeGroup = svg.append("g")
      .selectAll("g.node")
      .data(graphNodes)
      .enter()
      .append("g");

    nodeGroup.append("rect")
      .attr("x", d => d.x0)
      .attr("y", d => d.y0)
      .attr("height", d => Math.max(1.5, d.y1 - d.y0))
      .attr("width", d => d.x1 - d.x0)
      .attr("fill", d => getTargetColor(d.name))
      .attr("opacity", d => {
        if (selectedGenre === 'All' && selectedCategory === 'All') return 0.9;
        if (d.name === selectedGenre || d.name === selectedCategory) return 1.0;
        return 0.3;
      })
      .style("transition", "opacity 0.4s ease")
      .attr("rx", 3);

    nodeGroup.append("rect")
      .attr("x", d => d.x0 - 5) 
      .attr("y", d => ((d.y1 + d.y0) / 2) - (Math.max(24, d.y1 - d.y0) / 2)) 
      .attr("height", d => Math.max(24, d.y1 - d.y0)) 
      .attr("width", d => (d.x1 - d.x0) + 10)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        const actualTotal = nodeRealTotals.get(d.name) || 0;
        const rawPercent = (actualTotal / totalMarkets) * 100;
        const displayPercent = rawPercent < 0.1 ? rawPercent.toFixed(3) : rawPercent.toFixed(1);
        
        tooltip.style("display", "block").html(`
          <strong>${d.name}</strong><br/>
          <span style="color:#718096;">Total: ${actualTotal} Markets (${displayPercent}% of the collected markets)</span>
        `);

        const [x, y] = d3.pointer(event, svgRef.current.parentNode);
        tooltip.style("left", (x + 15) + "px").style("top", (y + 15) + "px");
      })
      .on("mousemove", function(event) {
        const [x, y] = d3.pointer(event, svgRef.current.parentNode);
        tooltip.style("left", (x + 15) + "px").style("top", (y + 15) + "px");
      })
      .on("mouseout", function() {
        tooltip.style("display", "none");
      })
      .on("click", (event, d) => {
        tooltip.style("display", "none"); 
        if (onNodeClick) onNodeClick(d.name); 
      });
      
    nodeGroup.append("text")
      .attr("x", d => d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8)
      .attr("y", d => (d.y1 + d.y0) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
      .text(d => d.name)
      .style("font-size", "13px")
      .style("font-family", "sans-serif")
      .style("font-weight", "bold")
      .style("fill", "#2d3748")
      .style("opacity", d => {
        if (selectedGenre === 'All' && selectedCategory === 'All') return 1.0;
        if (d.name === selectedGenre || d.name === selectedCategory) return 1.0;
        return 0.3;
      })
      .style("transition", "opacity 0.4s ease")
      .style("pointer-events", "none");

  }, [catalog, selectedGenre, selectedCategory]); 

  if (!catalog || catalog.length === 0) return null;

  return (
    <div style={{ position: 'relative', background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', marginBottom: '30px' }}>
      <h3 style={{ margin: '0 0 10px 0', color: '#4a5568', fontSize: '14px', textTransform: 'uppercase' }}>
        Market Distribution Flow
      </h3>
      <h3 style={{ margin: '0 0 10px 0', color: '#4a5568', fontSize: '10px', textTransform: 'uppercase' }}>
        Hover over Sankey chart to see the distribution of the markets. Click lines to filter!
      </h3>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg ref={svgRef}></svg>
      </div>
    </div>
  );
}