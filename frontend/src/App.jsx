import React, { useState, useEffect, useMemo } from 'react';
import DashboardHeader from './components/DashboardHeader'; 
import KPIGrid from './components/KPIGrid';
import DualAxisChart from './components/DualAxisChart';
import SankeyChart from './components/SankeyChart';
import CertaintyVolumeRidgeline from './components/CertaintyVolumeRidgeline';

export default function DashboardApp() {
  const [catalog, setCatalog] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [uncertainty, setUncertainty] = useState(null);
  const [loading, setLoading] = useState(false);

  const [ridgeline, setRidgeline] = useState(null);
  const [ridgelineError, setRidgelineError] = useState(null);

  const [activeTab, setActiveTab] = useState('macro');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/dashboard/catalog");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const list = Array.isArray(data?.catalog) ? data.catalog : [];
        setCatalog(list);

        if (list.length > 0) {
          setSelectedId(list[0].id);
        }
      } catch (error) {
        console.error("Failed to load catalog:", error);
      }
    };
    fetchCatalog();
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    const fetchTimeSeries = async () => {
      setLoading(true);
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


  const genres = ['All', ...new Set(catalog.map(m => m.category).filter(Boolean))];
  const categories = ['All', ...new Set(catalog.map(m => m.predicted_label).filter(Boolean))];

  const filteredCatalog = catalog.filter(m => {
    const matchGenre = selectedGenre === 'All' || m.category === selectedGenre;
    const matchCat = selectedCategory === 'All' || m.predicted_label === selectedCategory;
    return matchGenre && matchCat;
  });
  
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

  const stats = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { totalTrades: 0, maxZ: 0, anomalyPct: "0%", currentZScore: 0, currentArimax: 0 };
    }
    const totalTrades = chartData.reduce((sum, d) => sum + (d.trade_count || 0), 0);
    const maxZ = Math.max(...chartData.map(d => d.zscore || 0));
    const anomalyCount = chartData.filter(d => (d.zscore || 0) > 1.96).length;
    const anomalyPct = ((anomalyCount / chartData.length) * 100).toFixed(1) + "%";
    
    const lastPoint = chartData[chartData.length - 1];
    
    return {
      totalTrades,
      maxZ,
      anomalyPct,
      currentZScore: lastPoint?.zscore || 0,
      currentArimax: lastPoint?.arimax || 0
    };
  }, [chartData]);

  const currentMeta = catalog.find(m => m.id === selectedId);
  const currentLabel = currentMeta ? currentMeta.predicted_label : '';

  return (
    <div style={{ padding: '40px', background: '#f4f6f9', minHeight: '100vh', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 25px rgba(0,0,0,0.06)' }}>
        
        <div style={{ display: 'flex', gap: '20px', marginBottom: '25px', padding: '15px', background: '#edf2f7', borderRadius: '8px', border: '1px solid #e2e8f0', opacity: activeTab === 'certainty' ? 0.5 : 1 }}>
          <div>
            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '13px', color: '#4a5568', textTransform: 'uppercase', marginBottom: '5px' }}>Filter by Genre:</label>
            <select value={selectedGenre} onChange={(e) => setSelectedGenre(e.target.value)} disabled={activeTab === 'certainty'} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e0', background: 'white', cursor: activeTab === 'certainty' ? 'not-allowed' : 'pointer', minWidth: '150px' }}>
              {genres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          
          <div>
            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '13px', color: '#4a5568', textTransform: 'uppercase', marginBottom: '5px' }}>Filter by Model Type:</label>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} disabled={activeTab === 'certainty'} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e0', background: 'white', cursor: activeTab === 'certainty' ? 'not-allowed' : 'pointer', minWidth: '150px' }}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '25px', gap: '20px' }}>
          <button
            onClick={() => setActiveTab('macro')}
            style={{ padding: '10px 5px', background: 'none', border: 'none', borderBottom: activeTab === 'macro' ? '3px solid #3182ce' : '3px solid transparent', color: activeTab === 'macro' ? '#2b6cb0' : '#a0aec0', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', transition: 'all 0.2s' }}
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

        {activeTab === 'timeline' && (
          <div className="fade-in-animation">
            
            <div style={{ 
              background: '#ebf8ff', 
              borderLeft: '4px solid #3182ce', 
              padding: '20px 25px', 
              borderRadius: '8px', 
              marginBottom: '25px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}>
              <h2 style={{ margin: '0 0 10px 0', color: '#2b6cb0', fontSize: '20px' }}>
                Market Timeline Analysis
              </h2>
              <p style={{ margin: '0 0 10px 0', color: '#2d3748', fontSize: '15px', lineHeight: '1.6' }}>
                Select an individual market from your filtered catalog below to visualize its real-time trading volume, probability price, and mathematical volatility.
              </p>
              <p style={{ margin: 0, color: '#4a5568', fontSize: '14px', fontStyle: 'italic' }}>
                <strong>How to use this page:</strong> Use the dropdown or search to find a specific market. The chart will automatically plot its historical data, highlighting any chaotic, news-driven anomalies. Hover over the chart to see the probability, the volume of yes/no money, the number of yes/no transactions, z-score, and market health (marked at 30 minute intervals).
              </p>
            </div>

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
              <DualAxisChart chartData={chartData} />
            )}
          </div>
        )}

        {activeTab === 'macro' && (
          <div className="fade-in-animation">
            <div style={{ 
              background: '#ebf8ff', 
              borderLeft: '4px solid #3182ce', 
              padding: '20px 25px', 
              borderRadius: '8px', 
              marginBottom: '25px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}>
              <h2 style={{ margin: '0 0 10px 0', color: '#2b6cb0', fontSize: '20px' }}>
                Welcome to the Polymarket Analytics Platform
              </h2>
              <p style={{ margin: '0 0 10px 0', color: '#2d3748', fontSize: '15px', lineHeight: '1.6' }}>
                This platform tracks, analyzes, and categorizes <strong>{catalog.length.toLocaleString()}</strong> prediction markets. 
                The flow chart below illustrates how these markets are distributed across real-world genres (like Politics or Crypto) and their underlying mathematical models (like Stochastic or Objective Outcome).
              </p>
              <p style={{ margin: 0, color: '#4a5568', fontSize: '14px', fontStyle: 'italic' }}>
                <strong>How to use this page:</strong> Use the dropdown filters above to isolate specific sectors. Hover over the thick colored blocks to see exact market counts, or trace the paths to see how the categories connect!
              </p>
            </div>

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

        {activeTab === 'certainty' && (
          <div className="fade-in-animation">
            <CertaintyVolumeRidgeline data={ridgeline} error={ridgelineError} />
          </div>
        )}

      </div>
    </div>
  );
}