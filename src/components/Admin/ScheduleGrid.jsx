function ScheduleGrid({
  currentWeek,
  setCurrentWeek,
  getWeekDates,
  isDragging,
  hoursLabels,
  formatHourLabel,
  formatDateForDb,
  schedules,
  draftSchedules,
  placingMassType,
  handleColumnClick,
  columnHeightPx,
  DAY_START_HOUR,
  minutesToPixels,
  detectOverlapsAndGroup,
  renderDraftBlock,
  renderScheduleBlock
}) {
  return (
    <div className="schedule-grid-container">
      <div className="week-navigation">
        <button onClick={() => setCurrentWeek(getWeekDates(new Date(currentWeek[0].getTime() - 7 * 24 * 60 * 60 * 1000)))}>‹</button>
        <span className="week-label">{currentWeek[0].toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {currentWeek[6].toLocaleDateString("en-US", { month: "long", day: "numeric" })}</span>
        <button onClick={() => setCurrentWeek(getWeekDates(new Date(currentWeek[0].getTime() + 7 * 24 * 60 * 60 * 1000)))}>›</button>
      </div>
      <div className="schedule-grid">
        <div className={`schedule-grid-scrollable ${isDragging ? "dragging" : ""}`}>
          <div className="schedule-grid-header">
            <div className="time-axis-header">Week</div>
            {currentWeek.map((date, i) => (
              <div key={i} className="day-header">
                <div className="day-number">{date.getDate()}</div>
                <div className="day-name">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]}</div>
              </div>
            ))}
          </div>
          <div className="schedule-grid-content">
            <div className="time-axis">
              {hoursLabels.map((hour) => <div key={hour} className="time-axis-slot">{formatHourLabel(hour)}</div>)}
            </div>
            {currentWeek.map((date, dayIndex) => {
              const dbDay = date.getDay() === 0 ? 7 : date.getDay();
              const columnDbDateString = formatDateForDb(date);
              
              const daySchedules = schedules.filter((s) => {
                return s.day_of_week === dbDay && (!s.date || s.date === columnDbDateString);
              });
              
              const dayDraftSchedules = draftSchedules.filter((s) => {
                return s.day_of_week === dbDay && (!s.date || s.date === columnDbDateString);
              });
              
              const dayItems = [...daySchedules, ...dayDraftSchedules];
              const alignmentMap = detectOverlapsAndGroup(dayItems);
              return (
                <div key={dayIndex} className="day-column">
                  <div className={`day-column-body ${placingMassType ? "placing-mode" : ""}`} style={{ height: `${columnHeightPx}px` }} onClick={(event) => handleColumnClick(event, dbDay)}>
                    {hoursLabels.map((hour) => (
                      <span key={`${dayIndex}-${hour}`} className="hour-guide" style={{ top: `${minutesToPixels((hour - DAY_START_HOUR) * 60)}px` }} />
                    ))}
                    {dayItems.map((s) => {
                      const alignment = alignmentMap.get(s.template_schedule_id) || { left: '0%', width: '100%' };
                      return s.is_scraped_draft ? renderDraftBlock(s, alignment) : renderScheduleBlock(s, alignment);
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScheduleGrid;