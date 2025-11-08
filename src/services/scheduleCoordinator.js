import { parishRepository } from '../repositories/parishRepository.js';
import { scheduleRepository } from '../repositories/scheduleRepository.js';
import { adminRepository } from '../repositories/adminRepository.js';
import { updateRepository } from '../repositories/updateRepository.js';
import { templateRepository } from '../repositories/templateRepository.js';
import bcrypt from 'bcryptjs';  

export const scheduleCoordinator = {
  // ===== PUBLIC READ OPERATIONS =====
  
  // Get all parishes with their basic info
  async getAllParishes() {
    return await parishRepository.findAll();
  },

  // Get parish details with all schedules
  async getParishDetails(parishId) {
    const parish = await parishRepository.findById(parishId);
    const schedules = await scheduleRepository.findByParishId(parishId);
    
    return {
      ...parish,
      schedules
    };
  },

  // Get schedules for a specific day
  async getSchedulesForDay(parishId, dayOfWeek) {
  // 1) Find admin for this parish
  const admins = await adminRepository.findByParishId(parishId);
  const admin = Array.isArray(admins) ? admins[0] : admins;
  if (!admin) return [];

  // 2) Get default template
  const templates = await templateRepository.findByAdminId(admin.admin_id);
  const defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
  if (!defaultTemplate) return [];

  // 3) Get template schedules for this day
  const allSchedules = await templateRepository.getTemplateSchedules(defaultTemplate.template_id);
  
  // 4) Filter by day_of_week
  const daySchedules = (allSchedules || []).filter(s => s.day_of_week === dayOfWeek);
  
  // 5) Map to include mass type info correctly
  return daySchedules.map(s => ({
    ...s,
    time: s.start_time,
    type: s.mass_types?.name || '', // This is the mass type name
    language: s.language || '',
    notes: s.notes || ''
  }));
},

  // ===== ADMIN OPERATIONS =====

  // Authenticate admin (returns admin object without password)
  async authenticateAdmin(email, passwordPlain) {
    const admin = await adminRepository.findByEmail(email);
    
    if (!admin) {
      return { success: false, message: 'Invalid credentials' };
    }

    // Secure comparison using bcrypt
    const isValidPassword = await bcrypt.compare(passwordPlain, admin.password_hash);
    if (!isValidPassword) {
      return { success: false, message: 'Invalid credentials' };
    }

    // Remove password from response
    const { password_hash: _, ...adminData } = admin;
    return { success: true, admin: adminData };
  },

  // Create new schedule (admin only)
  async createSchedule(parishId, adminId, scheduleData) {
    const schedulePayload = {
      ...scheduleData,
      parish_id: parishId
    };

    const newSchedule = await scheduleRepository.insert(schedulePayload);

    // Log the change
    await updateRepository.insert({
      admin_id: adminId,
      parish_id: parishId,
      changes: JSON.stringify({ action: 'CREATE', schedule: newSchedule })
    });

    return newSchedule;
  },

  // Update existing schedule (admin only)
  async updateSchedule(parishId, adminId, scheduleId, updates) {
    const updatedSchedule = await scheduleRepository.update(scheduleId, updates);

    // Log the change
    await updateRepository.insert({
      admin_id: adminId,
      parish_id: parishId,
      changes: JSON.stringify({ action: 'UPDATE', schedule_id: scheduleId, updates })
    });

    return updatedSchedule;
  },

  // Delete schedule (admin only)
  async deleteSchedule(parishId, adminId, scheduleId) {
    await scheduleRepository.delete(scheduleId);

    // Log the change
    await updateRepository.insert({
      admin_id: adminId,
      parish_id: parishId,
      changes: JSON.stringify({ action: 'DELETE', schedule_id: scheduleId })
    });

    return { success: true };
  },

  // Batch update schedules (replaces all schedules for a parish)
  async updateSchedules(parishId, adminId, schedulesPayload) {
    // Get existing schedules
    const existingSchedules = await scheduleRepository.findByParishId(parishId);

    // Delete all existing
    for (const schedule of existingSchedules) {
      await scheduleRepository.delete(schedule.schedule_id);
    }

    // Insert new schedules
    const newSchedules = schedulesPayload.map(s => ({
      ...s,
      parish_id: parishId
    }));

    const created = await scheduleRepository.saveMany(newSchedules);

    // Log the change
    await updateRepository.insert({
      admin_id: adminId,
      parish_id: parishId,
      changes: JSON.stringify({ 
        action: 'BATCH_UPDATE', 
        deleted_count: existingSchedules.length,
        created_count: created.length 
      })
    });

    return created;
  },

  // Get parish with admin info (for dashboard)
  async getParishForAdmin(parishId, adminId) {
    // Verify admin belongs to this parish
    const admin = await adminRepository.findById(adminId);
    if (!admin || admin.parish_id !== parishId) {
      throw new Error('Unauthorized: Admin does not belong to this parish');
    }

    const parish = await parishRepository.findById(parishId);
    const schedules = await scheduleRepository.findByParishId(parishId);
    const updates = await updateRepository.findByParishId(parishId);

    return {
      parish,
      schedules,
      updates: updates.slice(0, 10) // Last 10 updates
    };
  },

  // Get active schedules for landing page (from default templates)
  // NOTE: scheduleCoordinator must use repositories only (no direct DB client)
  async getActiveSchedules() {
    // 1) get parishes
    const parishes = await parishRepository.findAll();

    const allSchedules = [];

    for (const parish of parishes) {
      // 2) find admin(s) for this parish
      const admins = await adminRepository.findByParishId(parish.parish_id);
      const admin = Array.isArray(admins) ? admins[0] : admins;
      if (!admin) continue;

      // 3) load templates for admin and pick default
      const templates = await templateRepository.findByAdminId(admin.admin_id);
      const defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
      if (!defaultTemplate) continue;

      // 4) get template schedules (includes mass_types via repository join)
      const schedules = await templateRepository.getTemplateSchedules(defaultTemplate.template_id);
      if (!schedules || schedules.length === 0) continue;

      // 5) attach parish info and collect
      allSchedules.push(...schedules.map(s => ({
        ...s,
        parish_name: parish.name,
        parish_location_url: parish.location_url
      })));
    }

    return allSchedules;
  },

  // Update parish info (admin only)
  async updateParishInfo(parishId, adminId, updates) {
    const updatedParish = await parishRepository.update(parishId, updates);

    // Log the change
    await updateRepository.insert({
      admin_id: adminId,
      parish_id: parishId,
      changes: JSON.stringify({ action: 'UPDATE_PARISH_INFO', updates })
    });

    return updatedParish;
  }
};