import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import {
  ReadRateLimit,
  WriteRateLimit,
} from '@modules/common/throttler/throttler.decorators';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { SecullumCadastrosService } from './secullum-cadastros.service';
import {
  SecullumDepartamento,
  SecullumFuncao,
  SecullumAtividade,
  SecullumEmpresa,
  SecullumFuncionarioListItem,
  SecullumFuncionarioFull,
  SecullumFuncionarioCreate,
  SecullumFuncionarioUpsert,
} from './dto';

@Controller('integrations/secullum')
@UseGuards(AuthGuard)
export class SecullumCadastrosController {
  private readonly logger = new Logger(SecullumCadastrosController.name);

  constructor(private readonly cadastros: SecullumCadastrosService) {}

  // -------------------- Departamentos --------------------

  @Get('departamentos')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listDepartamentos(): Promise<SecullumDepartamento[]> {
    return this.cadastros.listDepartamentos();
  }

  @Post('departamentos')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  upsertDepartamento(
    @Body() body: { Id?: number; Descricao: string; Nfolha?: string | null },
    @UserId() userId: string,
  ): Promise<SecullumDepartamento> {
    this.logger.log(
      `User ${userId} upserting Secullum departamento ${body.Id ?? '(new)'}: ${body.Descricao}`,
    );
    return this.cadastros.upsertDepartamento(body);
  }

  @Delete('departamentos/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDepartamento(
    @Param('id', ParseIntPipe) id: number,
    @UserId() userId: string,
  ): Promise<void> {
    this.logger.log(`User ${userId} deleting Secullum departamento ${id}`);
    return this.cadastros.deleteDepartamento(id);
  }

  // -------------------- Funcoes --------------------

  @Get('funcoes')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listFuncoes(): Promise<SecullumFuncao[]> {
    return this.cadastros.listFuncoes();
  }

  @Post('funcoes')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  upsertFuncao(
    @Body() body: { Id?: number; Descricao: string },
    @UserId() userId: string,
  ): Promise<SecullumFuncao> {
    this.logger.log(
      `User ${userId} upserting Secullum funcao ${body.Id ?? '(new)'}: ${body.Descricao}`,
    );
    return this.cadastros.upsertFuncao(body);
  }

  @Delete('funcoes/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFuncao(
    @Param('id', ParseIntPipe) id: number,
    @UserId() userId: string,
  ): Promise<void> {
    this.logger.log(`User ${userId} deleting Secullum funcao ${id}`);
    return this.cadastros.deleteFuncao(id);
  }

  // -------------------- Atividades --------------------

  @Get('atividades')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listAtividades(): Promise<SecullumAtividade[]> {
    return this.cadastros.listAtividades();
  }

  @Post('atividades')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  upsertAtividade(
    @Body()
    body: {
      Id?: number;
      Descricao: string;
      DescricaoAbreviada?: string;
      TipoDeAtividade?: number;
    },
  ): Promise<SecullumAtividade> {
    return this.cadastros.upsertAtividade(body);
  }

  @Delete('atividades/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAtividade(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.cadastros.deleteAtividade(id);
  }

  // -------------------- Justificativas (note batch DELETE) --------------------

  @Post('justificativas')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  upsertJustificativa(
    @Body()
    body: {
      Id?: number;
      NomeAbreviado: string;
      NomeCompleto?: string;
      Ajuste?: boolean;
      Abono2?: boolean;
      Abono3?: boolean;
      Abono4?: boolean;
      Desativado?: boolean;
    },
  ) {
    return this.cadastros.upsertJustificativa(body);
  }

  /**
   * Justificativas use a batch-DELETE convention (different from
   * Departamentos/Funcoes/Atividades). Pass an array of ids in the body.
   */
  @Delete('justificativas')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteJustificativas(@Body() body: number[] | { ids: number[] }) {
    const ids = Array.isArray(body) ? body : body?.ids ?? [];
    return this.cadastros.deleteJustificativas(ids);
  }

  // -------------------- Empresas / Auxiliar --------------------

  @Get('empresas')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listEmpresas(): Promise<SecullumEmpresa[]> {
    return this.cadastros.listEmpresas();
  }

  @Get('motivos-demissao')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listMotivosDemissao() {
    return this.cadastros.listMotivosDemissao();
  }

  @Get('estruturas')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listEstruturas() {
    return this.cadastros.listEstruturas();
  }

  // -------------------- Funcionarios CRUD --------------------

  @Get('funcionarios/lista')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listFuncionarios(): Promise<SecullumFuncionarioListItem[]> {
    return this.cadastros.listFuncionarios();
  }

  @Get('funcionarios-demitidos')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listFuncionariosDemitidos(): Promise<SecullumFuncionarioListItem[]> {
    return this.cadastros.listFuncionariosDemitidos();
  }

  @Get('funcionarios/:id/detalhe')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  getFuncionarioFull(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SecullumFuncionarioFull> {
    return this.cadastros.getFuncionarioFull(id);
  }

  @Post('funcionarios')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  createFuncionario(
    @Body() body: SecullumFuncionarioCreate,
    @UserId() userId: string,
  ): Promise<SecullumFuncionarioFull> {
    this.logger.log(
      `User ${userId} creating Secullum funcionario ${body.Nome} (CPF ${body.Cpf})`,
    );
    return this.cadastros.createFuncionario(body);
  }

  @Put('funcionarios/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  updateFuncionario(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SecullumFuncionarioUpsert,
    @UserId() userId: string,
  ): Promise<SecullumFuncionarioFull> {
    this.logger.log(`User ${userId} updating Secullum funcionario ${id}`);
    return this.cadastros.updateFuncionario(id, body);
  }

  @Post('funcionarios/:id/dismiss')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  dismissFuncionario(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { demissao: string; motivoDemissaoId?: number },
    @UserId() userId: string,
  ): Promise<SecullumFuncionarioFull> {
    this.logger.log(
      `User ${userId} dismissing Secullum funcionario ${id} on ${body.demissao}`,
    );
    return this.cadastros.dismissFuncionario(
      id,
      body.demissao,
      body.motivoDemissaoId,
    );
  }

  @Delete('funcionarios/:id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFuncionario(
    @Param('id', ParseIntPipe) id: number,
    @UserId() userId: string,
  ): Promise<void> {
    this.logger.warn(
      `Admin ${userId} HARD-deleting Secullum funcionario ${id}`,
    );
    return this.cadastros.deleteFuncionario(id);
  }

  // -------------------- Mapping --------------------

  @Get('mapping/departamentos')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async previewDepartamentoMapping() {
    // The actual sector list comes from the SectorService; the controller would
    // normally inject it. Returning the Secullum side only for the matching UI
    // to do client-side join, OR add SectorService dep here.
    return { departamentos: await this.cadastros.listDepartamentos() };
  }

  @Get('mapping/funcoes')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async previewFuncaoMapping() {
    return { funcoes: await this.cadastros.listFuncoes() };
  }

  // -------------------- Horarios (read-only list) --------------------

  @Get('horarios')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  listHorarios() {
    return this.cadastros.listHorarios(false);
  }

  // -------------------- Encerramento de Cálculos (admin only) --------------------

  @Get('encerramentos')
  @ReadRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  listEncerramentos() {
    return this.cadastros.listEncerramentos();
  }

  @Post('encerramentos')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  encerrarCalculos(
    @Body() body: { date: string },
    @UserId() userId: string,
  ) {
    this.logger.warn(
      `Admin ${userId} closing Secullum calculations up to ${body.date}`,
    );
    return this.cadastros.encerrarCalculos(body.date);
  }

  // -------------------- Link Ankaa <-> Secullum --------------------

  /** Link an Ankaa sector to a Secullum departamento (or pass null to unlink). */
  @Post('mapping/sector/:sectorId/departamento')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  linkSectorDepartamento(
    @Param('sectorId') sectorId: string,
    @Body() body: { departamentoId: number | null },
    @UserId() userId: string,
  ) {
    this.logger.log(
      `User ${userId} linking sector ${sectorId} → departamento ${body.departamentoId}`,
    );
    return this.cadastros.linkSectorToDepartamento(
      sectorId,
      body.departamentoId,
    );
  }

  /** Set the default Secullum Horario for a sector (or null to clear). */
  @Post('mapping/sector/:sectorId/horario')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  setSectorHorario(
    @Param('sectorId') sectorId: string,
    @Body() body: { horarioId: number | null },
    @UserId() userId: string,
  ) {
    this.logger.log(
      `User ${userId} setting sector ${sectorId} default horario → ${body.horarioId}`,
    );
    return this.cadastros.setSectorHorario(sectorId, body.horarioId);
  }

  /** Link an Ankaa position to a Secullum função (or pass null to unlink). */
  @Post('mapping/position/:positionId/funcao')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  linkPositionFuncao(
    @Param('positionId') positionId: string,
    @Body() body: { funcaoId: number | null },
    @UserId() userId: string,
  ) {
    this.logger.log(
      `User ${userId} linking position ${positionId} → função ${body.funcaoId}`,
    );
    return this.cadastros.linkPositionToFuncao(positionId, body.funcaoId);
  }
}
