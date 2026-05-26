import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import { adminRepository } from "../../repositories/adminRepository.js";
import { massTypeRepository } from "../../repositories/massTypeRepository.js";
import { parishRepository } from "../../repositories/parishRepository.js";
import { templateRepository } from "../../repositories/templateRepository.js";
import "./AdminDashboard.css";

function AdminDashboard() {
  const [admin, setAdmin] = useState(null);
  const [parish, setParish] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [draftSchedules, setDraftSchedules] = useState([]);
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
  const [viewSchedule, setViewSchedule] = useState(null);
  const [pendingDeleteSchedule, setPendingDeleteSchedule] = useState(null);
  const [showClearDraftsConfirm, setShowClearDraftsConfirm] = useState(false);
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

  const formatDateForDb = (date) => {
    if (!date) return null;
    const normalized = new Date(date);
    const year = normalized.getFullYear();
    const month = String(normalized.getMonth() + 1).padStart(2, "0");
    const day = String(normalized.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getCurrentWeekDateRange = () => ({
    startDate: formatDateForDb(currentWeek[0]),
    endDate: formatDateForDb(currentWeek[6]),
  });

  const currentViewDate = formatDateForDb(currentWeek[0]);

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

  if (e.type === "touchstart") {
    if (touchLongPressTimer.current) clearTimeout(touchLongPressTimer.current);
    touchLongPressTimer.current = setTimeout(() => {
      handleDragScheduleStart(e, schedule);
    }, 500);
  } else {
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

    if (pendingDragRef.current && dist > 6 && e.type.indexOf("mouse") !== -1) {
      setActiveScheduleId(null);
      pendingDragRef.current = false;
      handleDragScheduleStart(e, schedule);
    }
  };

  const handlePointerUp = (e, schedule) => {
  if (touchLongPressTimer.current) {
    clearTimeout(touchLongPressTimer.current);
    touchLongPressTimer.current = null;
  }

  if (isDragging && draggedSchedule) {
    handleDragScheduleEnd();
    pointerDownRef.current = null;
    pendingDragRef.current = false;
    return;
  }

  const pd = pointerDownRef.current;
  if (!pd) return;

  const { clientX, clientY } = getClientFromEvent(e);
  const dx = Math.abs(pd.x - clientX);
  const dy = Math.abs(pd.y - clientY);
  const movedSmall = dx <= 6 && dy <= 6;
  const elapsedShort = Date.now() - pd.time < 500;

  if (movedSmall && elapsedShort && !pd.clickedControl) {
    setActiveScheduleId((prev) =>
      prev === schedule.template_schedule_id ? null : schedule.template_schedule_id
    );
  }

  pointerDownRef.current = null;
  pendingDragRef.current = false;
};

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

      const { data: parishRow } = await supabase
        .from("parish")
        .select("*")
        .eq("parish_id", adminRow.parish_id)
        .single();

      setParish(parishRow);

      const types = await massTypeRepository.findByAdminId(adminRow.admin_id);
      setMassTypes(types);

      const templatesList = await templateRepository.findByAdminId(
        adminRow.admin_id
      );
      const initialWeekDates = getWeekDates(new Date());
      const weekRange = {
        startDate: formatDateForDb(initialWeekDates[0]),
        endDate: formatDateForDb(initialWeekDates[6]),
      };

      if (templatesList.length === 0) {
        const defaultTemplate = await templateRepository.createTemplate(
          adminRow.admin_id,
          "Template 1",
          true,
          weekRange.startDate,
          weekRange.endDate
        );
        setTemplates([defaultTemplate]);
        setSelectedTemplate(defaultTemplate);
      } else {
        setTemplates(templatesList);
        const activeTemplate = await templateRepository.getActiveTemplateByDate(
          adminRow.admin_id,
          weekRange.startDate
        );
        const defaultTemp = activeTemplate || templatesList.find((t) => t.is_default) || templatesList[0];
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

  const refreshTemplateSchedules = useCallback(async (templateId, targetDate = currentViewDate) => {
    if (!templateId) return;

    // Pull directly from the database and rely on it as the absolute single source of truth
    const scheduleData = await templateRepository.getTemplateSchedulesCombined(
      templateId,
      targetDate
    );

    const liveSchedules = [];
    const drafts = [];
    
    if (scheduleData) {
      scheduleData.forEach(s => {
        if (s.is_scraped_draft) {
          drafts.push(s);
        } else {
          liveSchedules.push(s);
        }
      });
    }

    setSchedules(liveSchedules);
    setDraftSchedules(drafts);
  }, [currentViewDate]);

  useEffect(() => {
    async function loadSchedules() {
      if (!selectedTemplate) return;

      const anchorDate = formatDateForDb(currentWeek[0]);
      await refreshTemplateSchedules(selectedTemplate.template_id, anchorDate);
    }

    loadSchedules();
  }, [selectedTemplate, refreshTemplateSchedules, currentWeek]);

  const handleTriggerScraper = async (triggerId) => {
    if (!selectedTemplate || !admin) return;
    const weekRange = getCurrentWeekDateRange();
    setScrapingTarget(triggerId);
    try {
      const response = await fetch('http://localhost:5000/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: admin.admin_id,
          triggerId: triggerId,
          templateId: selectedTemplate.template_id,
          startDate: weekRange.startDate,
          endDate: weekRange.endDate,
        })
      });
      const result = await response.json();
      if (!response.ok) {
        const stageLabel = result.stage ? `Stage: ${result.stage}` : 'Stage: unknown';
        const detailLabel = result.detail || result.error || 'Server connection error';
        throw new Error(`${stageLabel}\n${detailLabel}`);
      }

      if (result.source === "Holy Rosary Church") {
        const holyRosaryParish = await parishRepository.findByName("Holy Rosary Church");

        if (holyRosaryParish && admin.parish_id !== holyRosaryParish.parish_id) {
          const updatedAdmin = await adminRepository.update(admin.admin_id, {
            parish_id: holyRosaryParish.parish_id,
          });

          setAdmin(updatedAdmin);
          setParish(holyRosaryParish);
        }
      }

      const updatedTemplate = await templateRepository.update(selectedTemplate.template_id, {
        start_date: weekRange.startDate,
        end_date: weekRange.endDate,
      });
      setTemplates((prevTemplates) =>
        prevTemplates.map((template) =>
          template.template_id === updatedTemplate.template_id ? updatedTemplate : template
        )
      );
      setSelectedTemplate(updatedTemplate);
      
      alert(`Synchronization finished: ${result.message}`);
      await refreshTemplateSchedules(selectedTemplate.template_id, weekRange.startDate);
    } catch (err) {
      console.error("Scraper execution fail:", err);
      alert(`Scraper execution failed:\n${err.message}`);
    } finally {
      setScrapingTarget(null);
    }
  };

  const autoSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        console.log("Auto-saved schedules");

        setShowSavedMessage(true);

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

  const handleAddScheduleFromType = async (massType) => {
    setPlacingMassType(massType); 
    document.body.style.cursor = "crosshair"; 
  };

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

  const requestDeleteSchedule = (schedule) => {
    setPendingDeleteSchedule(schedule);
  };

  const confirmDeleteSchedule = async () => {
    if (!pendingDeleteSchedule) return;

    const scheduleToDelete = pendingDeleteSchedule;
    setPendingDeleteSchedule(null);

    if (scheduleToDelete.is_scraped_draft) {
      await handleRejectDraft(scheduleToDelete);
      return;
    }

    await handleDeleteSchedule(scheduleToDelete.template_schedule_id);
  };

  const handleRejectDraft = async (draftSchedule) => {
    if (!selectedTemplate || !draftSchedule) return;

    try {
      await templateRepository.deleteSchedule(draftSchedule.template_schedule_id);
      await refreshTemplateSchedules(selectedTemplate.template_id);
      
      setShowSavedMessage(true);
      if (savedMessageTimeoutRef.current) {
        clearTimeout(savedMessageTimeoutRef.current);
      }
      savedMessageTimeoutRef.current = setTimeout(() => {
        setShowSavedMessage(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to reject draft schedule:", error);
    }
  };
  
  const handleApproveAllDrafts = async () => {
    if (!selectedTemplate) return;

    try {
      await templateRepository.approveAllStagedDrafts(selectedTemplate.template_id);
      await refreshTemplateSchedules(selectedTemplate.template_id);
      
      setShowSavedMessage(true);
      if (savedMessageTimeoutRef.current) {
        clearTimeout(savedMessageTimeoutRef.current);
      }
      savedMessageTimeoutRef.current = setTimeout(() => {
        setShowSavedMessage(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to approve all staged drafts:", error);
    }
  };

  const handleClearAllDrafts = async () => {
    if (!selectedTemplate) return;

    try {
      await templateRepository.deleteDraftSchedules(selectedTemplate.template_id);
      await refreshTemplateSchedules(selectedTemplate.template_id);
      
      setShowSavedMessage(true);
      if (savedMessageTimeoutRef.current) {
        clearTimeout(savedMessageTimeoutRef.current);
      }
      savedMessageTimeoutRef.current = setTimeout(() => {
        setShowSavedMessage(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to clear staged drafts:", error);
    } finally {
      setShowClearDraftsConfirm(false);
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

  const handleAddTemplate = async () => {
    if (!newTemplateName.trim()) return;
    const weekRange = getCurrentWeekDateRange();

    try {
      const newTemplate = await templateRepository.createTemplate(
        admin.admin_id,
        newTemplateName,
        false,
        weekRange.startDate,
        weekRange.endDate
      );

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
      await refreshTemplateSchedules(selectedTemplate.template_id);

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

      await refreshTemplateSchedules(selectedTemplate.template_id);
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

  const _handleLogout = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem("admin");
    localStorage.removeItem("admin");
    navigate("/");
  };

  const renderScheduleBlock = (schedule, alignment = { left: "0%", width: "100%" }) => {
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
          left: alignment.left,
          width: `calc(${alignment.width} - 4px)`,
        }}
        onMouseDown={(e) => handlePointerDown(e, schedule)}
        onMouseMove={(e) => handlePointerMove(e, schedule)}
        onMouseUp={(e) => handlePointerUp(e, schedule)}
        onTouchStart={(e) => handlePointerDown(e, schedule)}
        onTouchMove={(e) => {
          handlePointerMove(e, schedule);
        }}
        onTouchEnd={(e) => handlePointerUp(e, schedule)}
        onClick={() => setViewSchedule(schedule)}
      >
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

            <div
              className="schedule-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="schedule-delete"
                onClick={(e) => {
                  e.stopPropagation();
                    requestDeleteSchedule(schedule);
                }}
                aria-label="Delete schedule"
                  title="Delete"
              >
                  ×
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

  const renderDraftBlock = (schedule, alignment = { left: "0%", width: "100%" }) => {
    const startMinutes = timeStringToMinutesFromStart(schedule.start_time);
    const endMinutes = timeStringToMinutesFromStart(schedule.end_time);
    const durationMinutes = Math.max(MINUTE_STEP, endMinutes - startMinutes);
    const heightPx = minutesToPixels(durationMinutes);
    const massTypeName = schedule.mass_types?.name || "Scraped Draft";
    const shortName = massTypeName.substring(0, 3).toUpperCase();

    return (
      <div
        key={`draft-${schedule.template_schedule_id}`}
        data-id={`draft-${schedule.template_schedule_id}`}
        className="schedule-block draft-schedule-block"
        style={{
          top: `${minutesToPixels(startMinutes)}px`,
          height: `${Math.max(30, heightPx - 1)}px`,
          backgroundColor: "rgba(107, 163, 232, 0.14)",
          border: "2px dashed rgba(44, 62, 145, 0.55)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.6)",
          color: "#2c3e91",
          zIndex: 5,
          left: alignment.left,
          width: `calc(${alignment.width} - 4px)`,
          cursor: "pointer",
        }}
        onClick={() => setViewSchedule(schedule)}
      >
        <div className="schedule-block-content" style={{ padding: "0.45rem 0.5rem" }}>
          <div className="schedule-block-header" style={{ alignItems: "flex-start" }}>
            <span className="schedule-block-title" style={{ fontSize: "0.78rem" }}>
              <span className="mass-title-full">{massTypeName}</span>
              <span className="mass-title-short">{shortName}</span>
            </span>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                backgroundColor: "rgba(44, 62, 145, 0.1)",
                borderRadius: "999px",
                padding: "0.15rem 0.45rem",
              }}
            >
              Draft
            </span>

            <button
              className="schedule-delete"
              style={{ position: "absolute", top: "4px", right: "4px", zIndex: 40 }}
              onClick={(e) => {
                e.stopPropagation();
                requestDeleteSchedule(schedule);
              }}
              aria-label="Delete draft schedule"
              title="Delete"
            >
              ×
            </button>
          </div>

          <div className="schedule-block-time" style={{ marginTop: "0.25rem" }}>
            <span className="time-icon">🕐</span>
            <span className="time-text">
              {schedule.start_time.substring(0, 5)} - {schedule.end_time.substring(0, 5)}
            </span>
          </div>

          <div style={{ marginTop: "0.45rem", fontSize: "0.72rem", color: "#355" }}>
            Tap the block to view details.
          </div>
        </div>
      </div>
    );
  };

  if (!admin || !parish) return <div className="loading-admin">Loading...</div>;

  const timeToMinutes = (timeStr) => timeStringToMinutesFromStart(timeStr);

  const detectOverlapsAndGroup = (daySchedules) => {
    const groups = [];
    const sorted = [...daySchedules].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    sorted.forEach(sch => {
      let placed = false;
      for (let group of groups) {
        const hasOverlap = group.some(item => {
          const startA = timeToMinutes(sch.start_time);
          const endA = timeToMinutes(sch.end_time);
          const startB = timeToMinutes(item.start_time);
          const endB = timeToMinutes(item.end_time);
          return startA < endB && startB < endA;
        });

        if (hasOverlap) {
          group.push(sch);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push([sch]);
      }
    });

    const scheduleMap = new Map();
    groups.forEach(group => {
      const liveItems = group.filter(s => !s.is_scraped_draft);
      const draftItems = group.filter(s => s.is_scraped_draft);
      const hasRealCollision = liveItems.length > 0 && draftItems.length > 0;

      group.forEach(sch => {
        if (sch.is_scraped_draft) {
          if (hasRealCollision) {
            scheduleMap.set(sch.template_schedule_id, { left: '50%', width: '50%' });
          } else {
            scheduleMap.set(sch.template_schedule_id, { left: '0%', width: '100%' });
          }
        } else {
          if (hasRealCollision) {
            scheduleMap.set(sch.template_schedule_id, { left: '0%', width: '50%' });
          } else {
            scheduleMap.set(sch.template_schedule_id, { left: '0%', width: '100%' });
          }
        }
      });
    });

    return scheduleMap;
  };

  return (
    <div className="admin-dashboard">
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
                  setShowProfileDropdown(false);
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="admin-content">
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
          <div className="schedule-grid-container">
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
                    const dayDraftSchedules = draftSchedules.filter(
                      (s) => s.day_of_week === dbDay
                    );
                    const dayItems = [...daySchedules, ...dayDraftSchedules];
                    const alignmentMap = detectOverlapsAndGroup(dayItems);

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

                          {dayItems.map((s) => {
                            const alignment = alignmentMap.get(s.template_schedule_id) || { left: '0%', width: '100%' };

                            return s.is_scraped_draft
                              ? renderDraftBlock(s, alignment)
                              : renderScheduleBlock(s, alignment);
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="admin-sidebar">
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
                {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
                  <div key={i} className="calendar-weekday-header">
                    {day}
                  </div>
                ))}

                {(() => {
                  const middleOfWeek = currentWeek[3];
                  const year = middleOfWeek.getFullYear();
                  const month = middleOfWeek.getMonth();

                  const firstDay = new Date(year, month, 1);
                  const startingDayOfWeek = firstDay.getDay();

                  const lastDay = new Date(year, month + 1, 0);
                  const daysInMonth = lastDay.getDate();

                  const prevMonthLastDay = new Date(year, month, 0).getDate();

                  const days = [];

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
                  <h3 style={{ color: '#2c3e91' }}>Target Site Synchronizations</h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#666666', margin: '0.5rem 0 1rem 0', lineHeight: '1.4' }}>
                  Trigger independent web scripts to collect mass schedule listings.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <button 
                    className="btn-add-template" 
                    style={{ backgroundColor: '#2c3e91', width: '100%', margin: 0 }}
                    disabled={scrapingTarget !== null}
                    onClick={() => handleTriggerScraper('st_john_btn')}
                  >
                    {scrapingTarget === 'st_john_btn' ? 'Syncing St. John...' : 'Sync St. John Cathedral'}
                  </button>
                  <button 
                    className="btn-add-template" 
                    style={{ backgroundColor: '#6ba368', width: '100%', margin: 0 }}
                    disabled={scrapingTarget !== null}
                    onClick={() => handleTriggerScraper('holy_rosary_btn')}
                  >
                    {scrapingTarget === 'holy_rosary_btn' ? 'Syncing Holy Rosary...' : 'Sync Holy Rosary Church'}
                  </button>
                </div>
                <div style={{ marginTop: '0.9rem', paddingTop: '0.8rem', borderTop: '1px solid rgba(44, 62, 145, 0.12)' }}>
                  <div className="mass-types-header" style={{ marginBottom: '0.45rem' }}>
                    <h3 style={{ color: '#2c3e91', fontSize: '0.95rem' }}>Review Staged Drafts</h3>
                  </div>

                  {draftSchedules.length > 0 ? (
                    <>
                      <div style={{ marginBottom: '0.65rem', fontSize: '0.8rem', color: '#666' }}>
                        {draftSchedules.length} draft{draftSchedules.length === 1 ? '' : 's'} waiting review.
                      </div>
                      <button
                        className="btn-add-template"
                        style={{ backgroundColor: '#2c3e91', width: '100%', margin: 0 }}
                        onClick={handleApproveAllDrafts}
                      >
                        Approve All Staged Drafts
                      </button>
                      <button
                        className="btn-add-template"
                        style={{ backgroundColor: '#b03a2e', width: '100%', marginTop: '0.6rem' }}
                        onClick={() => setShowClearDraftsConfirm(true)}
                      >
                        Remove All Staged Drafts
                      </button>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#777', lineHeight: '1.4' }}>
                      No staged drafts waiting review.
                    </div>
                  )}
                </div>              
              </div>
            )}
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

        {viewSchedule && (
          <div
            className="modal-overlay"
            onClick={() => setViewSchedule(null)}
          >
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>
                View Schedule {viewSchedule.is_scraped_draft ? "· Draft" : ""}
              </h3>

              <div className="form-group">
                <label className="form-label">Mass Type</label>
                <div className="form-value">
                  {viewSchedule.mass_types?.name || "(unspecified)"}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Start Time</label>
                <div className="form-value">
                  {viewSchedule.start_time?.substring(0, 5) || ""}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">End Time</label>
                <div className="form-value">
                  {viewSchedule.end_time?.substring(0, 5) || ""}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Language</label>
                <div className="form-value">{viewSchedule.language || ""}</div>
              </div>

              {viewSchedule.notes ? (
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <div className="form-value" style={{ whiteSpace: "pre-wrap" }}>
                    {viewSchedule.notes}
                  </div>
                </div>
              ) : null}

              {viewSchedule.bulletin_file_name && (
                <div className="form-group">
                  <label className="form-label">Bulletin</label>
                  <div className="form-value">{viewSchedule.bulletin_file_name}</div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Linked Schedules</label>
                <div className="form-value" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {(() => {
                    const activeSlotSchedules = [...schedules, ...draftSchedules].filter((schedule) => {
                      if (!viewSchedule) return false;
                      if (schedule.day_of_week !== viewSchedule.day_of_week) return false;

                      const startA = timeToMinutes(schedule.start_time);
                      const endA = timeToMinutes(schedule.end_time);
                      const startB = timeToMinutes(viewSchedule.start_time);
                      const endB = timeToMinutes(viewSchedule.end_time);

                      return startA < endB && startB < endA;
                    });

                    return activeSlotSchedules.length > 0 ? (
                      activeSlotSchedules.map((schedule) => (
                        <div
                          key={`${schedule.is_scraped_draft ? "draft" : "live"}-${schedule.template_schedule_id}`}
                          style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}
                        >
                          <span>{schedule.mass_types?.name || "(unspecified)"}</span>
                          <span>{schedule.is_scraped_draft ? "Draft" : "Live"}</span>
                        </div>
                      ))
                    ) : (
                      <div>(no linked schedules in this time slot)</div>
                    );
                  })()}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  onClick={() => setViewSchedule(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingDeleteSchedule && (
          <div
            className="modal-overlay"
            onClick={() => setPendingDeleteSchedule(null)}
          >
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Delete Schedule?</h3>
              <div className="form-group">
                <div className="form-value">
                  This will permanently remove the mass block.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Mass Type</label>
                <div className="form-value">
                  {pendingDeleteSchedule.mass_types?.name || "(unspecified)"}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  onClick={() => setPendingDeleteSchedule(null)}
                >
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmDeleteSchedule}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {showClearDraftsConfirm && (
          <div className="modal-overlay" onClick={() => setShowClearDraftsConfirm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Remove All Staged Drafts?</h3>
              <div className="form-group">
                <div className="form-value">
                  This will permanently remove every staged draft for the selected template.
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  onClick={() => setShowClearDraftsConfirm(false)}
                >
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleClearAllDrafts}>
                  Remove All
                </button>
              </div>
            </div>
          </div>
        )}

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
    </div>
  );
}

export default AdminDashboard;