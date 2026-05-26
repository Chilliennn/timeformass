import { supabase } from '../lib/supabaseClient.js';

export const templateRepository = {
  async findByAdminId(adminId) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('admin_id', adminId)
      .order('is_default', { ascending: false })
      .order('name');
    
    if (error) throw error;
    return data;
  },

  async getActiveTemplateByDate(adminId, targetDate) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('admin_id', adminId)
      .lte('start_date', targetDate)
      .gte('end_date', targetDate)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async findById(templateId) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('template_id', templateId)
      .single();
    
    if (error) throw error;
    return data;
  },

  async createTemplate(adminId, name, isDefault, startDate = null, endDate = null) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .insert([{ 
        admin_id: adminId,
        name,
        is_default: isDefault,
        start_date: startDate,
        end_date: endDate,
      }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async insert(template) {
    return this.createTemplate(
      template.admin_id,
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
      .single();
    
    if (error) throw error;
    return data;
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

  async getTemplateSchedulesCombined(templateId, targetDate = null) {
    let query = supabase
      .from('template_schedules')
      .select(`
        *,
        mass_types (*),
        schedule_templates!inner (start_date, end_date)
      `)
      .eq('template_id', templateId);

    if (targetDate) {
      query = query
        .lte('schedule_templates.start_date', targetDate)
        .gte('schedule_templates.end_date', targetDate);
    }

    const { data, error } = await query;

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
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateSchedule(scheduleId, updates) {
    const { data, error } = await supabase
      .from('template_schedules')
      .update(updates)
      .eq('template_schedule_id', scheduleId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async deleteSchedule(scheduleId) {
    const { error } = await supabase
      .from('template_schedules')
      .delete()
      .eq('template_schedule_id', scheduleId);
    
    if (error) throw error;
  }
};