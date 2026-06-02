import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export default function DualAxisChart({ chartData }) {
  const svgRef = useRef();
  const [showAnomalies, setShowAnomalies] = useState(true);

  useEffect(() => {
    if (!chartData || !chartData.length) return;

    if (chartData.length < 2) {
      d3.select(svgRef.current).selectAll("*").remove();
      return; 
    }

    d3.select(svgRef.current.parentNode).selectAll(".info-blip-tooltip").remove();
    
    const infoTooltip = d3.select(svgRef.current.parentNode)
      .append("div")
      .attr("class", "info-blip-tooltip")
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
      .style("max-width", "260px")
      .style("pointer-events", "none")
      .style("z-index", 100);

    const MAX_POINTS = 1440; 
    const sampledData = chartData.length > MAX_POINTS 
      ? chartData.filter((_, index) => index % Math.ceil(chartData.length / MAX_POINTS) === 0)
      : chartData;

    const totalTradesInSet = sampledData.reduce((sum, d) => sum + (d.trade_count || 0), 0);
    let runningTotal = 0;

    const data = sampledData.map((d, i) => {
      const date = new Date(d.timestamp);
      runningTotal += (d.trade_count || 0);
      
      return {
        idx: i,
        timeLabel: `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
        price: d.price,
        zScore: d.zscore, 
        arimax: d.arimax || null, 
        yesVolume: d.yes_volume || 0,
        noVolume: d.no_volume || 0,
        yesCount: d.yes_count || 0, 
        noCount: d.no_count || 0,
        tradeCount: d.trade_count || 0,
        cumulativeCount: runningTotal, 
        totalTrades: totalTradesInSet  
      };
    });

    const anomalyRegions = [];
    let inAnomaly = false; let startIdx = 0;
    data.forEach((d, i) => {
      if (d.zScore > 1.96 && !inAnomaly) { inAnomaly = true; startIdx = i; } 
      else if (d.zScore <= 1.96 && inAnomaly) { inAnomaly = false; anomalyRegions.push({ start: startIdx, end: i }); }
    });
    if (inAnomaly) anomalyRegions.push({ start: startIdx, end: data.length - 1 });

    const width = 1000;
    const height = 650; 
    const margin = { top: 40, right: 60, bottom: 40, left: 60 };

    const topChartBot = 300; 
    const bottomChartTop = 360; 
    const bottomChartBot = height - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`).style("width", "100%").style("height", "100%");

    const xScale = d3.scaleLinear().domain([0, data.length - 1]).range([margin.left, width - margin.right]);
    
    const yPriceScale = d3.scaleLinear().domain([0, 1]).range([topChartBot, margin.top]);
    const maxVolume = d3.max(data, d => d.yesVolume + d.noVolume) || 1;
    const yVolumeScale = d3.scaleLinear().domain([0, maxVolume]).range([topChartBot, topChartBot - 80]);

    const minZ = d3.min(data, d => Math.min(d.zScore, d.arimax || 0, -1));
    const maxZ = d3.max(data, d => Math.max(d.zScore, d.arimax || 0, 4));
    const yZScoreScale = d3.scaleLinear().domain([minZ, maxZ]).range([bottomChartBot, bottomChartTop]);

    svg.append("defs").append("clipPath").attr("id", "clip-top")
      .append("rect").attr("x", margin.left).attr("y", margin.top).attr("width", width - margin.left - margin.right).attr("height", topChartBot - margin.top);
    svg.append("defs").append("clipPath").attr("id", "clip-bot")
      .append("rect").attr("x", margin.left).attr("y", bottomChartTop).attr("width", width - margin.left - margin.right).attr("height", bottomChartBot - bottomChartTop);

    const focusTop = svg.append("g").attr("clip-path", "url(#clip-top)");
    const focusBot = svg.append("g").attr("clip-path", "url(#clip-bot)");

    // FIX: Darker Anomaly Zone Color
    if (showAnomalies) {
      focusTop.selectAll(".anom-top").data(anomalyRegions).enter().append("rect").attr("class", "anom-top") 
        .attr("x", d => xScale(d.start)).attr("y", margin.top).attr("width", d => Math.max(2, xScale(d.end) - xScale(d.start))).attr("height", topChartBot - margin.top).attr("fill", "rgba(153, 27, 27, 0.15)");
      focusBot.selectAll(".anom-bot").data(anomalyRegions).enter().append("rect").attr("class", "anom-bot") 
        .attr("x", d => xScale(d.start)).attr("y", bottomChartTop).attr("width", d => Math.max(2, xScale(d.end) - xScale(d.start))).attr("height", bottomChartBot - bottomChartTop).attr("fill", "rgba(153, 27, 27, 0.15)");
    }

    const numTicks = Math.min(8, data.length - 1);
    const xAxis = d3.axisBottom(xScale).ticks(numTicks).tickFormat(i => Number.isInteger(i) ? (data[i]?.timeLabel || "") : "");
    
    const xAxisGroupTop = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${topChartBot})`).call(xAxis).attr("color", "#a0aec0");
    const xAxisGroupBot = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${bottomChartBot})`).call(xAxis).attr("color", "#a0aec0");

    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(yPriceScale).ticks(5)).attr("color", "#3182ce")
      .call(g => {
        g.append("circle").attr("cx", -25).attr("cy", margin.top - 19).attr("r", 7).attr("fill", "#edf2f7").attr("stroke", "#cbd5e0");
        g.append("text").attr("x", -25).attr("y", margin.top - 18).text("i").attr("text-anchor", "middle").attr("alignment-baseline", "middle").style("font-family", "serif").style("font-style", "italic").style("fill", "#4a5568").style("font-size", "11px");
        g.append("text").attr("x", -10).attr("y", margin.top - 15).attr("fill", "#3182ce").attr("text-anchor", "start").style("font-weight", "bold").text("Probability Price");
        
        g.append("rect").attr("x", -35).attr("y", margin.top - 28).attr("width", 20).attr("height", 20).attr("fill", "transparent").style("cursor", "help")
          .on("mouseover", () => {
            infoTooltip.style("display", "block").html(`
              <strong>Probability Price (Blue Line)</strong><br/>
              <span style="color:#718096;">The raw market consensus ranging from 0% to 100%. It represents the direct cost of a single contract.<br/><br/>
              <strong>Volume (Green/Red Bars):</strong> The actual US Dollar amount traded during a specific interval.</span>
            `);
          })
          .on("mousemove", (event) => {
            const [x, y] = d3.pointer(event, svgRef.current.parentNode);
            infoTooltip.style("left", (x + 15) + "px").style("top", (y + 15) + "px");
          })
          .on("mouseout", () => infoTooltip.style("display", "none"));
      });

    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(yZScoreScale).ticks(5)).attr("color", "#e53e3e")
      .call(g => {
        g.append("circle").attr("cx", -25).attr("cy", bottomChartTop - 19).attr("r", 7).attr("fill", "#edf2f7").attr("stroke", "#cbd5e0");
        g.append("text").attr("x", -25).attr("y", bottomChartTop - 18).text("i").attr("text-anchor", "middle").attr("alignment-baseline", "middle").style("font-family", "serif").style("font-style", "italic").style("fill", "#4a5568").style("font-size", "11px");
        g.append("text").attr("x", -10).attr("y", bottomChartTop - 15).attr("fill", "#e53e3e").attr("text-anchor", "start").style("font-weight", "bold").text("Volatility (Z-Score)");
        
        g.append("rect").attr("x", -35).attr("y", bottomChartTop - 28).attr("width", 20).attr("height", 20).attr("fill", "transparent").style("cursor", "help")
          .on("mouseover", () => {
            infoTooltip.style("display", "block").html(`
              <strong>Volatility Z-Score (Red Line)</strong><br/>
              <span style="color:#718096;">Measures the volatility of price jumps using the log-returns of the last 10 trades. It ignores the clock and only tracks action.<br/><br/>
              <strong>ARIMAX (Gray Dashed Line):</strong> Uses a pre-calculated ARIMAX coefficient to try and predict the true volatility of the market via autoregression.</span>
            `);
          })
          .on("mousemove", (event) => {
            const [x, y] = d3.pointer(event, svgRef.current.parentNode);
            infoTooltip.style("left", (x + 15) + "px").style("top", (y - 120) + "px"); 
          })
          .on("mouseout", () => infoTooltip.style("display", "none"));
      });

    focusBot.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", yZScoreScale(1.96)).attr("y2", yZScoreScale(1.96)).attr("stroke", "#e53e3e").attr("stroke-dasharray", "4,4").attr("opacity", 0.5);

    focusTop.selectAll(".vol-bar").data(data).enter().append("rect").attr("class", "vol-bar")
      .attr("x", d => xScale(d.idx) - 1).attr("y", d => yVolumeScale(d.yesVolume + d.noVolume)).attr("width", 2).attr("height", d => topChartBot - yVolumeScale(d.yesVolume + d.noVolume))
      .attr("fill", d => d.yesVolume > d.noVolume ? "rgba(56, 161, 105, 0.4)" : d.noVolume > d.yesVolume ? "rgba(229, 62, 62, 0.4)" : "rgba(160, 174, 192, 0.4)");
    
    const priceLine = d3.line().x(d => xScale(d.idx)).y(d => yPriceScale(d.price)).curve(d3.curveMonotoneX);
    focusTop.append("path").datum(data).attr("class", "price-line").attr("fill", "none").attr("stroke", "#3182ce").attr("stroke-width", 3).attr("d", priceLine);

    const zScoreLine = d3.line().x(d => xScale(d.idx)).y(d => yZScoreScale(d.zScore)).curve(d3.curveMonotoneX);
    const zScoreArea = d3.area().x(d => xScale(d.idx)).y0(bottomChartBot).y1(d => yZScoreScale(d.zScore)).curve(d3.curveMonotoneX);
    const arimaxLine = d3.line().defined(d => d.arimax !== null).x(d => xScale(d.idx)).y(d => yZScoreScale(d.arimax));
    
    focusBot.append("path").datum(data).attr("class", "zscore-area").attr("fill", "rgba(229, 62, 62, 0.04)").attr("d", zScoreArea);
    focusBot.append("path").datum(data).attr("class", "zscore-line").attr("fill", "none").attr("stroke", "#e53e3e").attr("stroke-width", 1.5).attr("d", zScoreLine);
    focusBot.append("path").datum(data.filter(d => d.arimax !== null)).attr("class", "arimax-line").attr("fill", "none").attr("stroke", "rgba(74, 85, 104, 0.8)").attr("stroke-width", 2).attr("stroke-dasharray", "5,5").attr("d", arimaxLine);

    const topLegend = svg.append("g").attr("transform", `translate(${width - margin.right - 80}, 15)`);
    const topLegendData = [{ label: "Price", type: "line", color: "#3182ce" }];
    
    const topLegendItems = topLegend.selectAll(".legend-item").data(topLegendData).enter().append("g");
    topLegendItems.each(function(d) {
      const g = d3.select(this);
      g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 20).attr("y2", 0).attr("stroke", d.color).attr("stroke-width", 3);
      g.append("text").attr("x", 28).attr("y", 4).text(d.label).style("font-size", "11px").style("fill", "#4a5568").attr("alignment-baseline", "middle");
    });

    const bottomLegend = svg.append("g").attr("transform", `translate(${width - margin.right - 350}, ${bottomChartTop - 15})`);
    
    const bottomLegendData = [
      { label: ["Measured Z-Score"], type: "line", color: "#e53e3e" },
      { label: ["Predicted z-score", "using ARIMAX"], type: "dashed", color: "rgba(74, 85, 104, 0.8)" },
      { label: ["Anomaly Zone"], type: "rect", color: "rgba(153, 27, 27, 0.25)" } // Matched darker red
    ];

    const bottomLegendItems = bottomLegend.selectAll(".legend-item").data(bottomLegendData).enter()
      .append("g")
      .attr("transform", (d, i) => `translate(${i * 130}, 0)`);

    bottomLegendItems.each(function(d) {
      const g = d3.select(this);
      
      if (d.type === "line" || d.type === "dashed") {
        g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 20).attr("y2", 0)
         .attr("stroke", d.color).attr("stroke-width", 3)
         .attr("stroke-dasharray", d.type === "dashed" ? "5,5" : "none");
      } else if (d.type === "rect") {
        g.append("rect").attr("x", 0).attr("y", -6).attr("width", 20).attr("height", 12).attr("fill", d.color);
      }

      g.append("text")
        .attr("x", 28)
        .attr("y", d.label.length > 1 ? -4 : 4) 
        .style("font-size", "11px")
        .style("fill", "#4a5568")
        .selectAll("tspan")
        .data(d.label)
        .enter()
        .append("tspan")
          .attr("x", 28)
          .attr("dy", (line, index) => index === 0 ? 0 : "1.2em")
          .text(line => line);
    });

    const crosshair = svg.append("line").attr("class", "crosshair").style("display", "none")
      .attr("y1", margin.top).attr("y2", bottomChartBot).attr("stroke", "#a0aec0").attr("stroke-width", 1).attr("stroke-dasharray", "4,4");

    const tooltip = svg.append("g").style("display", "none");
    const dotTop = tooltip.append("circle").attr("r", 5).attr("fill", "#3182ce").attr("stroke", "white").attr("stroke-width", 2);
    const dotBot = tooltip.append("circle").attr("r", 5).attr("fill", "#e53e3e").attr("stroke", "white").attr("stroke-width", 2);
    
    const tooltipContent = tooltip.append("g");
    const tooltipBg = tooltipContent.append("rect").attr("fill", "rgba(255, 255, 255, 0.95)").attr("stroke", "#cbd5e0").attr("rx", 4);
    const tooltipText = tooltipContent.append("text").style("font-size", "12px").style("font-weight", "bold").style("fill", "#2d3748");

    const overlay = svg.append("rect").attr("class", "overlay")
      .attr("x", margin.left).attr("y", margin.top).attr("width", width - margin.left - margin.right).attr("height", height - margin.top - margin.bottom)
      .attr("fill", "none").attr("pointer-events", "all");

    overlay
      .on("mouseover", () => { tooltip.style("display", null); crosshair.style("display", null); })
      .on("mouseout", () => { tooltip.style("display", "none"); crosshair.style("display", "none"); })
      .on("mousemove", (event) => {
        tooltip.style("display", null); 
        crosshair.style("display", null);
        
        const currentTransform = d3.zoomTransform(overlay.node());
        const currentXScale = currentTransform.rescaleX(xScale);
        
        const [mouseX, mouseY] = d3.pointer(event);
        
        let index = Math.round(currentXScale.invert(mouseX));
        if (index < 0) index = 0; if (index > data.length - 1) index = data.length - 1;
        const d = data[index];
        const currentX = currentXScale(d.idx);

        crosshair.attr("x1", currentX).attr("x2", currentX);
        dotTop.attr("cx", currentX).attr("cy", yPriceScale(d.price));
        dotBot.attr("cx", currentX).attr("cy", yZScoreScale(d.zScore));
        
        const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const isLowLiquidity = (d.yesVolume + d.noVolume) < (maxVolume * 0.05) || d.tradeCount < 3; 

        tooltipText.selectAll("tspan").remove();
        tooltipText.append("tspan").attr("x", 0).attr("dy", "0").style("fill", "#3182ce").text(`Price: ${(d.price * 100).toFixed(1)}%`);
        
        tooltipText.append("tspan").attr("x", 0).attr("dy", "1.4em").style("fill", "#38a169").text(`Yes money vol: ${formatter.format(d.yesVolume)}`);
        tooltipText.append("tspan").attr("x", 0).attr("dy", "1.4em").style("fill", "#e53e3e").text(`No money vol: ${formatter.format(d.noVolume)}`);
        tooltipText.append("tspan").attr("x", 0).attr("dy", "1.4em").style("fill", "#38a169").text(`Yes bet vol: ${d.yesCount || 0}`);
        tooltipText.append("tspan").attr("x", 0).attr("dy", "1.4em").style("fill", "#e53e3e").text(`No bet vol: ${d.noCount || 0}`);
        
        tooltipText.append("tspan").attr("x", 0).attr("dy", "1.4em").style("fill", "#805ad5").text(`Z-Score: ${d.zScore.toFixed(2)}σ`);
        tooltipText.append("tspan").attr("x", 0).attr("dy", "1.6em").style("fill", isLowLiquidity ? "#dd6b20" : "#718096").style("font-size", "10px")
                   .text(isLowLiquidity ? "Low Liquidity / Thin Order Flow" : "Healthy Crowd Consensus");
        
        const bbox = tooltipText.node().getBBox();
        tooltipBg.attr("x", bbox.x - 8).attr("y", bbox.y - 6).attr("width", bbox.width + 16).attr("height", bbox.height + 12);

        let contentX = currentX + 15;
        if (contentX + bbox.width + 20 > width - margin.right) contentX = currentX - bbox.width - 25; 
        
        let contentY = mouseY + 15; 
        if (contentY + bbox.height + 20 > height - margin.bottom) {
            contentY = mouseY - bbox.height - 15;
        }
        
        tooltipContent.attr("transform", `translate(${contentX}, ${contentY})`);
      });

    const zoom = d3.zoom().scaleExtent([1, 20]).translateExtent([[margin.left, 0], [width - margin.right, height]]).extent([[margin.left, 0], [width - margin.right, height]])
      .on("zoom", (event) => {
        const newXScale = event.transform.rescaleX(xScale);
        xAxisGroupTop.call(xAxis.scale(newXScale));
        xAxisGroupBot.call(xAxis.scale(newXScale));
        
        focusTop.select(".price-line").attr("d", priceLine.x(d => newXScale(d.idx)));
        
        focusTop.selectAll(".vol-bar")
          .attr("x", d => newXScale(d.idx) - 1)
          .attr("width", 2);

        focusBot.select(".zscore-line").attr("d", zScoreLine.x(d => newXScale(d.idx)));
        focusBot.select(".zscore-area").attr("d", zScoreArea.x(d => newXScale(d.idx)));
        focusBot.select(".arimax-line").attr("d", arimaxLine.x(d => newXScale(d.idx)));

        if (showAnomalies) {
          focusTop.selectAll(".anom-top").attr("x", d => newXScale(d.start)).attr("width", d => Math.max(2, newXScale(d.end) - newXScale(d.start)));
          focusBot.selectAll(".anom-bot").attr("x", d => newXScale(d.start)).attr("width", d => Math.max(2, newXScale(d.end) - newXScale(d.start)));
        }
        tooltip.style("display", "none");
        crosshair.style("display", "none");
      });

    overlay.call(zoom);

  }, [chartData, showAnomalies]);

  if (!chartData || !chartData.length) return <div style={{ height: '650px', textAlign: 'center', paddingTop: '300px' }}>Loading stream...</div>;

  return (
    <div style={{ position: 'relative', width: '100%', background: 'white', borderRadius: '8px', padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: '20px', padding: '0 60px', marginBottom: '10px', justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#4a5568', fontWeight: 'bold' }}>
          <input type="checkbox" checked={showAnomalies} onChange={(e) => setShowAnomalies(e.target.checked)} style={{ accentColor: '#e53e3e' }} />
          Highlight Anomaly Zones
        </label>
      </div>
      <div style={{ height: '650px', width: '100%' }}>
        <svg ref={svgRef}></svg>
      </div>
    </div>
  );
}