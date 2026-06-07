import React, { useState, useEffect, useRef } from 'react';


// Searchable Header & Dropdown
export default function DashboardHeader({ catalog, selectedId, onSelect }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  
  const dropdownRef = useRef(null);
  //  Attaches a mousedown listener to the entire document. If the user opens the massive search dropdown but decides 
  // they don't want to click anything, clicking anywhere else on the page should cleanly close the menu.
  useEffect(() => {
    const handleClickOutside = (event) => {
      // If the dropdown exists AND the element the user just clicked is NOT inside the dropdown...
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    
    // Cleanup function to prevent memory leaks when the component unmounts
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  // Filters the incoming catalog array based on user input.
  // WHY: Allows the user to search by natural text (e.g., "Bitcoin") OR by the exact database ID (e.g., "8242"), 
  const filteredCatalog = catalog.filter(market => {
    const term = searchTerm.toLowerCase();
    const matchesQuestion = market.question?.toLowerCase().includes(term);
    const matchesId = market.id?.toString().toLowerCase().includes(term);
    return matchesQuestion || matchesId;
  });

  // WHAT: Hard-caps the rendered search results to 50 items.
  // If there are too many titles inside a dropdown menue, it will instantly crash the browser.
  const searchResults = filteredCatalog.slice(0, 50);
  
  // Grabs the full object data for whatever ID is currently active in the parent state
  const selectedMarket = catalog.find(m => m.id === selectedId);

  return (
    <div style={{ marginBottom: '25px', background: '#edf2f7', padding: '20px', borderRadius: '8px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '15px', marginBottom: '15px' }}>
        <h2 style={{ color: '#1a365d', margin: 0 }}>
          Polymarket Analytics Platform
        </h2>
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '10px' }} ref={dropdownRef}>
        <label style={{ fontWeight: 'bold', color: '#4a5568' }}>Search & Select Target Market ({catalog.length.toLocaleString()} Loaded):</label>
        
        {/* 
            Disables the input and changes the cursor to a "wait" spinner if the massive 
            DuckDB pipeline is still booting up, preventing the user from searching an empty array.
        */}
        <input 
          type="text"
          placeholder={catalog.length === 0 ? "Loading Pipeline..." : "Type to search by name or Market ID..."}
          value={isOpen ? searchTerm : (selectedMarket ? selectedMarket.question : '')}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setSearchTerm('');
            setIsOpen(true);
          }}
          style={{ 
            padding: '12px 15px', fontSize: '15px', borderRadius: '6px', 
            border: '1px solid #cbd5e0', outline: 'none', width: '100%',
            cursor: catalog.length === 0 ? 'wait' : 'text'
          }}
          disabled={catalog.length === 0}
        />

        {isOpen && searchResults.length > 0 && (
          <div style={{ 
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, 
            background: 'white', border: '1px solid #cbd5e0', borderRadius: '6px', 
            marginTop: '4px', maxHeight: '400px', overflowY: 'auto', 
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' 
          }}>
            {searchResults.map(market => (
              <div 
                key={market.id}
                onClick={() => {
                  onSelect(market.id);
                  setIsOpen(false);
                  setSearchTerm('');
                }}
                style={{ 
                  padding: '12px 15px', cursor: 'pointer', borderBottom: '1px solid #edf2f7',
                  background: selectedId === market.id ? '#ebf8ff' : 'white',
                  color: selectedId === market.id ? '#2b6cb0' : '#2d3748'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#edf2f7'}
                onMouseLeave={(e) => e.currentTarget.style.background = selectedId === market.id ? '#ebf8ff' : 'white'}
              >
                <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{market.question}</div>
                <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: '#718096', alignItems: 'center' }}>
                  <span style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>{market.category}</span>
                  <span style={{ background: '#fed7d7', color: '#c53030', padding: '2px 6px', borderRadius: '4px' }}>{market.predicted_label}</span>
                  <span style={{ color: '#a0aec0', marginLeft: 'auto', fontFamily: 'monospace' }}>ID: {market.id}</span>
                </div>
              </div>
            ))}
            
            {/* Displays the message telling user that there are more than 50 markets with the current filter criteria if there are more than 50 markets*/}
            {filteredCatalog.length > 50 && (
              <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#a0aec0', fontStyle: 'italic', background: '#f7fafc' }}>
                Showing top 50 results. Keep typing to narrow it down...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}