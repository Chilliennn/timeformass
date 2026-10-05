function MassTypesSection({ massTypes, handleAddScheduleFromType, handleDeleteMassType, setShowAddMassType }) {
  return (
    <div className="mass-types-section">
      <div className="mass-types-header">
        <h3>Mass Types</h3>
        <button className="btn-icon" onClick={() => setShowAddMassType(true)}>+</button>
      </div>
      <div className="mass-types-list">
        {massTypes.map((type) => (
          <div key={type.mass_type_id} className="mass-type-item">
            <input type="checkbox" checked readOnly />
            <div className="mass-type-color" style={{ backgroundColor: type.color }} onClick={() => handleAddScheduleFromType(type)} />
            <span className="mass-type-name">{type.name}</span>
            <button className="mass-type-delete" onClick={() => handleDeleteMassType(type.mass_type_id)}> </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MassTypesSection;