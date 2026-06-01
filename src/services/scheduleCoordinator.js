import { parishRepository } from '../repositories/parishRepository.js';
import { scheduleRepository } from '../repositories/scheduleRepository.js';
import { adminRepository } from '../repositories/adminRepository.js';
import { templateRepository } from '../repositories/templateRepository.js';
import bcrypt from 'bcryptjs';  

export const scheduleCoordinator = {
  async getAllParishes() {
    return await parishRepository.findAll();
  },

  verifySuperAdminAccess(adminId) {
    return parseInt(adminId, 10) === 1;
  },

  async getParishDetails(parishId) {
    const parish = await parishRepository.findById(parishId);
    const schedules = await scheduleRepository.findByParishId(parishId);
    
    return {
      ...parish,
      schedules
    };
  },

  async getSchedulesForDay(parishId, dayOfWeek) {
    const templates = await templateRepository.findByAdminId(parishId);
    const defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
    if (!defaultTemplate) return [];

    const allSchedules = await templateRepository.getTemplateSchedules(defaultTemplate.template_id);
    
    const daySchedules = (allSchedules || []).filter(s => s.day_of_week === dayOfWeek);
    
    return daySchedules.map(s => ({
      ...s,
      time: s.start_time,
      type: s.mass_types?.name || '',
      language: s.language || '',
      notes: s.notes || ''
    }));
  },

  async authenticateAdmin(email, passwordPlain) {
    const admin = await adminRepository.findByEmail(email);
    
    if (!admin) {
      return { success: false, message: 'Invalid credentials' };
    }

    const isValidPassword = await bcrypt.compare(passwordPlain, admin.password_hash);
    if (!isValidPassword) {
      return { success: false, message: 'Invalid credentials' };
    }

    const { password_hash: _, ...adminData } = admin;
    return { success: true, admin: adminData };
  },

  async createSchedule(parishId, adminId, scheduleData) {
    const schedulePayload = {
      ...scheduleData,
      parish_id: parishId
    };

    const newSchedule = await scheduleRepository.insert(schedulePayload);
    return newSchedule;
  },

  async updateSchedule(parishId, adminId, scheduleId, updates) {
    const updatedSchedule = await scheduleRepository.update(scheduleId, updates);
    return updatedSchedule;
  },

  async deleteSchedule(parishId, adminId, scheduleId) {
    await scheduleRepository.delete(scheduleId);
    return { success: true };
  },

  async updateSchedules(parishId, adminId, schedulesPayload) {
    const existingSchedules = await scheduleRepository.findByParishId(parishId);

    for (const schedule of existingSchedules) {
      await scheduleRepository.delete(schedule.schedule_id);
    }

    const newSchedules = schedulesPayload.map(s => ({
      ...s,
      parish_id: parishId
    }));

    const created = await scheduleRepository.saveMany(newSchedules);
    return created;
  },

  async getParishForAdmin(parishId, adminId) {
    const admin = await adminRepository.findById(adminId);
    if (!admin || admin.parish_id !== parishId) {
      throw new Error('Unauthorized: Admin does not belong to this parish');
    }

    const parish = await parishRepository.findById(parishId);
    const schedules = await scheduleRepository.findByParishId(parishId);

    return {
      parish,
      schedules,
    };
  },

  async getActiveSchedules() {
    const parishes = await parishRepository.findAll();
    const allSchedules = [];

    for (const parish of parishes) {
      const templates = await templateRepository.findByAdminId(parish.parish_id);
      const defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
      if (!defaultTemplate) continue;

      const schedules = await templateRepository.getTemplateSchedules(defaultTemplate.template_id);
      if (!schedules || schedules.length === 0) continue;

      allSchedules.push(...schedules.map(s => ({
        ...s,
        parish_name: parish.name,
        parish_location_url: parish.location_url
      })));
    }

    return allSchedules;
  },

  async updateParishInfo(parishId, adminId, updates) {
    const updatedParish = await parishRepository.update(parishId, updates);
    return updatedParish;
  }
};