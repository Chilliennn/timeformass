import { templateRepository } from '../repositories/templateRepository.js';
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