import React, { useState, useEffect, useMemo } from 'react';
import DashboardHeader from './components/DashboardHeader'; 
import KPIGrid from './components/KPIGrid';
import Timelinechart from './components/Timelinechart';
import SankeyChart from './components/SankeyChart';
import CertaintyVolumeRidgeline from './components/CertaintyVolumeRidgeline';
import ChartHeader from './components/ChartHeader';

export default function DashboardApp() {

  //Stores the raw JSON payloads returned from our Python backend.
  const [catalog, setCatalog] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [uncertainty, setUncertainty] = useState(null);
  
  //Controls visual feedback during asynchronous data fetching to prevent empty-state flashes.
  const [loading, setLoading] = useState(false);
  const [ridgeline, setRidgeline] = useState(null);
  const [ridgelineError, setRidgelineError] = useState(null);

  //Determines the user's current perspective of the dataset. Defaults to 'All' to show sankey view initially.
  const [activeTab, setActiveTab] = useState('sankey');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // ==========================================
  // API PIPELINE 
  // ==========================================

  // 1. INITIALIZATION: Fetch the global dashboard catalog on initial load.
  // WHY: This populates the dropdown menus and allows us to set a default market 
  // so the user isn't staring at a blank timeline chart.
  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/dashboard/catalog");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const list = Array.isArray(data?.catalog) ? data.catalog : [];
        setCatalog(list);

        // Auto-select the first market in the catalog to populate the UI immediately
        if (list.length > 0) {
          setSelectedId(list[0].id);
        }
      } catch (error) {
        console.error("Failed to load catalog:", error);
      }
    };
    fetchCatalog();
  }, []);


  // 2. TIMELINE DATA: Fetch the specific historical data whenever the user selects a new market.
  // WHY: We isolate this in its own useEffect listening to `selectedId` so we don't 
  // re-fetch the massive catalog data every time the user just wants to change the chart view.
  useEffect(() => {
    if (!selectedId) return;

    const fetchTimeSeries = async () => {
      setLoading(true); // Trigger UI loading state for the chart
      try {
        const response = await fetch(`http://localhost:8000/api/dashboard/timeseries?market_id=${selectedId}`);
        const data = await response.json();
        
        setChartData(data.series);
      } catch (error) {
        console.error("Failed to load time series:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchTimeSeries();
  }, [selectedId]);

  // 3. UNCERTAINTY METRICS: Fetch the semantic uncertainty payload for the active market.
  useEffect(() => {
    if (!selectedId) return;

    const fetchUncertainty = async () => {
      try {
        const response = await fetch(`http://localhost:8000/api/dashboard/uncertainty?market_id=${selectedId}`);
        if (!response.ok) {
          setUncertainty(null);
          return;
        }
        const data = await response.json();
        setUncertainty(data);
      } catch (error) {
        console.error("Failed to load uncertainty:", error);
        setUncertainty(null);
      }
    };
    fetchUncertainty();
  }, [selectedId]);

  // 4. MACRO RIDGELINE DATA: Fetch the global Certainty vs Volume data.
  // WHY: Uses a cancellation token pattern (`cancelled` boolean) to prevent React 
  // memory leaks if the user navigates away from the tab before the large payload finishes downloading.
  useEffect(() => {
    let cancelled = false;
    const fetchRidgeline = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/dashboard/certainty_volume_ridgeline");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!cancelled) setRidgeline(data);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load ridgeline data:", error);
        setRidgelineError(error.message);
      }
    };
    fetchRidgeline();
    return () => { cancelled = true; };
  }, []);

  // ==========================================
  // DATA TRANSFORMATION & FILTERING
  // ==========================================

  // Dynamically extract unique genres/categories for the <select> menus using Sets to remove duplicates
  const genres = ['All', ...new Set(catalog.map(m => m.category).filter(Boolean))];
  const categories = ['All', ...new Set(catalog.map(m => m.predicted_label).filter(Boolean))];

  // Derive a sub-array of markets based on the active dropdown selections
  const filteredCatalog = catalog.filter(m => {
    const matchGenre = selectedGenre === 'All' || m.category === selectedGenre;
    const matchCat = selectedCategory === 'All' || m.predicted_label === selectedCategory;
    return matchGenre && matchCat;
  });
  
  // IMPLEMENTATION CONSIDERATION: Filter Synchronization
  // WHY: If a user has Market A selected, and then filters the dashboard to a category 
  // that Market A doesn't belong to, the app would crash. This useEffect detects that edge case 
  // and boots the user safely back to the first available market in the new filtered list.
  useEffect(() => {
    if (filteredCatalog.length > 0) {
      const marketStillExists = filteredCatalog.find(m => m.id === selectedId);
      
      if (!marketStillExists) {
        setSelectedId(filteredCatalog[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [filteredCatalog]);

  // ==========================================
  // PERFORMANCE OPTIMIZATIONS
  // ==========================================
  //  KPI Calculations
  //  We cache this array math (reduce/filter) using React's useMemo hook.
  // This prevents the application from locking up and recalculating total trades and Z-score 
  // anomalies every single time the user clicks a tab or types in a search bar.
  const stats = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { totalTrades: 0, maxZ: 0, anomalyPct: "0%", currentZScore: 0, currentArimax: 0 };
    }
    
    // Sum total historical trades for the selected market
    const totalTrades = chartData.reduce((sum, d) => sum + (d.trade_count || 0), 0);
    
    // Find the highest Z-score to determine the market's peak chaos
    const maxZ = Math.max(...chartData.map(d => d.zscore || 0));
    
    // Calculate what percentage of the market's lifespan is spent in a mathematically volatile state (>1.96 std dev)
    const anomalyCount = chartData.filter(d => (d.zscore || 0) > 1.96).length;
    const anomalyPct = ((anomalyCount / chartData.length) * 100).toFixed(1) + "%";
    
    // Grab the most recent data point for the live dashboard readout
    const lastPoint = chartData[chartData.length - 1];
    
    return {
      totalTrades,
      maxZ,
      anomalyPct,
      currentZScore: lastPoint?.zscore || 0,
      currentArimax: lastPoint?.arimax || 0
    };
  }, [chartData]);

  // Pass-through metadata for child components to consume
  const currentMeta = catalog.find(m => m.id === selectedId);
  const currentLabel = currentMeta ? currentMeta.predicted_label : '';

  // The 'Certainty' ridgeline tab acts globally across the dataset, so we lock the specific market filters
  const filtersDisabled = activeTab === 'certainty';

  // ==========================================
  // RENDER UI
  // ==========================================
  return (
    <div style={{ padding: '40px', background: '#f4f6f9', minHeight: '100vh', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 25px rgba(0,0,0,0.06)' }}>
        
        {/* Filter Controls, always present at the top of the page, lets users refine search criteria/control sankey chart too */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '25px', padding: '15px', background: '#edf2f7', borderRadius: '8px', border: '1px solid #e2e8f0', opacity: filtersDisabled ? 0.5 : 1 }}>
          <div>
            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '13px', color: '#4a5568', textTransform: 'uppercase', marginBottom: '5px' }}>Filter by Genre:</label>
            <select value={selectedGenre} onChange={(e) => setSelectedGenre(e.target.value)} disabled={filtersDisabled} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e0', background: 'white', cursor: filtersDisabled ? 'not-allowed' : 'pointer', minWidth: '150px' }}>
              {genres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '13px', color: '#4a5568', textTransform: 'uppercase', marginBottom: '5px' }}>Filter by Model Type:</label>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} disabled={filtersDisabled} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e0', background: 'white', cursor: filtersDisabled ? 'not-allowed' : 'pointer', minWidth: '150px' }}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Global Navigation Tabs, market timeline, Sankey, and*/}
        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '25px', gap: '20px' }}>
          <button
            onClick={() => setActiveTab('sankey')}
            style={{ padding: '10px 5px', background: 'none', border: 'none', borderBottom: activeTab === 'sankey' ? '3px solid #3182ce' : '3px solid transparent', color: activeTab === 'sankey' ? '#2b6cb0' : '#a0aec0', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', transition: 'all 0.2s' }}
          >
            Market category percentages
          </button>
          
          <button
            onClick={() => setActiveTab('timeline')}
            style={{ padding: '10px 5px', background: 'none', border: 'none', borderBottom: activeTab === 'timeline' ? '3px solid #3182ce' : '3px solid transparent', color: activeTab === 'timeline' ? '#2b6cb0' : '#a0aec0', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', transition: 'all 0.2s' }}
          >
            Market Timeline
          </button>

          <button
            onClick={() => setActiveTab('certainty')}
            style={{ padding: '10px 5px', background: 'none', border: 'none', borderBottom: activeTab === 'certainty' ? '3px solid #3182ce' : '3px solid transparent', color: activeTab === 'certainty' ? '#2b6cb0' : '#a0aec0', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', transition: 'all 0.2s' }}
          >
            Certainty vs Volume
          </button>
        </div>

        {/* TAB 1: Micro/Timeline View */}
        {activeTab === 'timeline' && (
          <div className="fade-in-animation">
            
            <ChartHeader
              title="Market Timeline Analysis"
              description="Select an individual market from your filtered catalog below to visualize its real-time trading volume, probability price, and mathematical volatility."
              howTo="Use the dropdown or search to find a specific market. The chart will automatically plot its historical data, the z-score of the market's price volatility, predicted-zscore based on ARIMAX, and highlight anomalies. Hover over the chart to see the probability, the volume of yes/no money, the number of yes/no transactions, z-score, and market health (marked at 30 minute intervals)."
            />

            <DashboardHeader
              catalog={filteredCatalog} 
              selectedId={selectedId} 
              onSelect={setSelectedId} 
            />
            <KPIGrid stats={stats} currentLabel={currentLabel} certainty={uncertainty} />
            
            {loading ? (
              <div style={{ height: '650px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a0aec0' }}>
                Fetching Live Data from DuckDB...
              </div>
            ) : (
              <Timelinechart chartData={chartData} />
            )}
          </div>
        )}

        {/* TAB 2: Macro/Sankey View */}
        {activeTab === 'sankey' && (
          <div className="fade-in-animation">
            
            <ChartHeader 
              title="Welcome to the Polymarket Analytics Platform"
              description={
                <>
                  This platform tracks, analyzes, and categorizes <strong>{catalog.length.toLocaleString()}</strong> prediction markets. 
                  The flow chart below illustrates how these markets are distributed across real-world genres (like Politics or Crypto) and their semantic categories (like Stochastic or Objective Outcome).
                </>
              }
              howTo="Use the dropdown filters above to isolate specific sectors. Hover over the thick colored blocks to see exact market counts and percentages, or trace the paths to see how the categories connect! You can also click on the paths to isolate and filter specific categories and types. Hit the reset button at the bottom reset the filters."
            />

            <SankeyChart
              catalog={catalog} 
              selectedGenre={selectedGenre} 
              selectedCategory={selectedCategory} 
              
              onLinkClick={(clickedGenre, clickedCategory) => {
                const alreadySelected =
                  selectedGenre === clickedGenre && selectedCategory === clickedCategory;
                setSelectedGenre(alreadySelected ? 'All' : clickedGenre);
                setSelectedCategory(alreadySelected ? 'All' : clickedCategory);
              }}

              onNodeClick={(nodeName) => {
                if (genres.includes(nodeName)) {
                  setSelectedGenre(selectedGenre === nodeName ? 'All' : nodeName);
                  setSelectedCategory('All');
                } else if (categories.includes(nodeName)) {
                  setSelectedCategory(selectedCategory === nodeName ? 'All' : nodeName);
                  setSelectedGenre('All');
                }
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
              <button 
                onClick={() => {
                  setSelectedGenre('All');
                  setSelectedCategory('All');
                }}
                style={{
                  padding: '10px 24px', 
                  background: 'white', 
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px', 
                  color: '#e53e3e', 
                  fontWeight: 'bold',
                  fontSize: '14px',
                  cursor: 'pointer', 
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = '#fed7d7';
                  e.target.style.borderColor = '#fc8181';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'white';
                  e.target.style.borderColor = '#e2e8f0';
                }}
              >
                Reset Filters
              </button>
            </div>

          </div>
        )}

        {/* TAB 3: Global Ridgeline View */}
        {activeTab === 'certainty' && (
          <div className="fade-in-animation">
            <ChartHeader
              title="Certainty vs Volume Ridgeline"
              description="This ridgeline plot visualizes the distribution of market certainty (whether a market overwhelmingly bet on one outcome) against trading volume across all markets. Each ridge represents a different volume bucket, allowing you to see how certainty varies with market activity."
              howTo="Hover over each ridge to see the exact certainty distribution for that volume bucket. Look for patterns such as whether higher volume markets tend to have more certainty (indicating strong consensus) or if lower volume markets show more uncertainty (lower consensus)."
            />
            <CertaintyVolumeRidgeline data={ridgeline} error={ridgelineError} />
          </div>
        )}
      </div>
    </div>
  );
}