import { parishRepository } from '../repositories/parishRepository.js';
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
    const templates = await templateRepository.findByAdminId(parishId);
    const defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
    
    let schedules = [];
    if (defaultTemplate) {
      schedules = await templateRepository.getTemplateSchedulesCombined(defaultTemplate.template_id);
    }
    
    return {
      ...parish,
      schedules: schedules || []
    };
  },

  async getSchedulesForDay(parishId, dayOfWeek) {
    const templates = await templateRepository.findByAdminId(parishId);
    const defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
    if (!defaultTemplate) return [];
    
    const allSchedules = await templateRepository.getTemplateSchedulesCombined(defaultTemplate.template_id);
    const approvedSchedules = (allSchedules || []).filter(s => !s.is_scraped_draft);
    const daySchedules = approvedSchedules.filter(s => parseInt(s.day_of_week, 10) === parseInt(dayOfWeek, 10));
    
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
    const templates = await templateRepository.findByAdminId(parishId);
    const defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
    if (!defaultTemplate) throw new Error("No template context found to attach schedule");
    
    return await templateRepository.insertSchedule({
      template_id: defaultTemplate.template_id,
      ...scheduleData
    });
  },

  async updateSchedule(parishId, adminId, scheduleId, updates) {
    return await templateRepository.updateSchedule(scheduleId, updates);
  },

  async deleteSchedule(parishId, adminId, scheduleId) {
    await templateRepository.deleteSchedule(scheduleId);
    return { success: true };
  },

  async updateSchedules(parishId, adminId, schedulesPayload) {
    const templates = await templateRepository.findByAdminId(parishId);
    let defaultTemplate = (templates || []).find(t => t.is_default) || (templates && templates[0]);
    
    if (!defaultTemplate) {
      defaultTemplate = await templateRepository.createTemplate(parishId, "Default Template", true);
    } else {
      await templateRepository.deleteDraftSchedules(defaultTemplate.template_id);
      const activeSchedules = await templateRepository.getTemplateSchedulesCombined(defaultTemplate.template_id);
      for (const s of activeSchedules) {
        await templateRepository.deleteSchedule(s.template_schedule_id);
      }
    }
    const insertedSchedules = [];
    for (const s of (schedulesPayload || [])) {
      const inserted = await templateRepository.insertSchedule({
        template_id: defaultTemplate.template_id,
        mass_type_id: s.mass_type_id || null,
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
        language: s.language || null,
        notes: s.notes || null,
        is_scraped_draft: false
      });
      insertedSchedules.push(inserted);
    }
    return insertedSchedules;
  },

  async getParishForAdmin(parishId, adminId) {
    const admin = await adminRepository.findById(adminId);
    if (!admin || admin.parish_id !== parishId) {
      throw new Error('Unauthorized: Admin does not belong to this parish');
    }
    return await this.getParishDetails(parishId);
  },

  async getActiveSchedules(targetDate = null) {
    const parishes = await parishRepository.findAll();
    const allSchedules = [];
    
    for (const parish of parishes) {
      let templates = [];
      if (targetDate) {
        try {
          const activeTemplate = await templateRepository.getActiveTemplateByDate(parish.parish_id, targetDate);
          templates = activeTemplate ? [activeTemplate] : [];
        } catch (e) {
          console.error(e);
        }
      }
      
      if (!templates || templates.length === 0) {
        try {
          const fallbackTemplates = await templateRepository.findByAdminId(parish.parish_id);
          templates = fallbackTemplates || [];
        } catch (e) {
          console.error(e);
        }
      }
      
      if (!templates || templates.length === 0) {
        continue;
      }
      
      for (const template of templates) {
        try {
          if (targetDate) {
            if (template.start_date && targetDate < template.start_date) continue;
            if (template.end_date && targetDate > template.end_date) continue;
          }

          const schedules = await templateRepository.getTemplateSchedulesCombined(template.template_id);
          if (!schedules || schedules.length === 0) continue;
          
          const approvedSchedules = schedules.filter(s => !s.is_scraped_draft);
          allSchedules.push(...approvedSchedules.map(s => ({
            ...s,
            parish_name: parish.name,
            parish_location_url: parish.location_url,
            mass_type_name: s.mass_types?.name || ''
          })));
        } catch (e) {
          console.error(e);
        }
      }
    }
    return allSchedules;
  },

  async updateParishInfo(parishId, adminId, updates) {
    const updatedParish = await parishRepository.update(parishId, updates);
    return updatedParish;
  }
};