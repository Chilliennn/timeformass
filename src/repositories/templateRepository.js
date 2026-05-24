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

  async findById(templateId) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('template_id', templateId)
      .single();
    
    if (error) throw error;
    return data;
  },

  async insert(template) {
    const { data, error } = await supabase
      .from('schedule_templates')
      .insert([template])
      .select()
      .single();
    
    if (error) throw error;
    return data;
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

  // Template Schedules
  async getTemplateSchedules(templateId) {
    const { data, error } = await supabase
      .from('template_schedules')
      .select(`
        *,
        mass_types (*)
      `)
      .eq('template_id', templateId)
      .eq('is_scraped_draft', false)
      .order('day_of_week')
      .order('start_time');
    
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