function SyncSection({
  admin,
  scrapingTarget,
  handleTriggerScraper,
  draftSchedules,
  handleApproveAllDrafts,
  setShowClearDraftsConfirm
}) {
  if (admin.admin_id !== 1) return null;

  return (
    <div className="mass-types-section" style={{ marginTop: '0.2rem', border: '2px solid rgba(44, 62, 145, 0.12)' }}>
      <div className="mass-types-header"><h3 style={{ color: '#2c3e91' }}>Target Site Synchronizations</h3></div>
      <p style={{ fontSize: '0.8rem', color: '#666', margin: '0.5rem 0 1rem 0', lineHeight: '1.4' }}>Trigger web scripts to collect mass listings.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        <button className="btn-add-template" style={{ backgroundColor: '#2c3e91', width: '100%', margin: 0 }} disabled={scrapingTarget !== null} onClick={() => handleTriggerScraper('st_john_btn')}>
          {scrapingTarget === 'st_john_btn' ? 'Syncing St. John...' : 'Sync St. John Cathedral'}
        </button>
        <button className="btn-add-template" style={{ backgroundColor: '#6ba368', width: '100%', margin: 0 }} disabled={scrapingTarget !== null} onClick={() => handleTriggerScraper('holy_rosary_btn')}>
          {scrapingTarget === 'holy_rosary_btn' ? 'Syncing Holy Rosary...' : 'Sync Holy Rosary Church'}
        </button>
        <button className="btn-add-template" style={{ backgroundColor: '#8c4b2d', width: '100%', margin: 0 }} disabled={scrapingTarget !== null} onClick={() => handleTriggerScraper('ofkl')}>
          {scrapingTarget === 'ofkl' ? 'Syncing OFKL...' : 'Sync Church of Our Lady of Fatima'}
        </button>
        <button className="btn-add-template" style={{ backgroundColor: '#d4af37', width: '100%', margin: 0 }} disabled={scrapingTarget !== null} onClick={() => handleTriggerScraper('assumption_pj_btn')}>
          {scrapingTarget === 'assumption_pj_btn' ? 'Syncing Assumption...' : 'Sync Assumption Church'}
        </button>
      </div>
      <div style={{ marginTop: '0.9rem', paddingTop: '0.8rem', borderTop: '1px solid rgba(44, 62, 145, 0.12)' }}>
        <div className="mass-types-header" style={{ marginBottom: '0.45rem' }}><h3 style={{ color: '#2c3e91', fontSize: '0.95rem' }}>Review Staged Drafts</h3></div>
        {draftSchedules.length > 0 ? (
          <>
            <div style={{ marginBottom: '0.65rem', fontSize: '0.8rem', color: '#666' }}>{draftSchedules.length} draft{draftSchedules.length === 1 ? '' : 's'} waiting review.</div>
            <button className="btn-add-template" style={{ backgroundColor: '#2c3e91', width: '100%', margin: 0 }} onClick={handleApproveAllDrafts}>Approve All Staged Drafts</button>
            <button className="btn-add-template" style={{ backgroundColor: '#b03a2e', width: '100%', marginTop: '0.6rem' }} onClick={() => setShowClearDraftsConfirm(true)}>Remove All Staged Drafts</button>
          </>
        ) : <div style={{ fontSize: '0.8rem', color: '#777', lineHeight: '1.4' }}>No staged drafts waiting review.</div>}
      </div>
    </div>
  );
}

export default SyncSection;