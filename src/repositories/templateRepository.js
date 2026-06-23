import { supabase } from '../lib/supabaseClient.js';

export const templateRepository = {
  async findByAdminId(parishId) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('parish_id', parishId)
      .order('is_default', { ascending: false })
      .order('name');
    if (error) throw error;
    return data;
  },

  async getActiveTemplateByDate(parishId, targetDate) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('parish_id', parishId)
      .not('start_date', 'is', null)
      .not('end_date', 'is', null)
      .lte('start_date', targetDate)
      .gte('end_date', targetDate)
      .order('is_default', { ascending: false })
      .order('template_id', { ascending: false });

    if (error) throw error;

    if (data && data.length > 0) {
      return data[0];
    }

    const { data: nullDateData, error: nullDateError } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('parish_id', parishId)
      .is('start_date', null)
      .is('end_date', null)
      .order('is_default', { ascending: false })
      .order('template_id', { ascending: false });

    if (nullDateError) throw nullDateError;

    if (nullDateData && nullDateData.length > 0) {
      return nullDateData[0];
    }

    const { data: fallbackData, error: fallbackError } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('parish_id', parishId)
      .order('is_default', { ascending: false })
      .order('template_id', { ascending: false });

    if (fallbackError) throw fallbackError;
    return fallbackData && fallbackData.length > 0 ? fallbackData[0] : null;
  },

  async findById(templateId) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('template_id', templateId)
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  },

  async createTemplate(parishId, name, isDefault, startDate = null, endDate = null) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .insert([{ 
        parish_id: parishId,
        name,
        is_default: isDefault,
        start_date: startDate,
        end_date: endDate,
      }])
      .select()
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  },

  async insert(template) {
    return this.createTemplate(
      template.parish_id,
      template.name,
      template.is_default,
      template.start_date ?? template.startDate ?? null,
      template.end_date ?? template.endDate ?? null,
    );
  },

  async update(templateId, updates) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .update(updates)
      .eq('template_id', templateId)
      .select()
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  },

  async delete(templateId) {
    const { error } = await supabase
      .from('schedule_templates')
      .delete()
      .eq('template_id', templateId);
    if (error) throw error;
  },

  async getTemplateSchedules(templateId) {
    return this.getTemplateSchedulesCombined(templateId);
  },

  async getTemplateSchedulesCombined(templateId) {
    const { data, error } = await supabase
      .from('template_schedules')
      .select(`
        *,
        mass_types (*)
      `)
      .eq('template_id', templateId);
    if (error) throw error;
    return data;
  },

  async getStagedDraftSchedules(templateId) {
    const { data, error } = await supabase
      .from('template_schedules')
      .select(`
        *,
        mass_types (*)
      `)
      .eq('template_id', templateId)
      .eq('is_scraped_draft', true)
      .order('day_of_week')
      .order('start_time');
    if (error) throw error;
    return data;
  },

  async approveAllStagedDrafts(templateId) {
    const { data, error } = await supabase
      .from('template_schedules')
      .update({ is_scraped_draft: false })
      .eq('template_id', templateId)
      .eq('is_scraped_draft', true)
      .select();
    if (error) throw error;
    return data;
  },

  async deleteDraftSchedules(templateId) {
    const { error } = await supabase
      .from('template_schedules')
      .delete()
      .eq('template_id', templateId)
      .eq('is_scraped_draft', true);
    if (error) throw error;
  },

  async insertDraftSchedules(templateId, schedules) {
    const rows = (schedules || []).map((schedule) => ({
      template_id: templateId,
      mass_type_id: schedule.mass_type_id ?? null,
      day_of_week: schedule.day_of_week,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      language: schedule.language ?? null,
      notes: schedule.notes ?? null,
      is_scraped_draft: true,
    }));
    if (rows.length === 0) {
      return [];
    }
    const { data, error } = await supabase
      .from('template_schedules')
      .insert(rows)
      .select();
    if (error) throw error;
    return data;
  },

  async insertSchedule(schedule) {
    const { data, error } = await supabase
      .from('template_schedules')
      .insert([schedule])
      .select()
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  },

  async updateSchedule(scheduleId, updates) {
    const { data, error } = await supabase
      .from('template_schedules')
      .update(updates)
      .eq('template_schedule_id', scheduleId)
      .select()
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  },

  async deleteSchedule(scheduleId) {
    const { error } = await supabase
      .from('template_schedules')
      .delete()
      .eq('template_schedule_id', scheduleId);
    if (error) throw error;
  }
};