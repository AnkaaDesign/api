import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';

@Injectable()
export class PaintingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll() {
    const [rates, indirects, rules, processParams, paintSystems] = await this.prisma.$transaction([
      this.prisma.paintingProductivityRate.findMany({ orderBy: { label: 'asc' } }),
      this.prisma.paintingIndirectCost.findMany({ orderBy: { label: 'asc' } }),
      this.prisma.paintingStrategyRule.findMany({ orderBy: { position: 'asc' } }),
      this.prisma.paintingProcessParameter.findMany({ include: { paintType: true } }),
      this.prisma.paintingPaintSystem.findMany({
        include: { paintType: true, catalystItem: true, thinnerItem: true },
        orderBy: { position: 'asc' },
      }),
    ]);
    return {
      success: true,
      message: 'Configurações carregadas com sucesso.',
      data: { rates, indirects, rules, processParams, paintSystems },
    };
  }

  async updatePaintSystem(id: string, data: any) {
    const found = await this.prisma.paintingPaintSystem.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Sistema de pintura não encontrado.');
    const updated = await this.prisma.paintingPaintSystem.update({
      where: { id },
      data,
      include: { paintType: true, catalystItem: true, thinnerItem: true },
    });
    return { success: true, message: 'Sistema de pintura atualizado com sucesso.', data: updated };
  }

  async updateRate(id: string, data: any) {
    const found = await this.prisma.paintingProductivityRate.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Taxa não encontrada.');
    const updated = await this.prisma.paintingProductivityRate.update({ where: { id }, data });
    return { success: true, message: 'Taxa atualizada com sucesso.', data: updated };
  }

  async updateIndirect(id: string, data: any) {
    const found = await this.prisma.paintingIndirectCost.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Custo indireto não encontrado.');
    const updated = await this.prisma.paintingIndirectCost.update({ where: { id }, data });
    return { success: true, message: 'Custo indireto atualizado com sucesso.', data: updated };
  }

  async updateRule(id: string, data: any) {
    const found = await this.prisma.paintingStrategyRule.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Regra não encontrada.');
    const updated = await this.prisma.paintingStrategyRule.update({ where: { id }, data });
    return { success: true, message: 'Regra atualizada com sucesso.', data: updated };
  }

  async updateProcessParam(id: string, data: any) {
    const found = await this.prisma.paintingProcessParameter.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Parâmetro de processo não encontrado.');
    const updated = await this.prisma.paintingProcessParameter.update({
      where: { id },
      data,
      include: { paintType: true },
    });
    return { success: true, message: 'Parâmetro atualizado com sucesso.', data: updated };
  }
}
