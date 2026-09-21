// api/src/modules/production/budget/budget.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Header,
  Req,
  Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { BudgetService } from './budget.service';
import { BudgetReceiptService } from './budget-receipt.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId, User } from '@modules/common/auth/decorators/user.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { SECTOR_PRIVILEGES, TASK_QUOTE_STATUS } from '@constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  budgetCreateSchema,
  budgetUpdateSchema,
  budgetGetManySchema,
  budgetQuerySchema,
  budgetMergeSchema,
  customerConfigOrderNumberSchema,
} from '@schemas/budget';
import type {
  BudgetCreateFormData,
  BudgetUpdateFormData,
  BudgetGetManyFormData,
  BudgetMergeFormData,
  CustomerConfigOrderNumberFormData,
} from '@schemas/budget';

/**
 * Controller for Budget endpoints
 * Handles HTTP requests for quote management
 *
 * Access Control:
 * - COMMERCIAL: Can create, edit, view all quotes, and do commercial approval
 * - FINANCIAL: Can view all, do financial verification and billing approval
 * - ADMIN: Full access to everything
 */
// A rota canônica é `/budgets`. `/task-quotes` fica como ALIAS no MESMO
// handler porque o app instalado em campo ainda chama o caminho antigo — um
// binário que ninguém pode forçar a atualizar. Remover o alias derruba o app.
@Controller(['budgets', 'task-quotes'])
export class BudgetController {
  constructor(
    private readonly budgetService: BudgetService,
    private readonly budgetReceiptService: BudgetReceiptService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * GET /task-quotes
   * List all quotes with filtering and pagination
   *
   * Query params:
   * - page, limit (pagination)
   * - status (filter by status)
   * - taskId (filter by task)
   * - searchingFor (search in items)
   */
  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findMany(
    @Query(new ZodQueryValidationPipe(budgetGetManySchema))
    query: BudgetGetManyFormData,
  ) {
    return this.budgetService.findMany(query);
  }

  /**
   * GET /task-quotes/suggest
   * Find the most recent quote matching task name, customer, truck category, and implement type.
   * Used to pre-fill services when creating a new budget.
   *
   * Query params: name, customerId, category, implementType (all required)
   */
  @Get('suggest')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async findSuggestion(
    @Query('name') name: string,
    @Query('customerId') customerId: string,
    @Query('category') category: string,
    @Query('implementType') implementType: string,
  ) {
    if (!name || !customerId || !category || !implementType) {
      throw new BadRequestException(
        'Todos os campos são obrigatórios: name, customerId, category, implementType.',
      );
    }
    return this.budgetService.findSuggestion({ name, customerId, category, implementType });
  }

  /**
   * GET /task-quotes/:id
   * Get single quote by ID
   */
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findUnique(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(budgetQuerySchema)) query: any,
  ) {
    return this.budgetService.findUnique(id, query.include);
  }

  /**
   * GET /task-quotes/task/:taskId
   * Get quote for specific task
   */
  @Get('task/:taskId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findByTaskId(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.budgetService.findByTaskId(taskId);
  }

  /**
   * POST /task-quotes
   * Create new quote
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(budgetCreateSchema))
    data: BudgetCreateFormData,
    @UserId() userId: string,
  ) {
    return this.budgetService.create(data, userId);
  }

  /**
   * PUT /task-quotes/:id
   * Update existing quote
   *
   * Access: FINANCIAL, COMMERCIAL, ADMIN
   * Explicit status changes are role-gated per stage inside the service
   * (same roles as the dedicated /status endpoints).
   */
  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(budgetUpdateSchema))
    data: BudgetUpdateFormData,
    @UserId() userId: string,
    @User('role') userPrivilege: string,
  ) {
    return this.budgetService.update(id, data, userId, false, userPrivilege);
  }

  /**
   * PUT /task-quotes/:id/status
   * Update quote status
   *
   * Access: FINANCIAL, ADMIN, COMMERCIAL
   *
   * ⚠️ Aqui só passam estados do ORÇAMENTO. Aprovar cobrança deixou de ser um
   * status deste endpoint e virou `PUT /billings/:id/approve` — inclusive a
   * permissão, que lá é `@Roles(ADMIN, FINANCIAL)` na porta.
   */
  @Put(':id/status')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    // O MOTIVO CHEGA — e agora é lido.
    //
    // A tela manda `{ status, reason }` desde sempre (`budgetService.reject` e
    // o diálogo de recusa, que EXIGE cinco caracteres antes de liberar o botão),
    // e este controller só lia `status`. O motivo digitado pelo operador morria
    // na borda: a trilha registrava "Campo Status atualizado" e mais nada, de
    // modo que uma reprovação de orçamento não dizia por quê.
    @Body('reason') reason: string | undefined,
    @UserId() userId: string,
    @Req() req: Request,
  ) {
    const validStatuses = Object.values(TASK_QUOTE_STATUS);
    if (!validStatuses.includes(status as any)) {
      throw new BadRequestException('Status inválido');
    }

    // O RAMO QUE APROVAVA FATURAMENTO SAIU DAQUI.
    //
    // Mandar `status: 'BILLING_APPROVED'` neste endpoint disparava
    // `internalApprove` — emitia fatura, NFS-e e boletos por via de um campo de
    // status. Com o faturamento virando entidade isso deixou de fazer sentido:
    // `BILLING_APPROVED` não é estado do orçamento, e a cobrança a aprovar
    // precisa ser IDENTIFICADA, coisa que um status do orçamento não faz num
    // orçamento com várias. O endereço é `PUT /billings/:id/approve`.
    //
    // Chamadas antigas caem no `Status inválido` acima, que é o correto: o valor
    // não existe mais no contrato.
    return this.budgetService.updateStatus(
      id,
      status as TASK_QUOTE_STATUS,
      userId,
      typeof reason === 'string' && reason.trim() ? reason.trim() : undefined,
    );
  }

  /**
   * PUT /task-quotes/:id/budget-approve
   * Commercial approves the budget (PENDING → APPROVED).
   * This is the single commercial approval gate — there is no separate
   * second commercial double-check before billing.
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id/budget-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async budgetApprove(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.budgetService.budgetApprove(id, userId);
  }

  /**
   * PUT /task-quotes/:id/internal-approve
   * Aprova TODAS as cobranças pendentes do orçamento de uma vez.
   *
   * ⚠️ SEM ENDEREÇO, ESTA ROTA FATURA TUDO. Num orçamento de sessenta caminhões
   * cobrados um a um, ela emite as sessenta notas e os sessenta boletos. Era o
   * comportamento silencioso de antes, quando o faturamento não era entidade e
   * "aprovar o faturamento do orçamento" tinha um sentido só — e o app ainda cai
   * nela como fallback quando não tem `billingId` nem `sliceTaskId`.
   *
   * Agora exige `{ "aprovarTudo": true }` no corpo. Não é burocracia: quem quer
   * uma cobrança tem `PUT /billings/:id/approve`, e quem chega aqui sem dizer
   * nada quase sempre queria uma e vai receber sessenta.
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/internal-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async internalApprove(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @Body('aprovarTudo') aprovarTudo?: boolean,
  ) {
    // ⚠️ A CONFIRMAÇÃO SÓ FAZ SENTIDO QUANDO HÁ O QUE DESAMBIGUAR.
    //
    // Exigi-la sempre foi erro meu: com UMA cobrança pendente, "aprovar tudo" e
    // "aprovar esta" são o mesmo ato, e não há sessenta notas para sair por
    // engano. O app cai nesta rota justamente no caso de fatura única e de
    // veículo único — `_billingSliceTaskId` devolve nulo nos dois — e passou a
    // levar 400 no fluxo mais comum que existe.
    //
    // A pergunta certa é sobre a PLURALIDADE, e ela é do serviço, não da rota.
    const pendentes = await this.budgetService.countPendingBillings(id);
    if (pendentes > 1 && aprovarTudo !== true) {
      throw new BadRequestException(
        `Este orçamento tem ${pendentes} cobranças pendentes, e esta rota aprovaria TODAS. ` +
          'Para aprovar uma, use PUT /billings/:id/approve. Para aprovar as ' +
          `${pendentes} mesmo, mande { "aprovarTudo": true }.`,
      );
    }
    return this.budgetService.internalApprove(id, userId);
  }

  /**
   * PUT /task-quotes/:id/internal-approve/:taskId
   * Aprova o faturamento de UM VEÍCULO de um orçamento que cobra veículo a
   * veículo (`billingSplit = PER_TASK`).
   *
   * POR QUE UMA ROTA SEPARADA e não um parâmetro opcional na de cima: são
   * privilégios idênticos mas atos diferentes, e a distinção precisa aparecer na
   * trilha de acesso. "Faturei o orçamento inteiro" e "faturei o caminhão 37"
   * não podem chegar ao log como a mesma linha.
   *
   * Os sessenta caminhões do Marquespan não terminam no mesmo dia: cada
   * aprovação emite a fatura, a NFS-e e os boletos daquele veículo com o
   * vencimento contado dali. O orçamento só grava `billingApprovedAt` quando a
   * última fatia fecha.
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/internal-approve/:taskId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async internalApproveSlice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UserId() userId: string,
  ) {
    return this.budgetService.internalApprove(id, userId, taskId);
  }

  /**
   * PUT /task-quotes/:id/revert-billing
   * Revert billing approval back to BUDGET_APPROVED — requires all bank slips and NFS-e cancelled.
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/revert-billing')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async revertBillingApproval(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.budgetService.revertBillingApproval(id, userId);
  }

  /**
   * GET /task-quotes/:id/receipt
   * Recibo de quitação (PDF) — só existe depois que o orçamento chega a SETTLED.
   * Pensado para o último passo do wizard de faturamento (Resumo/Revisão final).
   *
   * Access: FINANCIAL, COMMERCIAL, ADMIN
   */
  @Get(':id/receipt')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async downloadReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.budgetReceiptService.generate(id);
    // Nome tem razão social do cliente — pode ter acento. filename= puro (sem
    // RFC 5987) quebra em runtimes que validam o header como Latin-1/ASCII.
    const asciiFallback =
      filename
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '_') || 'recibo.pdf';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SIMPLIFICAR ORÇAMENTO — N orçamentos de 1 veículo viram 1 de N veículos
  //
  // Recebe TAREFAS, não orçamentos, porque é assim que a tela seleciona: na
  // Agenda e no Cronograma a linha é um veículo. A deduplicação por orçamento é
  // do serviço — selecionar os quatro veículos de um orçamento de quatro é
  // inofensivo e não conta como quatro candidatos.
  //
  // ADMIN e COMERCIAL: a união é um ato COMERCIAL (juntar propostas do mesmo
  // negócio num documento só), não financeiro. O financeiro não emite orçamento.
  //
  // ⚠️ `merge` é um SEGMENTO LITERAL num controller cheio de `:id`. Hoje não há
  // `@Post(':id')` registrado, então nada o sombreia — mas o Nest casa por ordem
  // de registro dentro do controller, e um `@Post(':id')` acrescentado ACIMA
  // destas linhas engoliria `POST /task-quotes/merge` sem erro nenhum, só um 400
  // de UUID inválido. Se isso for preciso um dia, estas duas rotas sobem para
  // antes dele.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * POST /task-quotes/merge/preview — julga sem escrever.
   *
   * Obrigatório antes do botão: a tela de Agenda não carrega o que decide "são
   * iguais" (lista de serviços, desconto, condições de pagamento), então sem
   * esta rota o diálogo adivinharia.
   */
  @Post('merge/preview')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  async previewMerge(
    @Body(new ZodValidationPipe(budgetMergeSchema)) body: BudgetMergeFormData,
  ) {
    return this.budgetService.previewMergeQuotes(body.taskIds);
  }

  /** POST /task-quotes/merge — executa. Julga de novo por dentro. */
  @Post('merge')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  async merge(
    @Body(new ZodValidationPipe(budgetMergeSchema)) body: BudgetMergeFormData,
    @UserId() userId: string,
  ) {
    return this.budgetService.mergeQuotes(body.taskIds, userId, {
      billingSplit: body.billingSplit ?? null,
    });
  }

  /**
   * PATCH /task-quotes/:id/customer-config-order-number
   * Update only the orderNumber field on a CustomerConfig.
   * Safe to call on locked quotes (BILLING_APPROVED+) — skips the financial obligation guard
   * because orderNumber is metadata used in NFS-e discriminacao, not a financial value.
   *
   * Access: FINANCIAL, COMMERCIAL, ADMIN
   */
  @Patch(':id/customer-config-order-number')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  async updateCustomerConfigOrderNumber(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(customerConfigOrderNumberSchema))
    body: CustomerConfigOrderNumberFormData,
  ) {
    // `customerId` deixou de ser obrigatório e `taskId` entrou: o número do
    // pedido é do VEÍCULO desde a migração `20260909170000`, e num orçamento de
    // sessenta caminhões escrever nos sessenta a cada edição é o defeito que a
    // mudança de dono existe para acabar. Sem `taskId` o comportamento antigo
    // (todos) é mantido — é o que o app instalado pede.
    //
    // ⚠️ A exigência de um dos dois mora no zod agora, junto com o resto: esta
    // era a única rota de escrita do módulo com `@Body()` cru, e a validação à
    // mão cobria só essa regra — não o tipo, não o tamanho, não o formato dos
    // ids.
    return this.budgetService.updateCustomerConfigOrderNumber(
      id,
      body.customerId ?? null,
      body.orderNumber ?? null,
      body.taskId ?? null,
    );
  }

  /**
   * DELETE /task-quotes/:id
   * Delete quote
   *
   * Access: ADMIN only
   */
  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.budgetService.delete(id, userId);
  }

  /**
   * GET /task-quotes/expired/list
   * Get all expired quotes
   *
   * Access: FINANCIAL, ADMIN
   */
  @Get('expired/list')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findExpired() {
    const expired = await this.budgetService.findAndMarkExpired();
    return {
      success: true,
      data: expired,
      message: `${expired.length} orçamentos expirados encontrados.`,
    };
  }

  // =====================
  // PUBLIC ENDPOINTS (No Authentication Required)
  // =====================

  /**
   * GET /task-quotes/public/:id
   * Get quote for public view (customer budget page)
   * - For authenticated users: returns quote even if expired
   * - For non-authenticated users: only returns if not expired
   *
   * Access: PUBLIC (authentication optional)
   */
  @Get('public/:id')
  @Public()
  // Belt-and-suspenders cache busting — public dossier/budget data must always be
  // 100% fresh because customers see it through long-lived shareable links and
  // any intermediate proxy/CDN must NEVER cache the body.
  @Header(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate, private',
  )
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @Header('Surrogate-Control', 'no-store')
  @Header('Vary', '*')
  async findPublic(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    // Check if user is authenticated (optional auth)
    let isAuthenticated = false;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_SECRET,
        });
        // Conferir a ASSINATURA nao basta: qualquer JWT emitido com `JWT_SECRET`
        // passava aqui, e ate 17/09 o login de responsavel assinava com essa
        // mesma chave — um contato de cliente destravava orcamento VENCIDO de
        // qualquer UUID. Aquele assinador foi removido; esta checagem e' a
        // segunda tranca, para que a rota nunca mais confie so no segredo.
        //
        // "Autenticado" aqui significa FUNCIONARIO, e funcionario tem `sub`
        // (auth.service.ts assina `{ sub, email, phone, role }`). Um token de
        // outro sujeito nao tem, e se um dia tiver, carregara `type`.
        isAuthenticated =
          typeof payload?.sub === 'string' &&
          payload.sub.length > 0 &&
          (payload.type === undefined || payload.type === 'user');
      } catch {
        // Invalid token, treat as unauthenticated
      }
    }

    return this.budgetService.findPublic(id, isAuthenticated);
  }

  /**
   * POST /task-quotes/public/:id/signature
   * Upload customer signature for quote
   *
   * Access: PUBLIC (no authentication required). There is no dedicated share
   * token — the unguessable quote UUID is the link capability (same as
   * GET public/:id). The service therefore enforces the strongest available
   * checks: the quote must NOT be expired and must be in a signature-pending
   * status (PENDING or BUDGET_APPROVED); uploads are rejected otherwise.
   */
  @Post('public/:id/signature')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('signature', multerConfig))
  async uploadPublicSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('customerConfigId') customerConfigId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo de assinatura é obrigatório.');
    }

    // Validate file type (only images allowed for signatures)
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo inválido. Apenas imagens PNG, JPEG ou WebP são permitidas.',
      );
    }

    return this.budgetService.uploadCustomerSignature(id, file, customerConfigId);
  }
}
