// api/src/modules/people/portal/portal-catalog.service.ts
//
// OS CATÁLOGOS DO ASSISTENTE DE REQUISIÇÃO — clientes, tintas e tipos de tinta.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ESTAS ROTAS EXISTEM, E POR QUE NÃO SERVEM AS INTERNAS
// ─────────────────────────────────────────────────────────────────────────────
// O assistente de requisição (`POST /cliente/me/orcamentos`) tem três comboboxes
// — "Cliente", "Faturar Para" e "Cor de pintura" — e mais um seletor de tipo de
// tinta dentro do "cadastrar cor". Nenhum deles tinha rota. O web fez o que dava
// para fazer sem inventar contrato: `solicitacao-api.ts` chama estes três
// endereços e, em qualquer falha, devolve LISTA VAZIA — a tela continua de pé
// oferecendo só "Cadastrar cliente" / "Cadastrar cor". Hoje ela oferece só isso
// sempre, porque as rotas nunca existiram.
//
// ⛔ As internas (`GET /customers`, `GET /paints`) NÃO servem, e não é questão
// de conveniência: elas vão pelo `apiClient` do FUNCIONÁRIO. Chamá-las do portal
// mandaria o bearer do funcionário logado na mesma máquina — e, no 401,
// derrubaria a sessão dele. Além disso `GET /customers` não é escopado por
// ninguém: devolveria o cadastro inteiro da Ankaa a um contato de cliente.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE CADA CATÁLOGO ESCOPA — e o que não tem o que escopar
// ─────────────────────────────────────────────────────────────────────────────
// CLIENTES é dado de terceiro e é ESCOPADO, pelas mesmas três ideias do §3:
// a minha empresa, quem é dono de um veículo que eu vejo, e quem paga um
// orçamento que eu vejo. É essa terceira que faz o caso Furgões funcionar nos
// dois sentidos — o contato da Ibiporã precisa achar a RKO para dizer de quem é
// o implemento, e o contato da RKO precisa achar a Ibiporã para dizer quem paga.
//
// TINTAS e TIPOS DE TINTA são CATÁLOGO DA ANKAA, sem dono: não há `customerId`
// em `Paint` nem em `PaintType`, e a mesma cor atende clientes diferentes. Não
// há escopo a aplicar, e inventar um ("as tintas dos meus veículos") esconderia
// justamente as cores que o cliente ainda não usou — que são as que ele está ali
// para escolher.
//
// ⚠️ NUNCA `@UserId()`, nunca `request.user`. `PaintService.create` é chamado com
// `userId` INDEFINIDO, exatamente como em `portal-request.service.ts`: o id de um
// `Responsible` em coluna FK de `User` é o acidente que o portal inteiro existe
// para não repetir.

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PaintService } from '@modules/paint/paint.service';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import { PortalScopeService } from './portal-scope.service';
import type { PortalNovaTintaFormData } from '@/schemas/portal-request';

export interface PortalCatalogQuery {
  page?: number;
  take?: number;
  searchingFor?: string;
}

/** O envelope de sempre — `{ success, message, data, meta }` (contrato §4). */
interface PortalCatalogMeta {
  totalRecords: number;
  page: number;
  take: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** O cliente, no recorte que o combobox do portal mostra. */
export interface PortalCustomerOption {
  id: string;
  fantasyName: string | null;
  corporateName: string | null;
  cnpj: string | null;
  cpf: string | null;
}

export interface PortalPaintOption {
  id: string;
  name: string | null;
  hex: string | null;
  finish: string | null;
  paintType: { id: string; name: string | null } | null;
}

export interface PortalPaintTypeOption {
  id: string;
  name: string | null;
}

/**
 * O teto do catálogo de TIPOS.
 *
 * Os tipos de tinta são uma dúzia e não crescem; a lista sai inteira numa
 * consulta e o combobox não pagina. O teto existe mesmo assim — uma lista sem
 * `take` é uma tabela inteira esperando ficar grande.
 */
const MAXIMO_TIPOS_DE_TINTA = 100;

@Injectable()
export class PortalCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScopeService,
    private readonly paints: PaintService,
  ) {}

  private paginate(query?: PortalCatalogQuery | null): { skip: number; take: number; page: number } {
    const take = Math.min(Math.max(Number(query?.take) || 20, 1), 100);
    const page = Math.max(Number(query?.page) || 1, 1);
    return { skip: (page - 1) * take, take, page };
  }

  private meta(totalRecords: number, page: number, take: number): PortalCatalogMeta {
    const totalPages = Math.max(Math.ceil(totalRecords / take), 1);
    return {
      totalRecords,
      page,
      take,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/clientes
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * OS CLIENTES QUE ESTE CONTATO PODE APONTAR — escopados.
   *
   * (a) a MINHA empresa. Sempre, e mesmo que ela ainda não tenha veículo nenhum:
   *     é a primeira requisição de um cliente novo, e sem isto o combobox
   *     nasceria vazio justamente para quem mais precisa dele.
   * (b) quem é DONO de um veículo que eu já vejo (`taskScopeWhere`).
   * (c) quem PAGA um orçamento que eu já vejo (`budgetScopeWhere`, pelo
   *     pagador) — o outro lado do caso Furgões.
   *
   * ⚠️ Os três são `OR`, e nenhum é `{}`. Um ramo vazio devolveria o cadastro de
   * clientes inteiro da Ankaa a um contato de cliente.
   */
  async listCustomers(principal: ResponsiblePrincipal, query?: PortalCatalogQuery | null) {
    // `assertScoped` continua sendo chamado aqui, e de propósito: ele é a
    // RECUSA do contato sem empresa. `customerScopeWhere` também o chama,
    // mas depender disso deixaria a guarda a um refactor de distância.
    this.scope.assertScoped(principal);
    const { skip, take, page } = this.paginate(query);

    // O predicado mora em `PortalScopeService.customerScopeWhere` — a MESMA
    // pergunta que a requisição faz ao validar o `customerId` e o pagador que
    // recebe. Duas cópias divergiriam no primeiro conserto, e foi exatamente
    // essa divergência que deixou a lista escopada e a escrita aberta.
    const alcance = this.scope.customerScopeWhere(principal);

    const filtros: Prisma.CustomerWhereInput[] = [alcance];
    const termo = query?.searchingFor?.trim();
    if (termo) {
      // Os dígitos do documento também entram: o cliente procura "11.222.333"
      // e o banco guarda `11222333000181`. Sem isto a busca por CNPJ nunca acha.
      const digitos = termo.replace(/\D/g, '');
      filtros.push({
        OR: [
          { fantasyName: { contains: termo, mode: 'insensitive' } },
          { corporateName: { contains: termo, mode: 'insensitive' } },
          ...(digitos
            ? [
                { cnpj: { contains: digitos } } as Prisma.CustomerWhereInput,
                { cpf: { contains: digitos } } as Prisma.CustomerWhereInput,
              ]
            : []),
        ],
      });
    }

    const where: Prisma.CustomerWhereInput = { AND: filtros };

    const [totalRecords, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: [{ fantasyName: 'asc' }],
        skip,
        take,
        // ⛔ ALLOWLIST. O cadastro de cliente tem endereço, telefone, e-mail,
        // inscrições e tags; o combobox precisa do nome e do documento para
        // desambiguar homônimos, e mais nada.
        select: {
          id: true,
          fantasyName: true,
          corporateName: true,
          cnpj: true,
          cpf: true,
        },
      }),
    ]);

    const data: PortalCustomerOption[] = rows.map(c => ({
      id: c.id,
      fantasyName: c.fantasyName ?? null,
      corporateName: c.corporateName ?? null,
      cnpj: c.cnpj ?? null,
      cpf: c.cpf ?? null,
    }));

    return {
      success: true,
      message: 'Clientes carregados com sucesso.',
      data,
      meta: this.meta(totalRecords, page, take),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/tintas
  // ═════════════════════════════════════════════════════════════════════════

  /** O catálogo de cores. Sem escopo — ver o cabeçalho. */
  async listPaints(principal: ResponsiblePrincipal, query?: PortalCatalogQuery | null) {
    // A guarda continua valendo mesmo sem escopo a aplicar: contato sem empresa
    // não navega o portal, e deixá-lo passar aqui criaria a única rota de
    // `/cliente/me/*` que responde a ele.
    this.scope.assertScoped(principal);
    const { skip, take, page } = this.paginate(query);

    const termo = query?.searchingFor?.trim();
    const where: Prisma.PaintWhereInput = termo
      ? {
          OR: [
            { name: { contains: termo, mode: 'insensitive' } },
            { code: { contains: termo, mode: 'insensitive' } },
            { hex: { contains: termo, mode: 'insensitive' } },
          ],
        }
      : {};

    const [totalRecords, rows] = await Promise.all([
      this.prisma.paint.count({ where }),
      this.prisma.paint.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take,
        // ⛔ ALLOWLIST. Nada de `formulas` — a fórmula é a receita da Ankaa, e é
        // o ativo industrial da casa; `PaintFormula` não tem o que fazer num
        // seletor de cor do cliente.
        select: {
          id: true,
          name: true,
          hex: true,
          finish: true,
          paintType: { select: { id: true, name: true } },
        },
      }),
    ]);

    const data: PortalPaintOption[] = rows.map(p => ({
      id: p.id,
      name: p.name ?? null,
      hex: p.hex ?? null,
      finish: (p.finish as string) ?? null,
      paintType: p.paintType ? { id: p.paintType.id, name: p.paintType.name ?? null } : null,
    }));

    return {
      success: true,
      message: 'Tintas carregadas com sucesso.',
      data,
      meta: this.meta(totalRecords, page, take),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/tipos-de-tinta
  // ═════════════════════════════════════════════════════════════════════════

  /** Os tipos, para o `paintTypeId` do "cadastrar cor". */
  async listPaintTypes(principal: ResponsiblePrincipal) {
    this.scope.assertScoped(principal);

    const rows = await this.prisma.paintType.findMany({
      orderBy: [{ name: 'asc' }],
      take: MAXIMO_TIPOS_DE_TINTA,
      select: { id: true, name: true },
    });

    const data: PortalPaintTypeOption[] = rows.map(t => ({ id: t.id, name: t.name ?? null }));

    return {
      success: true,
      message: 'Tipos de tinta carregados com sucesso.',
      data,
      meta: { totalRecords: data.length, take: MAXIMO_TIPOS_DE_TINTA },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // POST /cliente/me/tintas
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * CADASTRAR UMA COR PELO PORTAL.
   *
   * ⛔ POR QUE NÃO SE REDIRECIONA PARA `POST /paints`. Aquela rota é
   * `@Roles(WAREHOUSE, ADMIN, COMMERCIAL, FINANCIAL)` — privilégio de
   * FUNCIONÁRIO, lido de `request.user`. Um contato do portal chegando nela é um
   * 403 garantido, e era exatamente isso que acontecia com o "criar uma cor se
   * não tiver salvo" que o dono pediu: o botão existia e a rota recusava.
   *
   * ⚠️ REUSA `PaintService.create`, e não um `prisma.paint.create` à mão — o
   * mesmo motivo já escrito em `portal-request.service.ts`: o caminho do serviço
   * é o que roda `paintValidation` (duplicidade e tipo inexistente). Uma escrita
   * direta faria o portal ser a única porta por onde entra tinta repetida.
   *
   * ⚠️ E `userId` vai INDEFINIDO. O ator aqui é um `Responsible`; o id dele em
   * coluna de `User` é P2025 na melhor hipótese e auditoria mentirosa na pior.
   */
  async createPaint(principal: ResponsiblePrincipal, dados: PortalNovaTintaFormData) {
    this.scope.assertScoped(principal);

    const criada = await this.paints.create(
      {
        name: dados.name,
        hex: dados.hex,
        finish: dados.finish,
        paintTypeId: dados.paintTypeId,
        tags: [],
      } as any,
      undefined,
      // ⚠️ SEM userId — ver a nota acima.
      undefined,
    );

    const id = criada?.data?.id;
    if (!id) {
      throw new InternalServerErrorException('Não foi possível cadastrar a tinta informada.');
    }

    // Relê pelo MESMO `select` da listagem: a resposta de `PaintService.create`
    // traz o registro inteiro (inclusive relações que o portal não expõe), e
    // devolvê-la crua seria o vazamento por espalhamento que o projetor do
    // portal existe para não cometer.
    const row = await this.prisma.paint.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        hex: true,
        finish: true,
        paintType: { select: { id: true, name: true } },
      },
    });

    const data: PortalPaintOption = {
      id,
      name: row?.name ?? dados.name,
      hex: row?.hex ?? dados.hex,
      finish: (row?.finish as string) ?? dados.finish,
      paintType: row?.paintType ? { id: row.paintType.id, name: row.paintType.name ?? null } : null,
    };

    return { success: true, message: 'Tinta cadastrada com sucesso.', data };
  }
}
