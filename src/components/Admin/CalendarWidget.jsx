function CalendarWidget({ currentWeek, setCurrentWeek, getWeekDates }) {
  return (
    <div className="calendar-widget">
      <div className="calendar-widget-header">
        <button onClick={() => { const d = new Date(currentWeek[3]); d.setMonth(d.getMonth() - 1); setCurrentWeek(getWeekDates(d)); }}> </button>
        <span>{new Date(currentWeek[3]).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
        <button onClick={() => { const d = new Date(currentWeek[3]); d.setMonth(d.getMonth() + 1); setCurrentWeek(getWeekDates(d)); }}> </button>
      </div>
      <div className="calendar-widget-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => <div key={i} className="calendar-weekday-header">{day}</div>)}
        {(() => {
          const mid = currentWeek[3];
          const y = mid.getFullYear();
          const m = mid.getMonth();
          const first = new Date(y, m, 1);
          const startDay = first.getDay();
          const last = new Date(y, m + 1, 0);
          const totalDays = last.getDate();
          const prevLast = new Date(y, m, 0).getDate();
          const cells = [];
          const today = new Date();
          for (let i = startDay - 1; i >= 0; i--) {
            cells.push(<div key={`prev-${prevLast - i}`} className="calendar-day calendar-day-other-month">{prevLast - i}</div>);
          }
          for (let d = 1; d <= totalDays; d++) {
            const dt = new Date(y, m, d);
            const isToday = dt.toDateString() === today.toDateString();
            const isWk = currentWeek.some((w) => w.toDateString() === dt.toDateString());
            cells.push(<button key={`curr-${d}`} className={`calendar-day ${isToday ? "calendar-day-today" : ""} ${isWk ? "active" : ""}`} onClick={() => setCurrentWeek(getWeekDates(dt))}>{d}</button>);
          }
          const totalCells = Math.ceil((startDay + totalDays) / 7) * 7;
          const rem = totalCells - cells.length;
          for (let d = 1; d <= rem; d++) {
            cells.push(<div key={`next-${d}`} className="calendar-day calendar-day-other-month">{d}</div>);
          }
          return cells;
        })()}
      </div>
    </div>
  );
}

export default CalendarWidget;