import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import { massTypeRepository } from "../../repositories/massTypeRepository.js";
import { templateRepository } from "../../repositories/templateRepository.js";
import "./AdminDashboard.css";

function AdminDashboard() {
  const [admin, setAdmin] = useState(null);
  const [parish, setParish] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [massTypes, setMassTypes] = useState([]);
  const [scrapingTarget, setScrapingTarget] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(getWeekDates(new Date()));
  const [showAddMassType, setShowAddMassType] = useState(false);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newMassTypeName, setNewMassTypeName] = useState("");
  const [newMassTypeColor, setNewMassTypeColor] = useState("#2C3E91");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [activeScheduleId, setActiveScheduleId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showSavedMessage, setShowSavedMessage] = useState(false);
  const [placingMassType, setPlacingMassType] = useState(null);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [editTemplateName, setEditTemplateName] = useState("");
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [resizingSchedule, setResizingSchedule] = useState(null);
  const [resizeDirection, setResizeDirection] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedSchedule, setDraggedSchedule] = useState(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const saveTimeoutRef = useRef(null);
  const savedMessageTimeoutRef = useRef(null);
  const pointerDownRef = useRef(null);
  const pendingDragRef = useRef(false);
  const touchLongPressTimer = useRef(null);
  const navigate = useNavigate();
  const DAY_START_HOUR = 5;
  const resizeContextRef = useRef({ element: null });
  const DAY_END_HOUR = 22;
  const HOUR_BLOCK_HEIGHT = 48;
  const TOTAL_DAY_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const MINUTE_STEP = 15;
  const DEFAULT_DURATION_MINUTES = 60;
  const hoursLabels = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR },
    (_, idx) => DAY_START_HOUR + idx
  );
  const timeStringToMinutesFromStart = (timeStr) => {
    if (!timeStr) return 0;
    const [hourStr, minuteStr] = timeStr.split(":");
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    return (hour - DAY_START_HOUR) * 60 + minute;
  };

  const minutesFromStartToTimeString = (minutes) => {
    const absoluteMinutes = DAY_START_HOUR * 60 + minutes;
    const hour = Math.floor(absoluteMinutes / 60);
    const minute = absoluteMinutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}:00`;
  };

  const formatHourLabel = (hour) => {
    const display = hour % 12 === 0 ? 12 : hour % 12;
    const suffix = hour >= 12 ? "PM" : "AM";
    return `${display}:00 ${suffix}`;
  };

  const minutesToPixels = (minutes) => (minutes / 60) * HOUR_BLOCK_HEIGHT;
  const columnHeightPx = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_BLOCK_HEIGHT;

  function getWeekDates(date) {
    const day = date.getDay();
    const diff = date.getDate() - day;
    const sunday = new Date(date.setDate(diff));

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d;
    });
  }

const getClientFromEvent = (e) => {
  if (!e) return { clientX: 0, clientY: 0 };
  if (e.touches && e.touches[0]) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
  return { clientX: e.clientX, clientY: e.clientY };
};

const handlePointerDown = (e, schedule) => {
  const { clientX, clientY } = getClientFromEvent(e);
  pointerDownRef.current = { x: clientX, y: clientY, time: Date.now(), scheduleId: schedule.template_schedule_id };

  const clickedControl = e.target && e.target.closest && e.target.closest('button, .schedule-resize-handle, .schedule-delete, .schedule-edit');
  pointerDownRef.current.clickedControl = !!clickedControl;

  // For touch: start long press timer for dragging.
  if (e.type === "touchstart") {
    if (touchLongPressTimer.current) clearTimeout(touchLongPressTimer.current);
    touchLongPressTimer.current = setTimeout(() => {
      handleDragScheduleStart(e, schedule);
    }, 500);
  } else {
    // For mouse: set pendingDragRef to true if not clicking a control.
    if (!clickedControl) {
      pendingDragRef.current = true;
    }
  }
};

  const handlePointerMove = (e, schedule) => {
    if (!pointerDownRef.current) return;
    const { clientX, clientY } = getClientFromEvent(e);
    const dx = clientX - pointerDownRef.current.x;
    const dy = clientY - pointerDownRef.current.y;
    const dist = Math.hypot(dx, dy);

    // if mouse moved enough, begin drag
    if (pendingDragRef.current && dist > 6 && e.type.indexOf("mouse") !== -1) {
      setActiveScheduleId(null);
      pendingDragRef.current = false;
      handleDragScheduleStart(e, schedule);
    }
    // If already dragging, do nothing
  };

  const handlePointerUp = (e, schedule) => {
  // Clear any long-press timer
  if (touchLongPressTimer.current) {
    clearTimeout(touchLongPressTimer.current);
    touchLongPressTimer.current = null;
  }

  // If dragging is ongoing, finish drag
  if (isDragging && draggedSchedule) {
    handleDragScheduleEnd();
    pointerDownRef.current = null;
    pendingDragRef.current = false;
    return;
  }

  // If user clicked a control (delete/edit), don't toggle icons
  const pd = pointerDownRef.current;
  if (!pd) return;

  const { clientX, clientY } = getClientFromEvent(e);
  const dx = Math.abs(pd.x - clientX);
  const dy = Math.abs(pd.y - clientY);
  const movedSmall = dx <= 6 && dy <= 6;
  const elapsedShort = Date.now() - pd.time < 500;

  // Toggle icons only when it's a short tap/click and not a control press
  if (movedSmall && elapsedShort && !pd.clickedControl) {
    setActiveScheduleId((prev) =>
      prev === schedule.template_schedule_id ? null : schedule.template_schedule_id
    );
  }

  pointerDownRef.current = null;
  pendingDragRef.current = false;
};

  // Load admin data
  useEffect(() => {
    async function loadAdminData() {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;

      if (!session) {
        navigate("/login");
        return;
      }

      const email = session.user.email;
      const { data: adminRow } = await supabase
        .from("admin")
        .select("admin_id, name, email, parish_id")
        .eq("email", email)
        .maybeSingle();

      if (!adminRow) {
        navigate("/login");
        return;
      }

      setAdmin(adminRow);

      // Load parish info
      const { data: parishRow } = await supabase
        .from("parish")
        .select("*")
        .eq("parish_id", adminRow.parish_id)
        .single();

      setParish(parishRow);

      // Load mass types for this admin
      const types = await massTypeRepository.findByAdminId(adminRow.admin_id);
      setMassTypes(types);

      // Load templates
      const templatesList = await templateRepository.findByAdminId(
        adminRow.admin_id
      );

      if (templatesList.length === 0) {
        // Create default template if none exists
        const defaultTemplate = await templateRepository.insert({
          admin_id: adminRow.admin_id,
          name: "Template 1",
          is_default: true,
        });
        setTemplates([defaultTemplate]);
        setSelectedTemplate(defaultTemplate);
      } else {
        setTemplates(templatesList);
        const defaultTemp =
          templatesList.find((t) => t.is_default) || templatesList[0];
        setSelectedTemplate(defaultTemp);
      }
    }

    loadAdminData();
  }, [navigate]);

  useEffect(() => {
    const handleDocClick = (e) => {
      if (!e.target.closest || !e.target.closest(".schedule-block")) {
        setActiveScheduleId(null);
      }
    };
    const handleEsc = (e) => { if (e.key === "Escape") setActiveScheduleId(null); };

    document.addEventListener("click", handleDocClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("click", handleDocClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);

  const handleTriggerScraper = async (triggerId) => {
    if (!selectedTemplate || !admin) return;
    setScrapingTarget(triggerId);
    try {
      const response = await fetch('http://localhost:5000/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: admin.admin_id,
          triggerId: triggerId,
          templateId: selectedTemplate.template_id
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Server connection error');
      alert(`Synchronization finished: ${result.message}`);

      // Automatically trigger a refresh of the template schedules layout view
      const scheduleData = await templateRepository.getTemplateSchedules(selectedTemplate.template_id);
      setSchedules(scheduleData);
    } catch (err) {
      console.error("Scraper execution fail:", err);
      alert(`Scraper execution failed: ${err.message}`);
    } finally {
      setScrapingTarget(null);
    }
  };

  // Load schedules for selected template
  useEffect(() => {
    async function loadSchedules() {
      if (!selectedTemplate) return;

      const scheduleData = await templateRepository.getTemplateSchedules(
        selectedTemplate.template_id
      );
      setSchedules(scheduleData);
    }

    loadSchedules();
  }, [selectedTemplate]);
  
  const autoSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        console.log("Auto-saved schedules");

        // Show saved message
        setShowSavedMessage(true);

        // Hide message after 2 seconds
        if (savedMessageTimeoutRef.current) {
          clearTimeout(savedMessageTimeoutRef.current);
        }
        savedMessageTimeoutRef.current = setTimeout(() => {
          setShowSavedMessage(false);
        }, 2000);
      } catch (error) {
        console.error("Auto-save error:", error);
      } finally {
        setSaving(false);
      }
    }, 1000);
  }, []);

  // Add mass type
  const handleAddMassType = async () => {
    if (!newMassTypeName.trim()) return;

    try {
      const newType = await massTypeRepository.insert({
        admin_id: admin.admin_id,
        name: newMassTypeName,
        color: newMassTypeColor,
      });

      setMassTypes([...massTypes, newType]);
      setNewMassTypeName("");
      setNewMassTypeColor("#2C3E91");
      setShowAddMassType(false);
    } catch (error) {
      console.error("Failed to add mass type:", error);
    }
  };

  // Delete mass type
  const handleDeleteMassType = async (massTypeId) => {
    if (
      !confirm(
        "Delete this mass type? All associated schedules will be removed."
      )
    )
      return;

    try {
      await massTypeRepository.delete(massTypeId);
      setMassTypes(massTypes.filter((t) => t.mass_type_id !== massTypeId));
      setSchedules(schedules.filter((s) => s.mass_type_id !== massTypeId));
    } catch (error) {
      console.error("Failed to delete mass type:", error);
    }
  };

  // Add schedule from mass type
  const handleAddScheduleFromType = async (massType) => {
    setPlacingMassType(massType); // Enter placing mode
    document.body.style.cursor = "crosshair"; // Change cursor
  };

  // Cancel placing mode on Escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && placingMassType) {
        setPlacingMassType(null);
        document.body.style.cursor = "default";
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [placingMassType]);

  // Delete schedule
  const handleDeleteSchedule = async (scheduleId) => {
    try {
      await templateRepository.deleteSchedule(scheduleId);
      const updatedSchedules = schedules.filter(
        (s) => s.template_schedule_id !== scheduleId
      );
      setSchedules(updatedSchedules);
      autoSave(updatedSchedules);
    } catch (error) {
      console.error("Failed to delete schedule:", error);
    }
  };

  const handleDragScheduleStart = (e, schedule) => {
    if (resizingSchedule || placingMassType) return;

    const client = getClientFromEvent(e);
    const el =
      e?.currentTarget ||
      document.querySelector(
        `.schedule-block[data-id="${schedule.template_schedule_id}"]`
      );
    if (!el) return;

    const rect = el.getBoundingClientRect();
    setDragOffset({
      x: client.clientX - rect.left,
      y: client.clientY - rect.top,
    });
    setDraggedSchedule(schedule);
    setIsDragging(true);
    el.style.opacity = "0.5";
  };

  const handleDragScheduleMove = useCallback(
    (e) => {
      if (!isDragging || !draggedSchedule) return;

      const client = getClientFromEvent(e);

      // Find the day column under cursor using client coordinates
      const columns = document.querySelectorAll(".day-column-body");
      let targetColumn = null;
      let targetDayIndex = -1;

      for (let i = 0; i < columns.length; i++) {
        const rect = columns[i].getBoundingClientRect();
        if (
          client.clientX >= rect.left &&
          client.clientX <= rect.right &&
          client.clientY >= rect.top &&
          client.clientY <= rect.bottom
        ) {
          targetColumn = columns[i];
          targetDayIndex = i;
          break;
        }
      }

      if (targetColumn && targetDayIndex >= 0) {
        const rect = targetColumn.getBoundingClientRect();
        const minuteHeight = rect.height / TOTAL_DAY_MINUTES;
        const relativeY = client.clientY - rect.top - dragOffset.y;
        const rawMinutes = relativeY / minuteHeight;
        const snappedMinutes =
          Math.round(rawMinutes / MINUTE_STEP) * MINUTE_STEP;

        const startMinutes = Math.max(
          0,
          Math.min(TOTAL_DAY_MINUTES - MINUTE_STEP, snappedMinutes)
        );
        const duration =
          timeStringToMinutesFromStart(draggedSchedule.end_time) -
          timeStringToMinutesFromStart(draggedSchedule.start_time);
        const endMinutes = Math.min(TOTAL_DAY_MINUTES, startMinutes + duration);

        const targetDay =
          currentWeek[targetDayIndex].getDay() === 0
            ? 7
            : currentWeek[targetDayIndex].getDay();

        setSchedules((prev) =>
          prev.map((s) =>
            s.template_schedule_id === draggedSchedule.template_schedule_id
              ? {
                  ...s,
                  day_of_week: targetDay,
                  start_time: minutesFromStartToTimeString(startMinutes),
                  end_time: minutesFromStartToTimeString(endMinutes),
                }
              : s
          )
        );
      }
    },
    [isDragging, draggedSchedule, TOTAL_DAY_MINUTES, dragOffset.y, currentWeek]
  );

  const handleDragScheduleEnd = useCallback(async () => {
    if (!draggedSchedule) return;

    // restore opacity of element if it exists
    const el = document.querySelector(
      `.schedule-block[data-id="${draggedSchedule.template_schedule_id}"]`
    );
    if (el) el.style.opacity = "1";

    const updatedSchedule = schedules.find(
      (s) => s.template_schedule_id === draggedSchedule.template_schedule_id
    );

    if (updatedSchedule) {
      try {
        await templateRepository.updateSchedule(
          updatedSchedule.template_schedule_id,
          {
            day_of_week: updatedSchedule.day_of_week,
            start_time: updatedSchedule.start_time,
            end_time: updatedSchedule.end_time,
          }
        );
        setShowSavedMessage(true);
        if (savedMessageTimeoutRef.current)
          clearTimeout(savedMessageTimeoutRef.current);
        savedMessageTimeoutRef.current = setTimeout(
          () => setShowSavedMessage(false),
          2000
        );
      } catch (error) {
        console.error("Failed to update schedule:", error);
      }
    }

    setIsDragging(false);
    setDraggedSchedule(null);
  }, [draggedSchedule, schedules]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleDragScheduleMove);
      window.addEventListener("mouseup", handleDragScheduleEnd);
      window.addEventListener("touchmove", handleDragScheduleMove, {
        passive: false,
      });
      window.addEventListener("touchend", handleDragScheduleEnd);
      return () => {
        window.removeEventListener("mousemove", handleDragScheduleMove);
        window.removeEventListener("mouseup", handleDragScheduleEnd);
        window.removeEventListener("touchmove", handleDragScheduleMove);
        window.removeEventListener("touchend", handleDragScheduleEnd);
      };
    }
  }, [isDragging, handleDragScheduleMove, handleDragScheduleEnd]);

  // Add template
  const handleAddTemplate = async () => {
    if (!newTemplateName.trim()) return;

    try {
      const newTemplate = await templateRepository.insert({
        admin_id: admin.admin_id,
        name: newTemplateName,
        is_default: false,
      });

      setTemplates([...templates, newTemplate]);
      setNewTemplateName("");
      setShowAddTemplate(false);
    } catch (error) {
      console.error("Failed to add template:", error);
    }
  };

  const handleRenameTemplate = async () => {
    if (!editTemplateName.trim() || !editingTemplate) return;

    try {
      await templateRepository.update(editingTemplate.template_id, {
        name: editTemplateName,
      });

      setTemplates(
        templates.map((t) =>
          t.template_id === editingTemplate.template_id
            ? { ...t, name: editTemplateName }
            : t
        )
      );

      if (selectedTemplate?.template_id === editingTemplate.template_id) {
        setSelectedTemplate({ ...selectedTemplate, name: editTemplateName });
      }

      setEditingTemplate(null);
      setEditTemplateName("");
    } catch (error) {
      console.error("Failed to rename template:", error);
    }
  };

  const handleResizeStart = (e, schedule, direction) => {
    e.stopPropagation();
    e.preventDefault();
    setResizingSchedule(schedule);
    setResizeDirection(direction);
    resizeContextRef.current = {
      element: e.currentTarget.closest(".day-column-body"),
    };
    document.body.style.cursor = "ns-resize";
  };

  const handleResizeMove = useCallback(
    (e) => {
      if (!resizingSchedule || !resizeDirection) return;
      const columnEl = resizeContextRef.current?.element;
      if (!columnEl) return;

      const rect = columnEl.getBoundingClientRect();
      const totalMinutes = TOTAL_DAY_MINUTES;
      const minuteHeight = columnEl.offsetHeight / totalMinutes;
      const rawMinutes =
        Math.max(0, Math.min(rect.height, e.clientY - rect.top)) / minuteHeight;
      const snappedMinutes = Math.round(rawMinutes / MINUTE_STEP) * MINUTE_STEP;

      if (resizeDirection === "top") {
        setSchedules((prev) =>
          prev.map((s) => {
            if (
              s.template_schedule_id !== resizingSchedule.template_schedule_id
            )
              return s;
            const currentEnd = timeStringToMinutesFromStart(s.end_time);
            const clamped = Math.max(
              0,
              Math.min(currentEnd - MINUTE_STEP, snappedMinutes)
            );
            if (clamped === timeStringToMinutesFromStart(s.start_time))
              return s;
            const updated = {
              ...s,
              start_time: minutesFromStartToTimeString(clamped),
            };
            setResizingSchedule(updated);
            return updated;
          })
        );
      } else {
        setSchedules((prev) =>
          prev.map((s) => {
            if (
              s.template_schedule_id !== resizingSchedule.template_schedule_id
            )
              return s;
            const currentStart = timeStringToMinutesFromStart(s.start_time);
            const clamped = Math.max(
              currentStart + MINUTE_STEP,
              Math.min(totalMinutes, snappedMinutes)
            );
            if (clamped === timeStringToMinutesFromStart(s.end_time)) return s;
            const updated = {
              ...s,
              end_time: minutesFromStartToTimeString(clamped),
            };
            setResizingSchedule(updated);
            return updated;
          })
        );
      }
    },
    [resizingSchedule, resizeDirection, TOTAL_DAY_MINUTES]
  );

  const handleResizeEnd = useCallback(async () => {
    if (!resizingSchedule) return;
    try {
      await templateRepository.updateSchedule(
        resizingSchedule.template_schedule_id,
        {
          start_time: resizingSchedule.start_time,
          end_time: resizingSchedule.end_time,
        }
      );
      setShowSavedMessage(true);
      if (savedMessageTimeoutRef.current)
        clearTimeout(savedMessageTimeoutRef.current);
      savedMessageTimeoutRef.current = setTimeout(
        () => setShowSavedMessage(false),
        2000
      );
    } catch (error) {
      console.error("Failed to update schedule:", error);
    } finally {
      setResizingSchedule(null);
      setResizeDirection(null);
      resizeContextRef.current = { element: null };
      document.body.style.cursor = "default";
    }
  }, [resizingSchedule]);

  // Add resize event listeners
  useEffect(() => {
    if (resizingSchedule) {
      window.addEventListener("mousemove", handleResizeMove);
      window.addEventListener("mouseup", handleResizeEnd);

      return () => {
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [resizingSchedule, handleResizeMove, handleResizeEnd]);

  // const handleScheduleClick = (e, schedule) => {
  //   if (placingMassType || resizingSchedule) return;

  //   e.stopPropagation();
  //   setEditingSchedule(schedule);
  //   setEditStartTime(schedule.start_time.substring(0, 5));
  //   setEditEndTime(schedule.end_time.substring(0, 5));
  //   setEditLanguage(schedule.language || "");
  //   setEditNotes(schedule.notes || "");
  // };

  const handleSaveScheduleEdit = async () => {
    if (!editingSchedule) return;

    try {
      await templateRepository.updateSchedule(
        editingSchedule.template_schedule_id,
        {
          start_time: `${editStartTime}:00`,
          end_time: `${editEndTime}:00`,
          language: editLanguage,
          notes: editNotes,
        }
      );

      const updatedSchedules = await templateRepository.getTemplateSchedules(
        selectedTemplate.template_id
      );
      setSchedules(updatedSchedules);

      setEditingSchedule(null);
      setShowSavedMessage(true);
      if (savedMessageTimeoutRef.current) {
        clearTimeout(savedMessageTimeoutRef.current);
      }
      savedMessageTimeoutRef.current = setTimeout(() => {
        setShowSavedMessage(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to update schedule:", error);
    }
  };

  const handleColumnClick = async (event, dayOfWeek) => {
    if (!placingMassType || !selectedTemplate) return;

    const columnBody = event.currentTarget;
    const rect = columnBody.getBoundingClientRect();
    const totalMinutes = TOTAL_DAY_MINUTES;
    const minuteHeight = rect.height / totalMinutes;

    let minutesFromStart =
      Math.round(
        Math.max(0, Math.min(rect.height, event.clientY - rect.top)) /
          minuteHeight /
          MINUTE_STEP
      ) * MINUTE_STEP;
    minutesFromStart = Math.max(
      0,
      Math.min(totalMinutes - MINUTE_STEP, minutesFromStart)
    );

    let endMinutes = minutesFromStart + DEFAULT_DURATION_MINUTES;
    if (endMinutes > totalMinutes) {
      endMinutes = totalMinutes;
      minutesFromStart = Math.max(0, endMinutes - DEFAULT_DURATION_MINUTES);
    }

    try {
      await templateRepository.insertSchedule({
        template_id: selectedTemplate.template_id,
        mass_type_id: placingMassType.mass_type_id,
        day_of_week: dayOfWeek,
        start_time: minutesFromStartToTimeString(minutesFromStart),
        end_time: minutesFromStartToTimeString(endMinutes),
        language: "",
        notes: "",
      });

      const updatedSchedules = await templateRepository.getTemplateSchedules(
        selectedTemplate.template_id
      );
      setSchedules(updatedSchedules);
      setShowSavedMessage(true);
      if (savedMessageTimeoutRef.current)
        clearTimeout(savedMessageTimeoutRef.current);
      savedMessageTimeoutRef.current = setTimeout(
        () => setShowSavedMessage(false),
        2000
      );
    } catch (error) {
      console.error("Failed to add schedule:", error);
    } finally {
      setPlacingMassType(null);
      document.body.style.cursor = "default";
    }
  };

  // Logout
  const _handleLogout = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem("admin");
    localStorage.removeItem("admin");
    navigate("/");
  };

  const renderScheduleBlock = (schedule) => {
    const startMinutes = timeStringToMinutesFromStart(schedule.start_time);
    const endMinutes = timeStringToMinutesFromStart(schedule.end_time);
    const durationMinutes = Math.max(MINUTE_STEP, endMinutes - startMinutes);
    const heightPx = minutesToPixels(durationMinutes);
    const isVerySmall = heightPx < 35;
    const isActive = activeScheduleId === schedule.template_schedule_id;
    const massTypeName = schedule.mass_types?.name || "";
    const shortName = massTypeName.substring(0, 3).toUpperCase();

    return (
      <div
        key={schedule.template_schedule_id}
        data-id={schedule.template_schedule_id}
        className={`schedule-block ${isActive ? "active" : ""}`} 
        style={{
          top: `${minutesToPixels(startMinutes)}px`,
          height: `${Math.max(28, heightPx - 3)}px`,
          backgroundColor: schedule.mass_types?.color || "#2C3E91",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        onMouseDown={(e) => handlePointerDown(e, schedule)}
        onMouseMove={(e) => handlePointerMove(e, schedule)}
        onMouseUp={(e) => handlePointerUp(e, schedule)}
        onTouchStart={(e) => handlePointerDown(e, schedule)}
        onTouchMove={(e) => {
          // if (isDragging) e.preventDefault();
          handlePointerMove(e, schedule);
        }}
        onTouchEnd={(e) => handlePointerUp(e, schedule)}
      >
        {/* resize handle top */}
        <div
          className="schedule-resize-handle schedule-resize-top"
          onMouseDown={(e) => handleResizeStart(e, schedule, "top")}
          onTouchStart={(e) => {
            e.stopPropagation();
            handleResizeStart(e, schedule, "top");
          }}
        />

        <div className="schedule-block-content">
          <div className="schedule-block-header">
            <span
              className={`schedule-block-title ${isVerySmall ? "compact" : ""}`}
            >
              <span className="mass-title-full">{massTypeName}</span>
              <span className="mass-title-short">{shortName}</span>
            </span>

            {/* actions container: delete on top, edit below */}
            <div
              className="schedule-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="schedule-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSchedule(schedule.template_schedule_id);
                  setActiveScheduleId(null);
                }}
                aria-label="Delete schedule"
                title="Delete"
              >
                🗑️
              </button>

              <button
                className="schedule-edit"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingSchedule(schedule);
                  setEditStartTime(schedule.start_time.substring(0, 5));
                  setEditEndTime(schedule.end_time.substring(0, 5));
                  setEditLanguage(schedule.language || "");
                  setEditNotes(schedule.notes || "");
                  setActiveScheduleId(null);
                }}
                aria-label="Edit schedule"
                title="Edit"
              >
                ✏️
              </button>
            </div>
          </div>

          <div
            className={`schedule-block-time ${isVerySmall ? "compact" : ""}`}
          >
            <span className="time-icon">🕐</span>
            <span className="time-text">
              {schedule.start_time.substring(0, 5)} -{" "}
              {schedule.end_time.substring(0, 5)}
            </span>
          </div>
        </div>

        {/* resize handle bottom */}
        <div
          className="schedule-resize-handle schedule-resize-bottom"
          onMouseDown={(e) => handleResizeStart(e, schedule, "bottom")}
          onTouchStart={(e) => {
            e.stopPropagation();
            handleResizeStart(e, schedule, "bottom");
          }}
        />
      </div>
    );
  };

  if (!admin || !parish) return <div className="loading-admin">Loading...</div>;

  return (
    <div className="admin-dashboard">
      {/* Header */}
      <header className="admin-header">
        <div className="admin-header-left">
          <div
            className="admin-logo"
            onClick={() => navigate("/")}
            style={{ cursor: "pointer" }}
          >
            <img src="/logo.png" alt="TimeForMass" className="logo-image" />
            <span className="logo-text">TimeForMass</span>
          </div>
          <h1 className="admin-page-title">Parish Schedule</h1>
        </div>

        <div className="admin-header-right">
          <div className="admin-profile-wrapper">
            <div
              className="admin-profile"
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            >
              <div className="admin-info">
                <div className="admin-name">{admin.name}</div>
                <div className="admin-parish">{parish.name}</div>
              </div>
              <button
                className="admin-dropdown-toggle"
                aria-label="Toggle menu"
              >
                {showProfileDropdown ? "▲" : "▼"}
              </button>
            </div>

            {/* dropdown menu */}
            <div
              className={`profile-dropdown ${
                showProfileDropdown ? "show" : ""
              }`}
            >
              <button
                className="dropdown-item"
                onClick={() => {
                  navigate("/");
                  setShowProfileDropdown(false);
                }}
              >
                View Mass Schedules
              </button>
              <button
                className="dropdown-item"
                onClick={() => {
                  setShowProfileDropdown(false); /* add logout logic here */
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="admin-content">
        {/* Template Selector */}
        <div className="template-controls">
          <div className="template-selector-wrapper">
            <select
              className="template-selector"
              value={selectedTemplate?.template_id || ""}
              onChange={(e) => {
                const template = templates.find(
                  (t) => t.template_id === parseInt(e.target.value)
                );
                setSelectedTemplate(template);
              }}
            >
              {templates.map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTemplate && (
              <button
                className="btn-rename-template"
                onClick={() => {
                  setEditingTemplate(selectedTemplate);
                  setEditTemplateName(selectedTemplate.name);
                }}
                title="Rename template"
              >
                ✏️
              </button>
            )}
          </div>

          <button
            className="btn-add-template"
            onClick={() => setShowAddTemplate(true)}
          >
            + Add new template
          </button>

          {saving && <span className="save-indicator">Saving...</span>}
          {showSavedMessage && (
            <span className="saved-message">✓ Changes saved</span>
          )}
        </div>

        {placingMassType && (
          <div className="placing-mode-banner">
            Placing: {placingMassType.name} — click a time slot or press ESC to
            cancel
          </div>
        )}

        <div className="schedule-calendar-wrapper">
          {/* Calendar Grid */}
          <div className="schedule-grid-container">
            {/* Week Navigation */}
            <div className="week-navigation">
              <button
                onClick={() =>
                  setCurrentWeek(
                    getWeekDates(
                      new Date(
                        currentWeek[0].getTime() - 7 * 24 * 60 * 60 * 1000
                      )
                    )
                  )
                }
              >
                ‹
              </button>
              <span className="week-label">
                {currentWeek[0].toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                })}{" "}
                -{" "}
                {currentWeek[6].toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <button
                onClick={() =>
                  setCurrentWeek(
                    getWeekDates(
                      new Date(
                        currentWeek[0].getTime() + 7 * 24 * 60 * 60 * 1000
                      )
                    )
                  )
                }
              >
                ›
              </button>
            </div>

            {/* Grid */}
            <div className="schedule-grid">
              <div
                className={`schedule-grid-scrollable ${
                  isDragging ? "dragging" : ""
                }`}
              >
                <div className="schedule-grid-header">
                  <div className="time-axis-header">Week</div>
                  {currentWeek.map((date, i) => (
                    <div key={i} className="day-header">
                      <div className="day-number">{date.getDate()}</div>
                      <div className="day-name">
                        {
                          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                            date.getDay()
                          ]
                        }
                      </div>
                    </div>
                  ))}
                </div>

                <div className="schedule-grid-content">
                  <div className="time-axis">
                    {hoursLabels.map((hour) => (
                      <div key={hour} className="time-axis-slot">
                        {formatHourLabel(hour)}
                      </div>
                    ))}
                  </div>

                  {currentWeek.map((date, dayIndex) => {
                    const dbDay = date.getDay() === 0 ? 7 : date.getDay();
                    const daySchedules = schedules.filter(
                      (s) => s.day_of_week === dbDay
                    );

                    return (
                      <div key={dayIndex} className="day-column">
                        <div
                          className={`day-column-body ${
                            placingMassType ? "placing-mode" : ""
                          }`}
                          style={{ height: `${columnHeightPx}px` }}
                          onClick={(event) => handleColumnClick(event, dbDay)}
                        >
                          {hoursLabels.map((hour) => (
                            <span
                              key={`${dayIndex}-${hour}`}
                              className="hour-guide"
                              style={{
                                top: `${minutesToPixels(
                                  (hour - DAY_START_HOUR) * 60
                                )}px`,
                              }}
                            />
                          ))}

                          {daySchedules.map(renderScheduleBlock)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar with updated mass types */}
          <div className="admin-sidebar">
            {/* Calendar component */}
            <div className="calendar-widget">
              <div className="calendar-widget-header">
                <button
                  onClick={() => {
                    const newDate = new Date(currentWeek[3]);
                    newDate.setMonth(newDate.getMonth() - 1);
                    setCurrentWeek(getWeekDates(newDate));
                  }}
                >
                  ‹
                </button>
                <span>
                  {new Date(currentWeek[3]).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <button
                  onClick={() => {
                    const newDate = new Date(currentWeek[3]);
                    newDate.setMonth(newDate.getMonth() + 1);
                    setCurrentWeek(getWeekDates(newDate));
                  }}
                >
                  ›
                </button>
              </div>
              <div className="calendar-widget-grid">
                {/* Weekday headers */}
                {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
                  <div key={i} className="calendar-weekday-header">
                    {day}
                  </div>
                ))}

                {/* Generate calendar days */}
                {(() => {
                  const middleOfWeek = currentWeek[3];
                  const year = middleOfWeek.getFullYear();
                  const month = middleOfWeek.getMonth();

                  // First day of the month
                  const firstDay = new Date(year, month, 1);
                  const startingDayOfWeek = firstDay.getDay();

                  // Last day of the month
                  const lastDay = new Date(year, month + 1, 0);
                  const daysInMonth = lastDay.getDate();

                  // Previous month's last day
                  const prevMonthLastDay = new Date(year, month, 0).getDate();

                  const days = [];

                  // Previous month padding (grayed out)
                  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
                    const dayNum = prevMonthLastDay - i;
                    days.push(
                      <div
                        key={`prev-${dayNum}`}
                        className="calendar-day calendar-day-other-month"
                      >
                        {dayNum}
                      </div>
                    );
                  }

                  // Current month days
                  const today = new Date();
                  for (let day = 1; day <= daysInMonth; day++) {
                    const date = new Date(year, month, day);
                    const isToday =
                      date.toDateString() === today.toDateString();
                    const isInCurrentWeek = currentWeek.some(
                      (d) => d.toDateString() === date.toDateString()
                    );

                    days.push(
                      <button
                        key={`current-${day}`}
                        className={`calendar-day ${
                          isToday ? "calendar-day-today" : ""
                        } ${isInCurrentWeek ? "active" : ""}`}
                        onClick={() => setCurrentWeek(getWeekDates(date))}
                      >
                        {day}
                      </button>
                    );
                  }

                  // Next month padding (grayed out)
                  const totalCells =
                    Math.ceil((startingDayOfWeek + daysInMonth) / 7) * 7;
                  const remainingCells = totalCells - days.length;
                  for (let day = 1; day <= remainingCells; day++) {
                    days.push(
                      <div
                        key={`next-${day}`}
                        className="calendar-day calendar-day-other-month"
                      >
                        {day}
                      </div>
                    );
                  }

                  return days;
                })()}
              </div>
            </div>
            {admin.admin_id === 1 && (
              <div className="mass-types-section" style={{ marginTop: '0.2rem', border: '2px solid rgba(44, 62, 145, 0.12)' }}>
                <div className="mass-types-header">
                  <h3 style={{ color: '#2c3e91' }}>⚡ Target Site Synchronizations</h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#666666', margin: '0.5rem 0 1rem 0', lineHeight: '1.4' }}>
                  Trigger independent web crawling background scripts to collect mass schedule listings directly into the staging engine dataset.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <button 
                    className="btn-add-template" 
                    style={{ backgroundColor: '#2c3e91', width: '100%', margin: 0 }}
                    disabled={scrapingTarget !== null}
                    onClick={() => handleTriggerScraper('st_michael_btn')}
                  >
                    {scrapingTarget === 'st_michael_btn' ? '⏳ Syncing St. Michael...' : 'Sync St. Michael Church'}
                  </button>
                  <button 
                    className="btn-add-template" 
                    style={{ backgroundColor: '#6ba368', width: '100%', margin: 0 }}
                    disabled={scrapingTarget !== null}
                    onClick={() => handleTriggerScraper('st_ignatius_btn')}
                  >
                    {scrapingTarget === 'st_ignatius_btn' ? '⏳ Syncing St. Ignatius...' : 'Sync St. Ignatius Church'}
                  </button>
                </div>
              </div>
            )}
            {/* Mass Types */}
            <div className="mass-types-section">
              <div className="mass-types-header">
                <h3>Mass Types</h3>
                <button
                  className="btn-icon"
                  onClick={() => setShowAddMassType(true)}
                >
                  +
                </button>
              </div>

              <div className="mass-types-list">
                {massTypes.map((type) => (
                  <div key={type.mass_type_id} className="mass-type-item">
                    <input type="checkbox" checked readOnly />
                    <div
                      className="mass-type-color"
                      style={{ backgroundColor: type.color }}
                      onClick={() => handleAddScheduleFromType(type)}
                    />
                    <span className="mass-type-name">{type.name}</span>
                    <button
                      className="mass-type-delete"
                      onClick={() => handleDeleteMassType(type.mass_type_id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Edit Schedule Modal */}
        {editingSchedule && (
          <div
            className="modal-overlay"
            onClick={() => setEditingSchedule(null)}
          >
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Edit Schedule</h3>

              <div className="form-group">
                <label className="form-label">Mass Type</label>
                <div className="form-value">
                  {editingSchedule.mass_types?.name}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Start Time</label>
                <input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  className="modal-input"
                  step="900"
                />
              </div>

              <div className="form-group">
                <label className="form-label">End Time</label>
                <input
                  type="time"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                  className="modal-input"
                  step="900"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Language</label>
                <input
                  type="text"
                  placeholder="e.g., English, Latin, Mandarin"
                  value={editLanguage}
                  onChange={(e) => setEditLanguage(e.target.value)}
                  className="modal-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea
                  placeholder="Additional notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="modal-input modal-textarea"
                  rows="3"
                />
              </div>

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  onClick={() => setEditingSchedule(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    handleSaveScheduleEdit();
                    setActiveScheduleId(null);
                  }}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Mass Type Modal with color presets */}
      {showAddMassType && (
        <div
          className="modal-overlay"
          onClick={() => setShowAddMassType(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add Mass Type</h3>
            <input
              type="text"
              placeholder="Mass Type Name"
              value={newMassTypeName}
              onChange={(e) => setNewMassTypeName(e.target.value)}
              className="modal-input"
            />

            <div className="color-presets">
              <span className="color-presets-label">Choose a color:</span>
              <div className="color-presets-grid">
                {[
                  "#2C3E91",
                  "#6BA368",
                  "#D4AF37",
                  "#CC0000",
                  "#FF6B35",
                  "#4ECDC4",
                  "#95E1D3",
                  "#F38181",
                ].map((color) => (
                  <button
                    key={color}
                    className={`color-preset ${
                      newMassTypeColor === color ? "active" : ""
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewMassTypeColor(color)}
                  />
                ))}
              </div>
            </div>

            <div className="custom-color-section">
              <span className="custom-color-label">Or customize:</span>
              <input
                type="color"
                value={newMassTypeColor}
                onChange={(e) => setNewMassTypeColor(e.target.value)}
                className="modal-color-picker"
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowAddMassType(false)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={handleAddMassType}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Template Modal */}
      {showAddTemplate && (
        <div
          className="modal-overlay"
          onClick={() => setShowAddTemplate(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add Template</h3>
            <input
              type="text"
              placeholder="Template Name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              className="modal-input"
            />
            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowAddTemplate(false)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={handleAddTemplate}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Template Modal */}
      {editingTemplate && (
        <div className="modal-overlay" onClick={() => setEditingTemplate(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Rename Template</h3>
            <input
              type="text"
              placeholder="Template Name"
              value={editTemplateName}
              onChange={(e) => setEditTemplateName(e.target.value)}
              className="modal-input"
            />
            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setEditingTemplate(null)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={handleRenameTemplate}>
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
