import { useState, useEffect, useCallback } from 'react';
import { scheduleCoordinator } from '../../services/scheduleCoordinator.js';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import './Home.css';

function Home() {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [_parishes, setParishes] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all', 'am', 'pm'
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const navigate = useNavigate();
  
  // Fetch parishes and schedules on mount
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const parishData = await scheduleCoordinator.getAllParishes();
      setParishes(parishData);

      // Get day of week (convert Sunday from 0 to 7 for database)
      const dayOfWeek = selectedDate.day() === 0 ? 7 : selectedDate.day();
      console.log('Loading data for date:', selectedDate.format('YYYY-MM-DD'), 'Day of week:', dayOfWeek);

      // Get schedules for all parishes on selected day
      const allSchedules = [];
      for (const parish of parishData) {
        const parishSchedules = await scheduleCoordinator.getSchedulesForDay(
          parish.parish_id,
          dayOfWeek
        );
        
        console.log(`Parish ${parish.name} schedules:`, parishSchedules);
        
        // Add parish info to each schedule
        const schedulesWithParish = parishSchedules.map(schedule => ({
          ...schedule,
          parish_name: parish.name,
          parish_location_url: parish.location_url
        }));
        
        allSchedules.push(...schedulesWithParish);
      }

      console.log('Total schedules found:', allSchedules.length);

      // Sort by start_time
      allSchedules.sort((a, b) => {
        const timeA = a.start_time || a.time || '00:00';
        const timeB = b.start_time || b.time || '00:00';
        return timeA.localeCompare(timeB);
      });

      setSchedules(allSchedules);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter schedules based on time 
  const getFilteredSchedules = () => {
    if (filter === 'all') return schedules;
    
    return schedules.filter(schedule => {
      const time = schedule.start_time || schedule.time || '00:00';
      const hour = parseInt(time.split(':')[0]);
      
      if (filter === 'am') return hour < 12;
      if (filter === 'pm') return hour >= 12;
      return true;
    });
  };

  // Get current week dates 
  const getWeekDates = () => {
    // Get the current week's Sunday (start of week)
    const startOfWeek = selectedDate.startOf('week');
    return Array.from({ length: 7 }, (_, i) => startOfWeek.add(i, 'day'));
  };

  // Get all dates for current month
  const getMonthDates = () => {
    const startOfMonth = selectedDate.startOf('month');
    const endOfMonth = selectedDate.endOf('month');
    const dates = [];
    
    for (let date = startOfMonth; date.isBefore(endOfMonth) || date.isSame(endOfMonth, 'day'); date = date.add(1, 'day')) {
      dates.push(date);
    }
    
    return dates;
  };

   const navigateWeek = (direction) => {
    if (direction === 'next') {
      const newDate = selectedDate.add(6, 'day');
      setSelectedDate(newDate);
    } else {
      const newDate = selectedDate.subtract(7, 'day');
      setSelectedDate(newDate);
    }
  };

  const navigateMonth = (direction) => {
    const newDate = selectedDate.add(direction === 'next' ? 1 : -1, 'month');
    setSelectedDate(newDate);
  };

  // Handle swipe gestures 
  const handleTouchStart = (e) => {
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (touchStart - touchEnd > 75) {
      // Swipe left - next day
      setSelectedDate(selectedDate.add(1, 'day'));
    }

    if (touchStart - touchEnd < -75) {
      // Swipe right - previous day
      setSelectedDate(selectedDate.subtract(1, 'day'));
    }
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  return (
    <div 
      className="home-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <header className="header">
        <div className="logo">
          <img src="/logo.png" alt="TimeForMass" className="logo-image" />
          <span className="logo-text">TimeForMass</span>
        </div>
        <button 
          className={`menu-button ${menuOpen ? 'open' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </header>

      {/* Menu dropdown */}
        {menuOpen && (
        <div className="menu-dropdown">
            <button 
            className="menu-item"
            onClick={() => {
                setMenuOpen(false);
                navigate('/login');
            }}
            >
            Admin Login
            </button>
        </div>
        )}
      {/* Hero Section */}
      <section className="hero">
        <img src="/hero-image.png" alt="Eucharist" className="hero-image" />
        <div className="hero-overlay">
          <blockquote className="hero-quote">
            "The Mass is the moment when heaven and earth are united"
            <cite>- St. Francis of Assisi</cite>
          </blockquote>
        </div>
      </section>

      {/* Calendar Section */}
      <section className="calendar-section">
        <div className="calendar-header">
          <button 
            className="nav-arrow"
            onClick={() => showFullCalendar ? navigateMonth('prev') : navigateWeek('prev')}
          >
            ‹
          </button>
          <button 
            className="calendar-title-button"
            onClick={() => setShowFullCalendar(true)}
          >
            <h2 className="calendar-title">
              {selectedDate.format('MMMM YYYY')}
            </h2>
          </button>
          <button 
            className="nav-arrow"
            onClick={() => showFullCalendar ? navigateMonth('next') : navigateWeek('next')}
          >
            ›
          </button>
        </div>

        {!showFullCalendar ? (
          <div className="week-view">
            {getWeekDates().map((date, index) => (
              <button
                key={index}
                className={`day-button ${date.isSame(selectedDate, 'day') ? 'active' : ''} ${date.isSame(dayjs(), 'day') ? 'today' : ''}`}
                onClick={() => setSelectedDate(date)}
              >
                <span className="day-name">{date.format('ddd')}</span>
                <span className="day-number">{date.format('DD')}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="month-view">
            <button 
              className="close-calendar"
              onClick={() => setShowFullCalendar(false)}
            >
              ✕
            </button>
            <div className="month-grid">
              <div className="weekday-headers">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="weekday-header">{day}</div>
                ))}
              </div>
              <div className="month-dates">
                {getMonthDates().map((date, index) => (
                  <button
                    key={index}
                    className={`month-day ${date.isSame(selectedDate, 'day') ? 'active' : ''} ${date.isSame(dayjs(), 'day') ? 'today' : ''}`}
                    onClick={() => {
                      setSelectedDate(date);
                      setShowFullCalendar(false);
                    }}
                  >
                    {date.format('D')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Time Filter */}
        <div className="time-filter">
          <button
            className={`filter-button ${filter === 'all' ? 'active' : ''}`}
            onClick={(e) => {
                e.stopPropagation();
                setFilter('all');
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            All
          </button>
          <button
            className={`filter-button ${filter === 'am' ? 'active' : ''}`}
            onClick={(e) => {
                e.stopPropagation();
                setFilter('am');
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            AM
          </button>
          <button
            className={`filter-button ${filter === 'pm' ? 'active' : ''}`}
            onClick={(e) => {
                e.stopPropagation();
                setFilter('pm');
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
        >
            PM
        </button>
        </div>
      </section>

      {/* Schedules List */}
      <section className="schedules-section">
        {loading ? (
          <div className="loading">Loading schedules...</div>
        ) : getFilteredSchedules().length === 0 ? (
          <div className="no-schedules">No masses scheduled for this day.</div>
        ) : (
          getFilteredSchedules().map((schedule, index) => (
            <div key={index} className="schedule-card">
              <div className="schedule-time">
                {formatTime(schedule.start_time || schedule.time)} - {formatTime(schedule.end_time || schedule.time)}
              </div>
              <h3 className="schedule-parish">{schedule.parish_name}</h3>
              <p className="schedule-details">
                {schedule.language && `${schedule.language} Mass`}
                {schedule.type && `, ${schedule.type}`}
                {schedule.notes && `, ${schedule.notes}`}
              </p>
              {schedule.parish_location_url && (
                <a
                  href={schedule.parish_location_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="direction-button"
                >
                  <span className="direction-icon">📍</span>
                  Direction
                </a>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

export default Home;