import { supabase } from '../lib/supabaseClient.js';

export const parishRepository = {
  // Fetch all parishes
  async findAll() {
    const { data, error } = await supabase
      .from('parish')
      .select('*')
      .order('name');
    
    if (error) throw error;
    return data;
  },

  // Fetch parish by ID
  async findById(parishId) {
    const { data, error } = await supabase
      .from('parish')
      .select('*')
      .eq('parish_id', parishId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Find parish by exact name
  async findByName(name) {
    const { data, error } = await supabase
      .from('parish')
      .select('*')
      .eq('name', name)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  // Create new parish
  async save(parish) {
    const { data, error } = await supabase
      .from('parish')
      .insert([parish])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Update parish
  async update(parishId, updates) {
    const { data, error } = await supabase
      .from('parish')
      .update({ ...updates, last_updated: new Date().toISOString() })
      .eq('parish_id', parishId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Delete parish
  async delete(parishId) {
    const { error } = await supabase
      .from('parish')
      .delete()
      .eq('parish_id', parishId);
    
    if (error) throw error;
  }
};