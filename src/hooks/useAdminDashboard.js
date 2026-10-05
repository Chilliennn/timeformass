import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { massTypeRepository } from "../repositories/massTypeRepository.js";
import { templateRepository } from "../repositories/templateRepository.js";

export function useAdminDashboard(navigate) {
  const [admin, setAdmin] = useState(null);
  const [parish, setParish] = useState(null);
  const [parishesList, setParishesList] = useState([]);
  const [selectedParishId, setSelectedParishId] = useState("ALL");
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
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
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
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const session = data?.session;
        if (!session) {
          navigate("/login");
          return;
        }
        const email = session.user.email;
        const { data: adminRow, error: adminError } = await supabase
          .from("admin")
          .select("admin_id, name, email, parish_id")
          .eq("email", email)
          .maybeSingle();
        if (adminError) throw adminError;
        if (!adminRow) {
          navigate("/login");
          return;
        }
        setAdmin(adminRow);
        
        const { data: allParishes, error: parishesError } = await supabase
          .from("parish")
          .select("*")
          .order("name");
        if (parishesError) throw parishesError;
        setParishesList(allParishes);

        if (adminRow.admin_id === 1) {
          setSelectedParishId("ALL");
        } else {
          setSelectedParishId(adminRow.parish_id);
        }

        const initialParishId = adminRow.parish_id || allParishes[0]?.parish_id;
        const { data: parishRow, error: parishError } = await supabase
          .from("parish")
          .select("*")
          .eq("parish_id", initialParishId)
          .single();
        if (parishError) throw parishError;
        setParish(parishRow);
        
        const types = await massTypeRepository.findByAdminId(adminRow.admin_id);
        setMassTypes(types);
      } catch (err) {
        console.error(err);
      }
    }
    loadAdminData();
  }, [navigate]);

  useEffect(() => {
    async function loadTemplatesForParish() {
      if (!selectedParishId || !admin) return;
      try {
        let templatesList = [];
        if (selectedParishId === "ALL") {
          const { data } = await supabase.from("schedule_templates").select("*");
          templatesList = data || [];
        } else {
          templatesList = await templateRepository.findByAdminId(selectedParishId);
          const { data: activeParish } = await supabase
            .from("parish")
            .select("*")
            .eq("parish_id", selectedParishId)
            .single();
          if (activeParish) setParish(activeParish);
        }
        setTemplates(templatesList);
        
        if (selectedParishId !== "ALL") {
          const activeTemplate = await templateRepository.getActiveTemplateByDate(selectedParishId, currentViewDate);
          setSelectedTemplate(activeTemplate || templatesList.find((t) => t.is_default) || templatesList[0]);
        } else {
          setSelectedTemplate(null);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadTemplatesForParish();
  }, [selectedParishId, admin, currentViewDate]);

  const refreshTemplateSchedules = useCallback(async () => {
    try {
      let targetTemplates = [];

      if (selectedParishId === "ALL") {
        targetTemplates = templates;
      } else if (selectedTemplate) {
        targetTemplates = [selectedTemplate];
      } else {
        targetTemplates = templates;
      }

      let aggregatedLive = [];
      let aggregatedDrafts = [];

      for (const t of targetTemplates) {
        if (t.start_date && t.end_date && (currentViewDate < t.start_date || currentViewDate > t.end_date)) {
          continue;
        }

        let scheduleData = await templateRepository.getTemplateSchedulesCombined(t.template_id, currentViewDate);
        if (scheduleData && scheduleData.length === 0) {
          const fallbackTemplate = templates.find(temp => temp.parish_id === t.parish_id && temp.is_default);
          if (fallbackTemplate && fallbackTemplate.template_id !== t.template_id) {
            scheduleData = await templateRepository.getTemplateSchedulesCombined(fallbackTemplate.template_id, currentViewDate);
          }
        }

        if (scheduleData) {
          scheduleData.forEach(s => {
            if (s.is_scraped_draft) {
              aggregatedDrafts.push(s);
            } else {
              aggregatedLive.push(s);
            }
          });
        }
      }

      setSchedules(aggregatedLive);
      setDraftSchedules(aggregatedDrafts);
    } catch (err) {
      console.error(err);
    }
  }, [selectedParishId, selectedTemplate, templates, currentViewDate]);

  useEffect(() => {
    if (templates.length > 0) {
      refreshTemplateSchedules();
    }
  }, [selectedTemplate, refreshTemplateSchedules, templates]);

  const handleTriggerScraper = async (triggerId) => {
    if (!admin) return;
    const weekRange = getCurrentWeekDateRange();
    setScrapingTarget(triggerId);
    
    let activeTemplateId = selectedTemplate?.template_id;
    if (!activeTemplateId && templates.length > 0) {
      activeTemplateId = templates[0].template_id;
    }
    
    try {
      const response = await fetch('http://localhost:3001/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: admin.admin_id,
          triggerId: triggerId,
          templateId: activeTemplateId,
          startDate: weekRange.startDate,
          endDate: weekRange.endDate,
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Scraper connection error');
      
      const templatesList = selectedParishId === "ALL" 
        ? (await supabase.from("schedule_templates").select("*")).data 
        : await templateRepository.findByAdminId(selectedParishId);
      setTemplates(templatesList || []);
      
      alert(`Synchronization finished: ${result.message}`);
      await refreshTemplateSchedules();
    } catch (err) {
      alert(`Scraper execution failed:\n${err.message}`);
    } finally {
      setScrapingTarget(null);
    }
  };

  const autoSave = useCallback(async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      setShowSavedMessage(true);
      if (savedMessageTimeoutRef.current) clearTimeout(savedMessageTimeoutRef.current);
      savedMessageTimeoutRef.current = setTimeout(() => setShowSavedMessage(false), 2000);
      setSaving(false);
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
      console.error(error);
    }
  };

  const handleDeleteMassType = async (massTypeId) => {
    if (!confirm("Delete this mass type? All associated schedules will be removed.")) return;
    try {
      await massTypeRepository.delete(massTypeId);
      setMassTypes(massTypes.filter((t) => t.mass_type_id !== massTypeId));
      setSchedules(schedules.filter((s) => s.mass_type_id !== massTypeId));
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddScheduleFromType = async (massType) => {
    setPlacingMassType(massType);
    document.body.style.cursor = "crosshair";
  };

  const handleDeleteSchedule = async (scheduleId) => {
    try {
      await templateRepository.deleteSchedule(scheduleId);
      const updatedSchedules = schedules.filter((s) => s.template_schedule_id !== scheduleId);
      setSchedules(updatedSchedules);
      autoSave(updatedSchedules);
    } catch (error) {
      console.error(error);
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
      await templateRepository.deleteSchedule(scheduleToDelete.template_schedule_id);
      await refreshTemplateSchedules();
      return;
    }
    await handleDeleteSchedule(scheduleToDelete.template_schedule_id);
  };

  const handleApproveAllDrafts = async () => {
    if (!selectedTemplate) return;
    try {
      await templateRepository.approveAllStagedDrafts(selectedTemplate.template_id);
      await refreshTemplateSchedules();
      setShowSavedMessage(true);
    } catch (error) {
      console.error(error);
    }
  };

  const handleDragScheduleStart = (e, schedule) => {
    if (resizingSchedule || placingMassType) return;
    const client = getClientFromEvent(e);
    const el = e?.currentTarget || document.querySelector(`.schedule-block[data-id="${schedule.template_schedule_id}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDragOffset({ x: client.clientX - rect.left, y: client.clientY - rect.top });
    setDraggedSchedule(schedule);
    setIsDragging(true);
    el.style.opacity = "0.5";
  };

  const handleDragScheduleMove = useCallback((e) => {
    if (!isDragging || !draggedSchedule) return;
    const client = getClientFromEvent(e);
    const columns = document.querySelectorAll(".day-column-body");
    let targetColumn = null;
    let targetDayIndex = -1;
    for (let i = 0; i < columns.length; i++) {
      const rect = columns[i].getBoundingClientRect();
      if (client.clientX >= rect.left && client.clientX <= rect.right && client.clientY >= rect.top && client.clientY <= rect.bottom) {
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
      const snappedMinutes = Math.round(rawMinutes / MINUTE_STEP) * MINUTE_STEP;
      const startMinutes = Math.max(0, Math.min(TOTAL_DAY_MINUTES - MINUTE_STEP, snappedMinutes));
      const duration = timeStringToMinutesFromStart(draggedSchedule.end_time) - timeStringToMinutesFromStart(draggedSchedule.start_time);
      const endMinutes = Math.min(TOTAL_DAY_MINUTES, startMinutes + duration);
      const targetDay = currentWeek[targetDayIndex].getDay() === 0 ? 7 : currentWeek[targetDayIndex].getDay();
      setSchedules((prev) =>
        prev.map((s) =>
          s.template_schedule_id === draggedSchedule.template_schedule_id
            ? { ...s, day_of_week: targetDay, start_time: minutesFromStartToTimeString(startMinutes), end_time: minutesFromStartToTimeString(endMinutes) }
            : s
        )
      );
    }
  }, [isDragging, draggedSchedule, TOTAL_DAY_MINUTES, dragOffset.y, currentWeek]);

  const handleDragScheduleEnd = useCallback(async () => {
    if (!draggedSchedule) return;
    const el = document.querySelector(`.schedule-block[data-id="${draggedSchedule.template_schedule_id}"]`);
    if (el) el.style.opacity = "1";
    const updatedSchedule = schedules.find((s) => s.template_schedule_id === draggedSchedule.template_schedule_id);
    if (updatedSchedule) {
      try {
        await templateRepository.updateSchedule(updatedSchedule.template_schedule_id, {
          day_of_week: updatedSchedule.day_of_week,
          start_time: updatedSchedule.start_time,
          end_time: updatedSchedule.end_time,
        });
        setShowSavedMessage(true);
      } catch (error) {
        console.error(error);
      }
    }
    setIsDragging(false);
    setDraggedSchedule(null);
  }, [draggedSchedule, schedules]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleDragScheduleMove);
      window.addEventListener("mouseup", handleDragScheduleEnd);
      return () => {
        window.removeEventListener("mousemove", handleDragScheduleMove);
        window.removeEventListener("mouseup", handleDragScheduleEnd);
      };
    }
  }, [isDragging, handleDragScheduleMove, handleDragScheduleEnd]);

  const handleAddTemplate = async () => {
    if (!newTemplateName.trim()) return;
    const weekRange = getCurrentWeekDateRange();
    try {
      const newTemplate = await templateRepository.createTemplate(selectedParishId === "ALL" ? admin.parish_id : selectedParishId, newTemplateName, false, weekRange.startDate, weekRange.endDate);
      setTemplates([...templates, newTemplate]);
      setNewTemplateName("");
      setShowAddTemplate(false);
    } catch (error) {
      console.error(error);
    }
  };

  const handleColumnClick = async (event, dayOfWeek) => {
    if (!placingMassType || (!selectedTemplate && selectedParishId !== "ALL")) return;
    const columnBody = event.currentTarget;
    const rect = columnBody.getBoundingClientRect();
    const totalMinutes = TOTAL_DAY_MINUTES;
    const minuteHeight = rect.height / totalMinutes;
    let minutesFromStart = Math.round(Math.max(0, Math.min(rect.height, event.clientY - rect.top)) / minuteHeight / MINUTE_STEP) * MINUTE_STEP;
    minutesFromStart = Math.max(0, Math.min(totalMinutes - MINUTE_STEP, minutesFromStart));
    let endMinutes = minutesFromStart + DEFAULT_DURATION_MINUTES;
    
    let activeTemplateId = selectedTemplate?.template_id;
    if (!activeTemplateId && templates.length > 0) activeTemplateId = templates[0].template_id;

    try {
      await templateRepository.insertSchedule({
        template_id: activeTemplateId,
        mass_type_id: placingMassType.mass_type_id,
        day_of_week: dayOfWeek,
        start_time: minutesFromStartToTimeString(minutesFromStart),
        end_time: minutesFromStartToTimeString(endMinutes),
        language: "",
        notes: "",
      });
      await refreshTemplateSchedules();
      setShowSavedMessage(true);
    } catch (error) {
      console.error(error);
    } finally {
      setPlacingMassType(null);
      document.body.style.cursor = "default";
    }
  };

  const handleResizeStart = (type, schedule, direction) => {
    type.stopPropagation();
    type.preventDefault();
    setResizingSchedule(schedule);
    setResizeDirection(direction);
    resizeContextRef.current = { element: type.currentTarget.closest(".day-column-body") };
    document.body.style.cursor = "ns-resize";
  };

  const handleResizeMove = useCallback((e) => {
    if (!resizingSchedule || !resizeDirection) return;
    const columnEl = resizeContextRef.current?.element;
    if (!columnEl) return;
    const rect = columnEl.getBoundingClientRect();
    const totalMinutes = TOTAL_DAY_MINUTES;
    const minuteHeight = columnEl.offsetHeight / totalMinutes;
    const rawMinutes = Math.max(0, Math.min(rect.height, e.clientY - rect.top)) / minuteHeight;
    const snappedMinutes = Math.round(rawMinutes / MINUTE_STEP) * MINUTE_STEP;
    if (resizeDirection === "top") {
      setSchedules((prev) =>
        prev.map((s) => {
          if (s.template_schedule_id !== resizingSchedule.template_schedule_id) return s;
          const currentEnd = timeStringToMinutesFromStart(s.end_time);
          const clamped = Math.max(0, Math.min(currentEnd - MINUTE_STEP, snappedMinutes));
          if (clamped === timeStringToMinutesFromStart(s.start_time)) return s;
          const updated = { ...s, start_time: minutesFromStartToTimeString(clamped) };
          setResizingSchedule(updated);
          return updated;
        })
      );
    } else {
      setSchedules((prev) =>
        prev.map((s) => {
          if (s.template_schedule_id !== resizingSchedule.template_schedule_id) return s;
          const currentStart = timeStringToMinutesFromStart(s.start_time);
          const clamped = Math.max(currentStart + MINUTE_STEP, Math.min(totalMinutes, snappedMinutes));
          if (clamped === timeStringToMinutesFromStart(s.end_time)) return s;
          const updated = { ...s, end_time: minutesFromStartToTimeString(clamped) };
          setResizingSchedule(updated);
          return updated;
        })
      );
    }
  }, [resizingSchedule, resizeDirection, TOTAL_DAY_MINUTES]);

  const handleResizeEnd = useCallback(async () => {
    if (!resizingSchedule) return;
    try {
      await templateRepository.updateSchedule(resizingSchedule.template_schedule_id, {
        start_time: resizingSchedule.start_time,
        end_time: resizingSchedule.end_time,
      });
      setShowSavedMessage(true);
    } catch (error) {
      console.error(error);
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
      await templateRepository.updateSchedule(editingSchedule.template_schedule_id, {
        start_time: `${editStartTime}:00`,
        end_time: `${editEndTime}:00`,
        language: editLanguage,
        notes: editNotes,
      });
      await refreshTemplateSchedules();
      setEditingSchedule(null);
      setShowSavedMessage(true);
    } catch (error) {
      console.error(error);
    }
  };

  const detectOverlapsAndGroup = (daySchedules) => {
    const groups = [];
    const timeToMinutes = (timeStr) => timeStringToMinutesFromStart(timeStr);
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
      if (!placed) groups.push([sch]);
    });
    const scheduleMap = new Map();
    groups.forEach(group => {
      const liveItems = group.filter(s => !s.is_scraped_draft);
      const draftItems = group.filter(s => s.is_scraped_draft);
      const hasRealCollision = liveItems.length > 0 && draftItems.length > 0;
      group.forEach(sch => {
        if (sch.is_scraped_draft) {
          scheduleMap.set(sch.template_schedule_id, hasRealCollision ? { left: '50%', width: '50%' } : { left: '0%', width: '100%' });
        } else {
          scheduleMap.set(sch.template_schedule_id, hasRealCollision ? { left: '0%', width: '50%' } : { left: '0%', width: '100%' });
        }
      });
    });
    return scheduleMap;
  };

  return {
    admin, parish, parishesList, selectedParishId, setSelectedParishId,
    templates, selectedTemplate, setSelectedTemplate, schedules, draftSchedules,
    massTypes, scrapingTarget, currentWeek, setCurrentWeek, showAddMassType, setShowAddMassType,
    showAddTemplate, setShowAddTemplate, newMassTypeName, setNewMassTypeName,
    newMassTypeColor, setNewMassTypeColor, newTemplateName, setNewTemplateName,
    activeScheduleId, saving, showSavedMessage, placingMassType, setPlacingMassType,
    editingTemplate, setEditingTemplate, editTemplateName, setEditTemplateName,
    editingSchedule, setEditingSchedule, viewSchedule, setViewSchedule,
    pendingDeleteSchedule, setPendingDeleteSchedule, showClearDraftsConfirm, setShowClearDraftsConfirm,
    editStartTime, setEditStartTime, editEndTime, setEditEndTime, editLanguage, setEditLanguage,
    editNotes, setEditNotes, hoursLabels, formatHourLabel, minutesToPixels, columnHeightPx,
    DAY_START_HOUR, getWeekDates, formatDateForDb, detectOverlapsAndGroup, handlePointerDown,
    handlePointerMove, handlePointerUp, handleTriggerScraper, handleAddMassType, handleDeleteMassType,
    handleAddScheduleFromType, requestDeleteSchedule, confirmDeleteSchedule, handleApproveAllDrafts,
    handleColumnClick, handleAddTemplate, handleSaveScheduleEdit, showProfileDropdown, setShowProfileDropdown,
    handleResizeStart, currentViewDate
  };
}