import { supabase } from '../lib/supabaseClient.js';

export const massTypeRepository = {
  async findByAdminId(adminId) {
    const { data, error } = await supabase
      .from('mass_types')
      .select('*')
      .eq('admin_id', adminId)
      .order('name');
    
    if (error) throw error;
    return data;
  },

  async insert(massType) {
    const { data, error } = await supabase
      .from('mass_types')
      .insert([massType])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(massTypeId) {
    const { error } = await supabase
      .from('mass_types')
      .delete()
      .eq('mass_type_id', massTypeId);
    
    if (error) throw error;
  }
};