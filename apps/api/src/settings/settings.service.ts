import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Setting, SettingsCategory, SettingsAuditLog } from '@prisma/client';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all settings for an organization
   */
  async getAllSettings(organizationId: string) {
    return this.prisma.setting.findMany({
      where: { organizationId },
      include: {
        settingCategory: true,
      },
      orderBy: [{ settingCategory: { name: 'asc' } }, { key: 'asc' }],
    });
  }

  /**
   * Get settings by category
   */
  async getSettingsByCategory(organizationId: string, categoryName: string) {
    return this.prisma.setting.findMany({
      where: {
        organizationId,
        settingCategory: { name: categoryName },
      },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * Get a specific setting value
   */
  async getSetting(organizationId: string, key: string) {
    const setting = await this.prisma.setting.findFirst({
      where: { organizationId, key },
    });
    return setting?.value;
  }

  /**
   * Update or create a setting
   */
  async setSetting(
    organizationId: string,
    key: string,
    value: any,
    categoryName: string,
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const category = await this.prisma.settingsCategory.findFirst({
      where: { organizationId, name: categoryName },
    });

    const now = new Date();

    if (category) {
      let setting;
      if (key) {
        setting = await this.prisma.setting.findFirst({
          where: { organizationId, key, settingCategoryId: category.id },
        });
      }

      if (setting) {
        // Update existing setting
        const oldValue = setting.value;
        setting = await this.prisma.setting.update({
          where: { id: setting.id },
          data: { value, updatedAt: now },
        });
        
        // Log the change
        await this.prisma.settingsAuditLog.create({
          data: {
            organizationId,
            actorUserId: userId,
            action: 'updated',
            settingKey: key,
            oldValue,
            newValue: value,
            ipAddress,
            userAgent,
          },
        });
      } else {
        // Create new setting
        setting = await this.prisma.setting.create({
          data: {
            key,
            value,
            organizationId,
            settingCategoryId: category.id,
          },
        });

        // Log the creation
        await this.prisma.settingsAuditLog.create({
          data: {
            organizationId,
            actorUserId: userId,
            action: 'created',
            settingKey: key,
            newValue: value,
            ipAddress,
            userAgent,
          },
        });
      }
      return setting;
    } else {
      // Create category first
      await this.prisma.settingsCategory.create({
        data: {
          name: categoryName,
          organizationId,
        },
      });

      // Now create the setting
      setting = await this.prisma.setting.create({
        data: {
          key,
          value,
          organizationId,
          settingCategoryId: null, // Will be updated or handled
        },
      });

      // Log the creation
      await this.prisma.settingsAuditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          action: 'created',
          settingKey: key,
          newValue: value,
          ipAddress,
          userAgent,
        },
      });
    }

    return setting;
  }

  /**
   * Delete a setting
   */
  async deleteSetting(organizationId: string, key: string, userId: string, ipAddress?: string, userAgent?: string) {
    const setting = await this.prisma.setting.findFirst({
      where: { organizationId, key },
    });

    if (!setting) {
      return null;
    }

    const oldValue = setting.value;

    await this.prisma.setting.delete({
      where: { id: setting.id },
    });

    // Log the deletion
    await this.prisma.settingsAuditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        action: 'deleted',
        settingKey: key,
        oldValue,
        ipAddress,
        userAgent,
      },
    });

    return { deleted: true, oldValue };
  }

  /**
   * Get audit log for settings changes
   */
  async getSettingsAuditLog(
    organizationId: string,
    settingKey?: string,
    limit = 50,
    offset = 0,
  ) {
    const where = {
      organizationId,
      ...(settingKey && { settingKey }),
    };

    return this.prisma.settingsAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        organization: true,
      },
    });
  }

  /**
   * Get all categories
   */
  async getCategories(organizationId: string) {
    return this.prisma.settingsCategory.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a new category
   */
  async createCategory(
    organizationId: string,
    name: string,
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const category = await this.prisma.settingsCategory.create({
      data: {
        name,
        organizationId,
      },
    });

    // Log the creation
    await this.prisma.settingsAuditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        action: 'category_created',
        settingKey: name,
        ipAddress,
        userAgent,
      },
    });

    return category;
  }

  /**
   * Delete a category
   */
  async deleteCategory(organizationId: string, name: string, userId: string, ipAddress?: string, userAgent?: string) {
    const category = await this.prisma.settingsCategory.findFirst({
      where: { organizationId, name },
    });

    if (!category) {
      return null;
    }

    // First delete all settings in this category
    await this.prisma.setting.deleteMany({
      where: { organizationId, settingCategoryId: category.id },
    });

    await this.prisma.settingsCategory.delete({
      where: { id: category.id },
    });

    // Log the deletion
    await this.prisma.settingsAuditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        action: 'category_deleted',
        settingKey: name,
        ipAddress,
        userAgent,
      },
    });

    return { deleted: true };
  }
}
