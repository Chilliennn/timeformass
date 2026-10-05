import { supabase } from '../lib/supabaseClient.js';

export const scheduleOccurrenceRepository = {
  async findDraftsByDateRange(parishId, startDate, endDate) {
    let query = supabase
      .from('parish_schedule_occurrences')
      .select('*')
      .eq('is_scraped_draft', true)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date')
      .order('start_time');
    if (parishId !== 'ALL') query = query.eq('parish_id', parishId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async approveDrafts(occurrenceIds) {
    if (!occurrenceIds.length) return [];
    const { data, error } = await supabase
      .from('parish_schedule_occurrences')
      .update({ is_scraped_draft: false, reviewed_at: new Date().toISOString() })
      .in('occurrence_id', occurrenceIds)
      .eq('is_scraped_draft', true)
      .select();
    if (error) throw error;
    return data || [];
  },

  async deleteDraft(occurrenceId) {
    const { error } = await supabase
      .from('parish_schedule_occurrences')
      .delete()
      .eq('occurrence_id', occurrenceId)
      .eq('is_scraped_draft', true);
    if (error) throw error;
  },

  async findApprovedByDate(date) {
    const { data, error } = await supabase
      .from('parish_schedule_occurrences')
      .select('*')
      .eq('date', date)
      .eq('is_scraped_draft', false)
      .order('parish_id')
      .order('start_time');
    if (error) throw error;
    return data || [];
  },

  async deleteDraftsForRun(parishId, scrapeRunId) {
    const { error } = await supabase
      .from('parish_schedule_occurrences')
      .delete()
      .eq('parish_id', parishId)
      .eq('scrape_run_id', scrapeRunId)
      .eq('is_scraped_draft', true);
    if (error) throw error;
  },

  async insertDrafts(rows) {
    if (!rows.length) return [];
    const { data, error } = await supabase
      .from('parish_schedule_occurrences')
      .insert(rows)
      .select();
    if (error) throw error;
    return data || [];
  },
};