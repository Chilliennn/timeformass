import { useNavigate } from "react-router-dom";
import { useAdminDashboard } from "../../hooks/useAdminDashboard.js";
import { supabase } from "../../lib/supabaseClient.js";

import AdminHeader from "../../components/Admin/AdminHeader.jsx";
import ScheduleGrid from "../../components/Admin/ScheduleGrid.jsx";
import CalendarWidget from "../../components/Admin/CalendarWidget.jsx";
import SyncSection from "../../components/Admin/SyncSection.jsx";
import MassTypesSection from "../../components/Admin/MassTypesSection.jsx";

import "./AdminDashboard.css";

function AdminDashboard() {
  const navigate = useNavigate();
  const state = useAdminDashboard(navigate);

  const _handleLogout = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem("admin");
    localStorage.removeItem("admin");
    navigate("/");
  };

  const renderScheduleBlock = (schedule, alignment = { left: "0%", width: "100%" }) => {
    const isVerySmall = false;
    const isActive = state.activeScheduleId === schedule.template_schedule_id;
    const massTypeName = schedule.mass_types?.name || "";
    const shortName = massTypeName.substring(0, 3).toUpperCase();
    const startMinutes = state.timeStringToMinutesFromStart(schedule.start_time);
    const durationMinutes = state.timeStringToMinutesFromStart(schedule.end_time) - startMinutes;
    return (
      <div
        key={schedule.template_schedule_id}
        data-id={schedule.template_schedule_id}
        className={`schedule-block ${isActive ? "active" : ""}`} 
        style={{
          top: `${state.minutesToPixels(startMinutes)}px`,
          height: `${state.minutesToPixels(durationMinutes)}px`,
          backgroundColor: schedule.mass_types?.color || "#2C3E91",
          left: alignment.left,
          width: `calc(${alignment.width} - 4px)`,
        }}
        onClick={() => state.setViewSchedule(schedule)}
      >
        <div className="schedule-block-content">
          <div className="schedule-block-header">
            <span className={`schedule-block-title ${isVerySmall ? "compact" : ""}`}>
              <span className="mass-title-full">{massTypeName}</span>
              <span className="mass-title-short">{shortName}</span>
            </span>
            <div className="schedule-actions" onClick={(e) => e.stopPropagation()}>
              <button className="schedule-delete" onClick={(e) => { e.stopPropagation(); state.requestDeleteSchedule(schedule); }}>×</button>
            </div>
          </div>
          <div className="schedule-block-time">
            <span className="time-text">{schedule.start_time.substring(0, 5)} - {schedule.end_time.substring(0, 5)}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderDraftBlock = (schedule, alignment = { left: "0%", width: "100%" }) => {
    const massTypeName = schedule.mass_types?.name || "Scraped Draft";
    const shortName = massTypeName.substring(0, 3).toUpperCase();
    const startMinutes = state.timeStringToMinutesFromStart(schedule.start_time);
    const durationMinutes = state.timeStringToMinutesFromStart(schedule.end_time) - startMinutes;
    return (
      <div
        key={`draft-${schedule.template_schedule_id}`}
        data-id={`draft-${schedule.template_schedule_id}`}
        className="schedule-block draft-schedule-block"
        style={{
          top: `${state.minutesToPixels(startMinutes)}px`,
          height: `${state.minutesToPixels(durationMinutes)}px`,
          backgroundColor: "rgba(107, 163, 232, 0.14)",
          border: "2px dashed rgba(44, 62, 145, 0.55)",
          color: "#2c3e91",
          left: alignment.left,
          width: `calc(${alignment.width} - 4px)`,
          cursor: "pointer",
        }}
        onClick={() => state.setViewSchedule(schedule)}
      >
        <div className="schedule-block-content" style={{ padding: "0.45rem 0.5rem" }}>
          <div className="schedule-block-header">
            <span className="schedule-block-title">
              <span className="mass-title-full">{massTypeName}</span>
              <span className="mass-title-short">{shortName}</span>
            </span>
            <button className="schedule-delete" onClick={(e) => { e.stopPropagation(); state.requestDeleteSchedule(schedule); }}>×</button>
          </div>
          <div className="schedule-block-time">
            <span className="time-text">{schedule.start_time.substring(0, 5)} - {schedule.end_time.substring(0, 5)}</span>
          </div>
        </div>
      </div>
    );
  };

  if (!state.admin || !state.parish) return <div className="loading-admin">Loading...</div>;

  return (
    <div className="admin-dashboard">
      <AdminHeader
        admin={state.admin}
        parish={state.parish}
        showProfileDropdown={state.showProfileDropdown}
        setShowProfileDropdown={state.setShowProfileDropdown}
        onLogout={_handleLogout}
      />
      <div className="admin-content">
        {state.admin.admin_id === 1 && state.parishesList.length > 0 && (
          <div className="parish-super-selector" style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", background: "rgba(44,62,145,0.06)", padding: "0.75rem 1rem", borderRadius: "8px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#2c3e91", textTransform: "uppercase", letterSpacing: "0.03em" }}>Parish View Display Filter:</span>
            <select 
              value={state.selectedParishId} 
              onChange={(e) => state.setSelectedParishId(e.target.value)}
              style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid rgba(44,62,145,0.25)", fontSize: "0.9rem", color: "#2c3e91", fontWeight: 500, outline: "none", cursor: "pointer" }}
            >
              <option value="ALL">All Parishes (Aggregate View)</option>
              {state.parishesList.map(p => <option key={p.parish_id} value={p.parish_id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="template-controls">
          <div className="template-selector-wrapper">
            <select
              className="template-selector"
              value={state.selectedTemplate?.template_id || ""}
              onChange={(e) => {
                const template = state.templates.find((t) => t.template_id === parseInt(e.target.value));
                state.setSelectedTemplate(template);
              }}
              disabled={state.selectedParishId === "ALL"}
            >
              {state.selectedParishId === "ALL" ? (
                <option value="">Automated Timeline Allocation</option>
              ) : (
                state.templates.map((t) => <option key={t.template_id} value={t.template_id}>{t.name}</option>)
              )}
            </select>
          </div>
          <button className="btn-add-template" onClick={() => state.setShowAddTemplate(true)} disabled={state.selectedParishId === "ALL"}>+ Add new template</button>
          {state.saving && <span className="save-indicator">Saving...</span>}
          {state.showSavedMessage && <span className="saved-message">✓ Changes saved</span>}
        </div>
        <div className="schedule-calendar-wrapper">
          <ScheduleGrid
            currentWeek={state.currentWeek}
            setCurrentWeek={state.setCurrentWeek}
            getWeekDates={state.getWeekDates}
            isDragging={state.isDragging}
            hoursLabels={state.hoursLabels}
            formatHourLabel={state.formatHourLabel}
            formatDateForDb={state.formatDateForDb}
            schedules={state.schedules}
            draftSchedules={state.draftSchedules}
            placingMassType={state.placingMassType}
            handleColumnClick={state.handleColumnClick}
            columnHeightPx={state.columnHeightPx}
            DAY_START_HOUR={state.DAY_START_HOUR}
            minutesToPixels={state.minutesToPixels}
            detectOverlapsAndGroup={state.detectOverlapsAndGroup}
            renderDraftBlock={renderDraftBlock}
            renderScheduleBlock={renderScheduleBlock}
          />
          <div className="admin-sidebar">
            <CalendarWidget
              currentWeek={state.currentWeek}
              setCurrentWeek={state.setCurrentWeek}
              getWeekDates={state.getWeekDates}
            />
            <SyncSection
              admin={state.admin}
              scrapingTarget={state.scrapingTarget}
              handleTriggerScraper={state.handleTriggerScraper}
              draftSchedules={state.draftSchedules}
              handleApproveAllDrafts={state.handleApproveAllDrafts}
              setShowClearDraftsConfirm={state.setShowClearDraftsConfirm}
            />
            <MassTypesSection
              massTypes={state.massTypes}
              handleAddScheduleFromType={state.handleAddScheduleFromType}
              handleDeleteMassType={state.handleDeleteMassType}
              setShowAddMassType={state.setShowAddMassType}
            />
          </div>
        </div>
        {state.showAddMassType && (
          <div className="modal-overlay" onClick={() => state.setShowAddMassType(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Add Mass Type</h3>
              <input type="text" placeholder="Mass Type Name" value={state.newMassTypeName} onChange={(e) => state.setNewMassTypeName(e.target.value)} className="modal-input" />
              <div className="modal-actions">
                <button className="btn-cancel" onClick={() => state.setShowAddMassType(false)}>Cancel</button>
                <button className="btn-primary" onClick={state.handleAddMassType}>Add</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
export default AdminDashboard;