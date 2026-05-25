import { templateRepository } from '../repositories/templateRepository.js';

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
  async replaceDraftSchedules(templateId, schedules) {
    if (!templateId) {
      throw new Error('templateId is required to store scraped drafts.');
    }

    const uniqueSchedules = dedupeSchedules(schedules);

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