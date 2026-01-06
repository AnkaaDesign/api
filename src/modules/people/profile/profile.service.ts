import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import { UserService } from '../user/user.service';
import type { UserGetUniqueResponse, UserUpdateResponse, User } from '../../../types';
import type { UserUpdateFormData } from '../../../schemas/user';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Get current user profile with avatar
   */
  async getProfile(userId: string): Promise<UserGetUniqueResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        avatar: true,
        position: true,
        sector: true,
        managedSector: true,
        ppeSize: true,
        preference: true,
        notificationPreferences: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return {
      success: true,
      message: 'Perfil obtido com sucesso',
      data: user as User,
    };
  }

  /**
   * Update current user profile
   */
  async updateProfile(userId: string, data: UserUpdateFormData): Promise<UserUpdateResponse> {
    // Use the existing user service update method
    // but only allow updating certain fields for profile
    const allowedFields: Partial<UserUpdateFormData> = {
      email: data.email,
      phone: data.phone,
      address: data.address,
      addressNumber: data.addressNumber,
      addressComplement: data.addressComplement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      zipCode: data.zipCode,
      password: data.password, // Allow password change
    };

    return this.userService.update(
      userId,
      allowedFields,
      { avatar: true, position: true, sector: true, ppeSize: true },
      userId,
    );
  }

  /**
   * Upload user avatar photo
   * Stores in storage: Colaboradores/{userName}/avatar.ext
   */
  async uploadPhoto(userId: string, photo: Express.Multer.File): Promise<UserUpdateResponse> {
    this.logger.log(`Uploading avatar for user ${userId}`);

    // Get user to access the name for folder organization
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    try {
      // Delete old avatar if exists
      if (user.avatarId && user.avatar) {
        this.logger.log(`Deleting old avatar file: ${user.avatar.id}`);
        await this.fileService.delete(user.avatar.id, userId);
      }

      // Upload new avatar file using FileService
      // This will store it in: /srv/files/Colaboradores/{userName}/avatar.ext
      const uploadedFile = await this.fileService.createFromUpload(
        photo,
        undefined, // No includes needed for File entity
        userId,
        {
          fileContext: 'userAvatar', // storage folder context
          entityId: userId,
          entityType: 'user',
          userName: user.name, // Used for folder organization: Colaboradores/{userName}/
        },
      );

      this.logger.log(`Avatar file uploaded: ${uploadedFile.data.id}`);

      // Update user with new avatar
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          avatarId: uploadedFile.data.id,
        },
        include: {
          avatar: true,
          position: true,
          sector: true,
          ppeSize: true,
        },
      });

      this.logger.log(`User avatar updated successfully for user ${userId}`);

      return {
        success: true,
        message: 'Foto de perfil atualizada com sucesso',
        data: updatedUser as User,
      };
    } catch (error) {
      this.logger.error(`Error uploading avatar for user ${userId}:`, error);
      throw new BadRequestException('Erro ao fazer upload da foto de perfil');
    }
  }

  /**
   * Delete user avatar
   */
  async deletePhoto(userId: string): Promise<UserUpdateResponse> {
    this.logger.log(`Deleting avatar for user ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (!user.avatarId || !user.avatar) {
      throw new BadRequestException('Usuário não possui foto de perfil');
    }

    try {
      // Delete the avatar file
      await this.fileService.delete(user.avatar.id, userId);

      // Update user to remove avatar reference
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          avatarId: null,
        },
        include: {
          avatar: true,
          position: true,
          sector: true,
          ppeSize: true,
        },
      });

      this.logger.log(`User avatar deleted successfully for user ${userId}`);

      return {
        success: true,
        message: 'Foto de perfil removida com sucesso',
        data: updatedUser as User,
      };
    } catch (error) {
      this.logger.error(`Error deleting avatar for user ${userId}:`, error);
      throw new BadRequestException('Erro ao remover foto de perfil');
    }
  }
}
