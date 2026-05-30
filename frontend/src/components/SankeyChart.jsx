import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey';

export default function SankeyChart({ catalog, selectedGenre, selectedCategory }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!catalog || catalog.length === 0) return;
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
    Object.entries(flowCounts).forEach(([key, value]) => {
      const [sourceName, targetName] = key.split('|');
      links.push({ source: getNodeIdx(sourceName), target: getNodeIdx(targetName), value });
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
      .style("transition", "stroke-opacity 0.4s ease") // Smooth fade animation
      .on("mouseover", function(e, d) { d3.select(this).attr("stroke-opacity", 0.9); })
      .on("mouseout", function(e, d) { d3.select(this).attr("stroke-opacity", getLinkOpacity(d)); })
      .append("title")
      
      linkGroup.append("path")
      .attr("d", sankeyLinkHorizontal())
      .attr("stroke", d => getTargetColor(d.target.name))
      .attr("stroke-width", d => Math.max(1, d.width))
      .attr("stroke-opacity", d => getLinkOpacity(d)) 
      .style("transition", "stroke-opacity 0.4s ease") 
      .on("mouseover", function(e, d) { d3.select(this).attr("stroke-opacity", 0.9); })
      .on("mouseout", function(e, d) { d3.select(this).attr("stroke-opacity", getLinkOpacity(d)); })
      .append("title")
      .text(d => {
        const percentage = ((d.value / totalMarkets) * 100).toFixed(1);
        return `${d.source.name} → ${d.target.name}\n${d.value} Markets (${percentage}% of system)`;
      });

    const nodeGroup = svg.append("g")
      .selectAll("rect")
      .data(graphNodes)
      .enter()
      .append("g");

    nodeGroup.append("rect")
      .attr("x", d => d.x0)
      .attr("y", d => d.y0)
      .attr("height", d => d.y1 - d.y0)
      .attr("width", d => d.x1 - d.x0)
      .attr("fill", d => getTargetColor(d.name))
      .attr("opacity", d => {
        if (selectedGenre === 'All' && selectedCategory === 'All') return 0.9;
        if (d.name === selectedGenre || d.name === selectedCategory) return 1.0;
        return 0.3;
      })
      .style("transition", "opacity 0.4s ease")
      .attr("rx", 3) 
      .append("title")
      .text(d => `${d.name}\nTotal: ${d.value}`);

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
      .style("transition", "opacity 0.4s ease");

  }, [catalog, selectedGenre, selectedCategory]); 

  if (!catalog || catalog.length === 0) return null;

  return (
    <div style={{ background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', marginBottom: '30px' }}>
      <h3 style={{ margin: '0 0 10px 0', color: '#4a5568', fontSize: '14px', textTransform: 'uppercase' }}>
        Market Distribution Flow
      </h3>
      <h3 style={{ margin: '0 0 10px 0', color: '#4a5568', fontSize: '10px', textTransform: 'uppercase' }}>
        Hover over Sankey chart to see the distribution of the markets
      </h3>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg ref={svgRef}></svg>
      </div>
    </div>
  );
}