import { supabase } from '../lib/supabaseClient.js';

export const scheduleRepository = {
  // Fetch all schedules for a parish
  async findByParishId(parishId) {
    const { data, error } = await supabase
      .from('schedule')
      .select('*')
      .eq('parish_id', parishId)
      .order('day_of_week')
      .order('start_time');
    
    if (error) throw error;
    return data;
  },

  // Fetch schedule by ID
  async findById(scheduleId) {
    const { data, error } = await supabase
      .from('schedule')
      .select('*')
      .eq('schedule_id', scheduleId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Fetch schedules by day
  async findByDay(parishId, dayOfWeek) {
    const { data, error } = await supabase
      .from('schedule')
      .select('*')
      .eq('parish_id', parishId)
      .eq('day_of_week', dayOfWeek)
      .order('start_time');
    
    if (error) throw error;
    return data;
  },

  // Create new schedule
  async insert(schedule) {
    const { data, error } = await supabase
      .from('schedule')
      .insert([schedule])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update schedule
  async update(scheduleId, updates) {
    const { data, error } = await supabase
      .from('schedule')
      .update(updates)
      .eq('schedule_id', scheduleId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete schedule
  async delete(scheduleId) {
    const { error } = await supabase
      .from('schedule')
      .delete()
      .eq('schedule_id', scheduleId);
    
    if (error) throw error;
  },

  // Bulk save schedules (for batch operations)
  async saveMany(schedules) {
    const { data, error } = await supabase
      .from('schedule')
      .insert(schedules)
      .select();
    
    if (error) throw error;
    return data;
  }
};