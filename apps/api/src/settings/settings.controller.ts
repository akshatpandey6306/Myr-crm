import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { OrganizationGuard } from '../auth/org.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('settings')
@UseGuards(AuthGuard, OrganizationGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  /**
   * GET /settings - Get all settings for organization
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getAllSettings(@Req() req: Request) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.getAllSettings(organizationId);
  }

  /**
   * GET /settings/category/:categoryName - Get settings by category
   */
  @Get('category/:categoryName')
  @HttpCode(HttpStatus.OK)
  async getSettingsByCategory(
    @Param('categoryName') categoryName: string,
    @Req() req: Request,
  ) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.getSettingsByCategory(organizationId, categoryName);
  }

  /**
   * GET /settings/:key - Get a specific setting value
   */
  @Get(':key')
  @HttpCode(HttpStatus.OK)
  async getSetting(@Param('key') key: string, @Req() req: Request) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.getSetting(organizationId, key);
  }

  /**
   * PUT /settings - Update or create a setting
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  async setSetting(
    @Body() body: {
      key: string;
      value: any;
      categoryName: string;
    },
    @Req() req: Request,
    @GetUser() userId: string,
  ) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }

    const { key, value, categoryName } = body;
    if (!key) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Setting key is required',
      };
    }

    return this.settingsService.setSetting(
      organizationId,
      key,
      value,
      categoryName,
      userId,
      req.ip,
      req.get('user-agent'),
    );
  }

  /**
   * DELETE /settings/:key - Delete a setting
   */
  @Delete(':key')
  @HttpCode(HttpStatus.OK)
  async deleteSetting(
    @Param('key') key: string,
    @Req() req: Request,
    @GetUser() userId: string,
  ) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.deleteSetting(
      organizationId,
      key,
      userId,
      req.ip,
      req.get('user-agent'),
    );
  }

  /**
   * GET /settings/audit-log - Get settings audit log
   */
  @Get('audit-log')
  @HttpCode(HttpStatus.OK)
  async getSettingsAuditLog(
    @Query('key') key?: string,
    @Query('limit') limit = 50,
    @Query('offset') offset = 0,
    @Req() req: Request,
  ) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.getSettingsAuditLog(
      organizationId,
      key,
      limit,
      offset,
    );
  }

  /**
   * GET /settings/categories - Get all categories
   */
  @Get('categories')
  @HttpCode(HttpStatus.OK)
  async getCategories(@Req() req: Request) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.getCategories(organizationId);
  }

  /**
   * POST /settings/categories - Create a new category
   */
  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  async createCategory(
    @Body('name') name: string,
    @Req() req: Request,
    @GetUser() userId: string,
  ) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.createCategory(
      organizationId,
      name,
      userId,
      req.ip,
      req.get('user-agent'),
    );
  }

  /**
   * DELETE /settings/categories/:name - Delete a category
   */
  @Delete('categories/:name')
  @HttpCode(HttpStatus.OK)
  async deleteCategory(
    @Param('name') name: string,
    @Req() req: Request,
    @GetUser() userId: string,
  ) {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Organization context required',
      };
    }
    return this.settingsService.deleteCategory(
      organizationId,
      name,
      userId,
      req.ip,
      req.get('user-agent'),
    );
  }
}
