import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export default function Timelinechart({ chartData }) {

  const svgRef = useRef();
  const [showAnomalies, setShowAnomalies] = useState(true);

  useEffect(() => {
    if (!chartData || !chartData.length) return;

    if (chartData.length < 2) {
      d3.select(svgRef.current).selectAll("*").remove();
      return; 
    }

    // Clean up old tooltips before re-rendering to prevent ghost DOM nodes
    d3.select(svgRef.current.parentNode).selectAll(".info-blip-tooltip").remove();
    
    // Custom Info Tooltip style, serves as template for the hovering tool tip elements
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

    // ==========================================
    // DATA PREPARATION & DOWNSAMPLING
    // ==========================================
    // Caps the maximum rendered points to 1440 .
    // Esures the timeline remains interactive and zoomable regardless of how massive the market's trading history is.
    const MAX_POINTS = 1440; 
    const sampledData = chartData.length > MAX_POINTS 
      ? chartData.filter((_, index) => index % Math.ceil(chartData.length / MAX_POINTS) === 0)
      : chartData;

    // Calculates the absolute sum of all trades to pass into the tooltip
    const totalTradesInSet = sampledData.reduce((sum, d) => sum + (d.trade_count || 0), 0);
    let runningTotal = 0;

    // Standardize data format for D3 ingestion
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

    // Anomaly Region Detection: Scans the standardized dataset to find continuous periods where the Z-Score exceeds 1.96.
    // WHY: Allows us to visually highlight periods where the price volatility exceeds 1.96 std in red
    const anomalyRegions = [];
    let inAnomaly = false; let startIdx = 0;
    data.forEach((d, i) => {
      if (d.zScore > 1.96 && !inAnomaly) { inAnomaly = true; startIdx = i; } 
      else if (d.zScore <= 1.96 && inAnomaly) { inAnomaly = false; anomalyRegions.push({ start: startIdx, end: i }); }
    });
    if (inAnomaly) anomalyRegions.push({ start: startIdx, end: data.length - 1 });

    // ==========================================
    // 1. BASE SVG & SHARED ARCHITECTURE
    // ==========================================
    const width = 1000;
    const height = 650; 
    const margin = { top: 40, right: 60, bottom: 40, left: 60 };

    // Define the exact pixel boundaries for the dual layout (Top = Price/Vol, Bottom = Z-Score/ARIMAX prediction)
    const topChartBot = 280; 
    const bottomChartTop = 380;
    const bottomChartBot = height - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`).style("width", "100%").style("height", "100%");

    // Shared X-Axis Scale (Time)
    // Domain = Data (Index 0 to N). Range = Physical pixels on the screen (Left Margin to Right Margin).
    const xScale = d3.scaleLinear().domain([0, data.length - 1]).range([margin.left, width - margin.right]);

    // Clip Paths
    // WHY: When the user zooms in, this prevents the svg lines from visually bleeding off the edges of the chart container.
    svg.append("defs").append("clipPath").attr("id", "clip-top")
      .append("rect").attr("x", margin.left).attr("y", margin.top).attr("width", width - margin.left - margin.right).attr("height", topChartBot - margin.top);
    svg.append("defs").append("clipPath").attr("id", "clip-bot")
      .append("rect").attr("x", margin.left).attr("y", bottomChartTop).attr("width", width - margin.left - margin.right).attr("height", bottomChartBot - bottomChartTop);

    const focusTop = svg.append("g").attr("clip-path", "url(#clip-top)");
    const focusBot = svg.append("g").attr("clip-path", "url(#clip-bot)");

    // Render Shared X-Axes for top and bottom timeline chart
    const numTicks = Math.min(8, data.length - 1);
    const xAxis = d3.axisBottom(xScale).ticks(numTicks).tickFormat(i => Number.isInteger(i) ? (data[i]?.timeLabel || "") : "");
    const xAxisGroupTop = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${topChartBot})`).call(xAxis).attr("color", "#a0aec0");
    const xAxisGroupBot = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${bottomChartBot})`).call(xAxis).attr("color", "#a0aec0");

    // Shared X-Axis Labels
    svg.append("text").attr("x", width / 2).attr("y", topChartBot + 35).style("text-anchor", "middle").style("fill", "#718096").style("font-size", "12px").style("font-weight", "bold").text("Timeline (Local Time)");
    svg.append("text").attr("x", width / 2).attr("y", bottomChartBot + 35).style("text-anchor", "middle").style("fill", "#718096").style("font-size", "12px").style("font-weight", "bold").text("Timeline (Local Time)");

    // ==========================================
    // 2. TOP CHART: PRICE & VOLUME
    // ==========================================
    // Scales: Probability is strictly bounded 0.0 to 1.0 (0% to 100%)
    const yPriceScale = d3.scaleLinear().domain([0, 1]).range([topChartBot, margin.top]);
    
    // Dynamically finds the largest volume spike in the dataset to set the height ceiling for the volume bars
    const maxVolume = d3.max(data, d => d.yesVolume + d.noVolume) || 1;
    const yVolumeScale = d3.scaleLinear().domain([0, maxVolume]).range([topChartBot, topChartBot - 80]);

    // Axis Labels & Title
    svg.append("text").attr("transform", "rotate(-90)").attr("y", margin.left - 40).attr("x", -(margin.top + (topChartBot - margin.top) / 2)).style("text-anchor", "middle").style("fill", "#3182ce").style("font-size", "12px").style("font-weight", "bold").text("Probability Price (%)");

    // Y-Axis & Info Bubble
    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(yPriceScale).ticks(5)) // Generates 5 clean tick marks based on the 0-1 scale
      .attr("color", "#3182ce")
      .call(g => {
        g.append("circle").attr("cx", -25).attr("cy", margin.top - 19).attr("r", 7).attr("fill", "#edf2f7").attr("stroke", "#cbd5e0");
        g.append("text").attr("x", -25).attr("y", margin.top - 18).text("i").attr("text-anchor", "middle").attr("alignment-baseline", "middle").style("font-family", "serif").style("font-style", "italic").style("fill", "#4a5568").style("font-size", "11px");
        g.append("text").attr("x", -10).attr("y", margin.top - 15).attr("fill", "#3182ce").attr("text-anchor", "start").style("font-weight", "bold").text("Probability Price").style("font-size", "14px");
        
        // Invisible UX Hitbox: Expands the mouse detection area over the tiny 'i' icon to stop hover-flickering
        g.append("rect").attr("x", -35).attr("y", margin.top - 28).attr("width", 20).attr("height", 20).attr("fill", "transparent").style("cursor", "help")
          .on("mouseover", () => {
            infoTooltip.style("display", "block").html(`
              <strong>Probability Price (Blue Line)</strong><br/>
              <span style="color:#718096;">The raw market consensus ranging from 0% to 100%. It represents the direct cost of a single contract.<br/><br/></span>
              <strong>Volume (Green/Red Bars):</strong> <br/>
              <span style="color:#718096;">The actual US Dollar amount traded during a specific interval.<br/></span>
            `);
          })
          .on("mousemove", (event) => {
            const [x, y] = d3.pointer(event, svgRef.current.parentNode);
            infoTooltip.style("left", (x + 15) + "px").style("top", (y + 15) + "px");
          })
          .on("mouseout", () => infoTooltip.style("display", "none"));
      });

    // Anomaly Highlights (Red background rects)
    if (showAnomalies) {
      focusTop.selectAll(".anom-top").data(anomalyRegions).enter().append("rect").attr("class", "anom-top") 
        .attr("x", d => xScale(d.start)).attr("y", margin.top).attr("width", d => Math.max(2, xScale(d.end) - xScale(d.start))).attr("height", topChartBot - margin.top).attr("fill", "rgba(153, 27, 27, 0.15)");
    }

    // Volume Bars: Colors red if "No" volume is higher, Green if "Yes" volume is higher
    focusTop.selectAll(".vol-bar").data(data).enter().append("rect").attr("class", "vol-bar")
      .attr("x", d => xScale(d.idx) - 1).attr("y", d => yVolumeScale(d.yesVolume + d.noVolume)).attr("width", 2).attr("height", d => topChartBot - yVolumeScale(d.yesVolume + d.noVolume))
      .attr("fill", d => d.yesVolume > d.noVolume ? "rgba(56, 161, 105, 0.4)" : d.noVolume > d.yesVolume ? "rgba(229, 62, 62, 0.4)" : "rgba(160, 174, 192, 0.4)");
    
    // Price Line: Uses d3.curveMonotoneX to smoothly interpolate between data points instead of drawing harsh zig-zags
    const priceLine = d3.line().x(d => xScale(d.idx)).y(d => yPriceScale(d.price)).curve(d3.curveMonotoneX);
    focusTop.append("path").datum(data).attr("class", "price-line").attr("fill", "none").attr("stroke", "#3182ce").attr("stroke-width", 3).attr("d", priceLine);

    // Static Legend
    const topLegend = svg.append("g").attr("transform", `translate(${width - margin.right - 80}, 15)`);
    const topLegendData = [{ label: "Price", type: "line", color: "#3182ce" }];
    const topLegendItems = topLegend.selectAll(".legend-item").data(topLegendData).enter().append("g");
    topLegendItems.each(function(d) {
      const g = d3.select(this);
      g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 20).attr("y2", 0).attr("stroke", d.color).attr("stroke-width", 3);
      g.append("text").attr("x", 28).attr("y", 4).text(d.label).style("font-size", "11px").style("fill", "#4a5568").attr("alignment-baseline", "middle");
    });

    // ==========================================
    // 3. BOTTOM CHART: VOLATILITY & ARIMAX
    // ==========================================
    // Dynamically scales the Y-axis based on the absolute highest/lowest predicted or measured anomaly
    const minZ = d3.min(data, d => Math.min(d.zScore, d.arimax || 0, -1));
    const maxZ = d3.max(data, d => Math.max(d.zScore, d.arimax || 0, 4));
    const yZScoreScale = d3.scaleLinear().domain([minZ, maxZ]).range([bottomChartBot, bottomChartTop]);

    // Axis Labels & Title
    svg.append("text").attr("transform", "rotate(-90)").attr("y", margin.left - 40).attr("x", -(bottomChartTop + (bottomChartBot - bottomChartTop) / 2)).style("text-anchor", "middle").style("fill", "#e53e3e").style("font-size", "12px").style("font-weight", "bold").text("Volatility (Z-Score)");

    // Y-Axis & Info Bubble
    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(yZScoreScale).ticks(5))
      .attr("color", "#e53e3e")
      .call(g => {
        g.append("circle").attr("cx", -25).attr("cy", bottomChartTop - 19).attr("r", 7).attr("fill", "#edf2f7").attr("stroke", "#cbd5e0");
        g.append("text").attr("x", -25).attr("y", bottomChartTop - 18).text("i").attr("text-anchor", "middle").attr("alignment-baseline", "middle").style("font-family", "serif").style("font-style", "italic").style("fill", "#4a5568").style("font-size", "11px");
        g.append("text").attr("x", -10).attr("y", bottomChartTop - 15).attr("fill", "#e53e3e").attr("text-anchor", "start").style("font-weight", "bold").text("Volatility (Z-Score)").style("font-size", "14px");
        
        // Invisible UX Hitbox for smooth hovering
        g.append("rect").attr("x", -35).attr("y", bottomChartTop - 28).attr("width", 20).attr("height", 20).attr("fill", "transparent").style("cursor", "help")
          .on("mouseover", () => {
            infoTooltip.style("display", "block").html(`
              <strong>Volatility Z-Score (Red Line)</strong><br/>
              <span style="color:#718096;">Measures the volatility of price jumps using the log-returns of the last 10 trades. It ignores the clock and only tracks action.<br/><br/></span>
              <strong>ARIMAX (Gray Dashed Line):</strong> <br/>
              <span style="color:#718096;">Uses a pre-calculated ARIMAX coefficient to try and predict the true volatility of the market via autoregression.<br/></span>
            `);
          })
          .on("mousemove", (event) => {
            const [x, y] = d3.pointer(event, svgRef.current.parentNode);
            infoTooltip.style("left", (x + 15) + "px").style("top", (y - 120) + "px"); 
          })
          .on("mouseout", () => infoTooltip.style("display", "none"));
      });

    // Anomaly Highlights (Background)
    if (showAnomalies) {
      focusBot.selectAll(".anom-bot").data(anomalyRegions).enter().append("rect").attr("class", "anom-bot") 
        .attr("x", d => xScale(d.start)).attr("y", bottomChartTop).attr("width", d => Math.max(2, xScale(d.end) - xScale(d.start))).attr("height", bottomChartBot - bottomChartTop).attr("fill", "rgba(153, 27, 27, 0.15)");
    }

    // 1.96 Statistical Significance Threshold Line (The dashed red barrier)
    focusBot.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", yZScoreScale(1.96)).attr("y2", yZScoreScale(1.96)).attr("stroke", "#e53e3e").attr("stroke-dasharray", "4,4").attr("opacity", 0.5);

    // Z-Score and ARIMAX Lines
    const zScoreLine = d3.line().x(d => xScale(d.idx)).y(d => yZScoreScale(d.zScore)).curve(d3.curveMonotoneX);
    // Area generator fills the space beneath the line with a light red wash
    const zScoreArea = d3.area().x(d => xScale(d.idx)).y0(bottomChartBot).y1(d => yZScoreScale(d.zScore)).curve(d3.curveMonotoneX);
    // .defined() prevents the ARIMAX line from dropping to zero if a specific data point is missing from the backend
    const arimaxLine = d3.line().defined(d => d.arimax !== null).x(d => xScale(d.idx)).y(d => yZScoreScale(d.arimax));
    
    focusBot.append("path").datum(data).attr("class", "zscore-area").attr("fill", "rgba(229, 62, 62, 0.04)").attr("d", zScoreArea);
    focusBot.append("path").datum(data).attr("class", "zscore-line").attr("fill", "none").attr("stroke", "#e53e3e").attr("stroke-width", 1.5).attr("d", zScoreLine);
    focusBot.append("path").datum(data.filter(d => d.arimax !== null)).attr("class", "arimax-line").attr("fill", "none").attr("stroke", "rgba(74, 85, 104, 0.8)").attr("stroke-width", 2).attr("stroke-dasharray", "5,5").attr("d", arimaxLine);

    // Static Legend
    const bottomLegend = svg.append("g").attr("transform", `translate(${width - margin.right - 580}, ${bottomChartTop - 15})`);
    const bottomLegendData = [
      { label: ["Measured Z-Score"], type: "line", color: "#e53e3e" },
      { label: ["Predicted z-score", "using ARIMAX"], type: "dashed", color: "rgba(74, 85, 104, 0.8)" },
      { label: ["1.96σ Shock", "Threshold"], type: "dashed-threshold", color: "#e53e3e", opacity: 0.5 }, 
      { label: ["Anomaly Zone"], type: "rect", color: "rgba(153, 27, 27, 0.25)" }
    ];

    const bottomLegendItems = bottomLegend.selectAll(".legend-item").data(bottomLegendData).enter()
      .append("g")
      .attr("transform", (d, i) => `translate(${i * 150}, 0)`);

    bottomLegendItems.each(function(d) {
      const g = d3.select(this);
      if (d.type === "line" || d.type.includes("dashed")) {
        g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 20).attr("y2", 0)
         .attr("stroke", d.color)
         .attr("stroke-width", d.type === "dashed-threshold" ? 1.5 : 3)
         .attr("stroke-dasharray", d.type === "dashed" ? "5,5" : d.type === "dashed-threshold" ? "4,4" : "none")
         .attr("opacity", d.opacity || 1);
      } else if (d.type === "rect") {
        g.append("rect").attr("x", 0).attr("y", -6).attr("width", 20).attr("height", 12).attr("fill", d.color);
      }
      g.append("text").attr("x", 28).attr("y", d.label.length > 1 ? -4 : 4).style("font-size", "11px").style("fill", "#4a5568")
        .selectAll("tspan").data(d.label).enter().append("tspan")
          .attr("x", 28).attr("dy", (line, index) => index === 0 ? 0 : "1.2em").text(line => line);
    });

    // ==========================================
    // 4. INTERACTIVITY: TOOLTIPS, CROSSHAIR, & ZOOM
    // ==========================================
    const crosshair = svg.append("line").attr("class", "crosshair").style("display", "none")
      .attr("y1", margin.top).attr("y2", bottomChartBot).attr("stroke", "#a0aec0").attr("stroke-width", 1).attr("stroke-dasharray", "4,4");

    const tooltip = svg.append("g").style("display", "none");
    const dotTop = tooltip.append("circle").attr("r", 5).attr("fill", "#3182ce").attr("stroke", "white").attr("stroke-width", 2);
    const dotBot = tooltip.append("circle").attr("r", 5).attr("fill", "#e53e3e").attr("stroke", "white").attr("stroke-width", 2);
    
    // Generates the SVG container for the tooltip that follows the mouse
    const tooltipContent = tooltip.append("g");
    const tooltipBg = tooltipContent.append("rect").attr("fill", "rgba(255, 255, 255, 0.95)").attr("stroke", "#cbd5e0").attr("rx", 4);
    const tooltipText = tooltipContent.append("text").style("font-size", "12px").style("font-weight", "bold").style("fill", "#2d3748");

    // The invisible overlay that catches all mouse events across the entire chart area
    const overlay = svg.append("rect").attr("class", "overlay")
      .attr("x", margin.left).attr("y", margin.top).attr("width", width - margin.left - margin.right).attr("height", height - margin.top - margin.bottom)
      .attr("fill", "none").attr("pointer-events", "all");

    // Creates the market info tooltip that appeaers when the cursor is over the market timeline. Contains info like yes/no money volume, transaction volme, etc.
    overlay
      .on("mouseover", () => { tooltip.style("display", null); crosshair.style("display", null); })
      .on("mouseout", () => { tooltip.style("display", "none"); crosshair.style("display", "none"); })
      .on("mousemove", (event) => {
        tooltip.style("display", null); 
        crosshair.style("display", null);
        
        // Dynamically updates the X-scale if the user is currently zoomed in
        const currentTransform = d3.zoomTransform(overlay.node());
        const currentXScale = currentTransform.rescaleX(xScale);
        
        // d3.pointer extracts the exact [X, Y] pixel coordinates of the mouse
        const [mouseX, mouseY] = d3.pointer(event);
        
        // .invert() takes the physical pixel coordinate and translates it backward into the data array index
        let index = Math.round(currentXScale.invert(mouseX));
        if (index < 0) index = 0; if (index > data.length - 1) index = data.length - 1;
        const d = data[index];
        const currentX = currentXScale(d.idx);

        // Snaps the crosshair and data dots to the exact mathematical point closest to the mouse
        crosshair.attr("x1", currentX).attr("x2", currentX);
        dotTop.attr("cx", currentX).attr("cy", yPriceScale(d.price));
        dotBot.attr("cx", currentX).attr("cy", yZScoreScale(d.zScore));
        
        const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
        
        // Determines if the exact trade point being hovered to see if it represents true market consensus or low-volume noise.
        // WHY: Tells the user if a Z-Score spike is genuine volatility or a mathematical glitch caused by a dead market.
        const isLowLiquidity = (d.yesVolume + d.noVolume) < (maxVolume * 0.05) || d.tradeCount < 3; 

        // controls the text in the tooltip pop up bubble that appears when you hover over the market timeline
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

        // Boundary protection: Flips the tooltip to the left or top if it detects it is about to bleed off the edge of the SVG
        let contentX = currentX + 15;
        if (contentX + bbox.width + 20 > width - margin.right) contentX = currentX - bbox.width - 25; 
        
        let contentY = mouseY + 15; 
        if (contentY + bbox.height + 20 > height - margin.bottom) {
            contentY = mouseY - bbox.height - 15;
        }
        
        tooltipContent.attr("transform", `translate(${contentX}, ${contentY})`);
      });

    // Zoom Mechanics
    // scaleExtent restricts zooming from 1x to 20x. translateExtent prevents the user from panning into empty white space outside the chart.
    const zoom = d3.zoom().scaleExtent([1, 20]).translateExtent([[margin.left, 0], [width - margin.right, height]]).extent([[margin.left, 0], [width - margin.right, height]])
      .on("zoom", (event) => {
        // rescaleX mathematically stretches the X-axis based on the user's scroll-wheel input
        const newXScale = event.transform.rescaleX(xScale);
        xAxisGroupTop.call(xAxis.scale(newXScale));
        xAxisGroupBot.call(xAxis.scale(newXScale));
        
        // Redraws the lines based on the new stretched scale
        focusTop.select(".price-line").attr("d", priceLine.x(d => newXScale(d.idx)));
        focusTop.selectAll(".vol-bar").attr("x", d => newXScale(d.idx) - 1).attr("width", 2);

        focusBot.select(".zscore-line").attr("d", zScoreLine.x(d => newXScale(d.idx)));
        focusBot.select(".zscore-area").attr("d", zScoreArea.x(d => newXScale(d.idx)));
        focusBot.select(".arimax-line").attr("d", arimaxLine.x(d => newXScale(d.idx)));

        if (showAnomalies) {
          focusTop.selectAll(".anom-top").attr("x", d => newXScale(d.start)).attr("width", d => Math.max(2, newXScale(d.end) - newXScale(d.start)));
          focusBot.selectAll(".anom-bot").attr("x", d => newXScale(d.start)).attr("width", d => Math.max(2, newXScale(d.end) - newXScale(d.start)));
        }
        // Hide the tooltips while zooming so they don't stutter across the screen
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