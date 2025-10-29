import { supabase } from '../lib/supabaseClient.js';

export const adminRepository = {
  // Find admin by email (for authentication)
  async findByEmail(email) {
    const { data, error } = await supabase
      .from('admin')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  },

  // Find admin by ID
  async findById(adminId) {
    const { data, error } = await supabase
      .from('admin')
      .select('*')
      .eq('admin_id', adminId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Find admins by parish
  async findByParishId(parishId) {
    const { data, error } = await supabase
      .from('admin')
      .select('admin_id, parish_id, name, email')
      .eq('parish_id', parishId);
    
    if (error) throw error;
    return data;
  },

  // Create new admin
  async save(admin) {
    const { data, error } = await supabase
      .from('admin')
      .insert([admin])
      .select('admin_id, parish_id, name, email')
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update admin
  async update(adminId, updates) {
    const { data, error } = await supabase
      .from('admin')
      .update(updates)
      .eq('admin_id', adminId)
      .select('admin_id, parish_id, name, email')
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete admin
  async delete(adminId) {
    const { error } = await supabase
      .from('admin')
      .delete()
      .eq('admin_id', adminId);
    
    if (error) throw error;
  }
};