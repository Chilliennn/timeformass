import { supabase } from '../lib/supabaseClient.js';

export const updateRepository = {
  // Find updates by parish
  async findByParishId(parishId) {
    const { data, error } = await supabase
      .from('updates_log')
      .select('*')
      .eq('parish_id', parishId)
      .order('timestamp', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  // Find updates by admin
  async findByAdminId(adminId) {
    const { data, error } = await supabase
      .from('updates_log')
      .select('*')
      .eq('admin_id', adminId)
      .order('timestamp', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  // Find last update for a parish
  async findLatestByParishId(parishId) {
    const { data, error } = await supabase
      .from('updates_log')
      .select('*')
      .eq('parish_id', parishId)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  },

  // Log a new update
  async insert(updateLog) {
    const { data, error } = await supabase
      .from('updates_log')
      .insert([updateLog])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};