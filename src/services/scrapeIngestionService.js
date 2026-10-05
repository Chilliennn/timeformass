import { templateRepository } from '../repositories/templateRepository.js';
import { scheduleOccurrenceRepository } from '../repositories/scheduleOccurrenceRepository.js';
import dayjs from 'dayjs';

const dedupeSchedules = (schedules) => {
  const uniqueSchedules = [];
  const seen = new Set();
  for (const schedule of schedules || []) {
    const signature = [
      schedule.day_of_week,
      schedule.start_time,
      schedule.end_time,
      (schedule.language || '').trim().toLowerCase(),
      (schedule.notes || '').trim().toLowerCase(),
      schedule.date || ''
    ].join('|');
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    uniqueSchedules.push(schedule);
  }
  return uniqueSchedules;
};

export const scrapeIngestionService = {
  async replaceParishDraftOccurrences(parishId, scrapeRunId, source, schedules, weekStartDate) {
    const baseDate = dayjs(weekStartDate).startOf('week');
    const rows = dedupeSchedules(schedules).map((schedule) => {
      const dayOfWeek = parseInt(schedule.day_of_week, 10);
      const computedDate = schedule.date || baseDate
        .add(dayOfWeek === 7 ? 0 : dayOfWeek, 'day')
        .format('YYYY-MM-DD');
      return {
      parish_id: parishId,
      scrape_run_id: scrapeRunId,
      source,
      date: computedDate,
      day_of_week: schedule.day_of_week,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      language: schedule.language ?? null,
      notes: schedule.notes ?? null,
      is_scraped_draft: true,
      };
    });

    await scheduleOccurrenceRepository.deleteDraftsForRun(parishId, scrapeRunId);
    const insertedOccurrences = await scheduleOccurrenceRepository.insertDrafts(rows);
    return {
      insertedCount: insertedOccurrences.length,
      occurrences: insertedOccurrences,
    };
  },

  async replaceDraftSchedules(templateId, schedules, weekStartDate) {
    if (!templateId) {
      throw new Error('templateId is required to store scraped drafts.');
    }
    const baseDate = dayjs(weekStartDate);
    const schedulesWithDates = (schedules || []).map(schedule => {
      const targetDayNum = parseInt(schedule.day_of_week, 10);
      const daysToAdd = targetDayNum === 7 ? 0 : targetDayNum; 
      const computedDate = baseDate.startOf('week').add(daysToAdd, 'day').format('YYYY-MM-DD');
      return {
        ...schedule,
        date: computedDate
      };
    });
    const uniqueSchedules = dedupeSchedules(schedulesWithDates);
    await templateRepository.deleteDraftSchedules(templateId);
    const insertedDrafts = await templateRepository.insertDraftSchedules(
      templateId,
      uniqueSchedules
    );
    return {
      deletedCount: 0,
      insertedCount: insertedDrafts.length,
      schedules: insertedDrafts,
    };
  },
};