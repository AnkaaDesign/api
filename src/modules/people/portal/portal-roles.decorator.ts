// api/src/modules/people/portal/portal-roles.decorator.ts
//
// O PORTÃO DA AÇÃO — `@PortalCapability(...)`.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE UM IRMÃO DE `@ResponsibleRoles()`, E NÃO UMA EXTENSÃO DELE
// ─────────────────────────────────────────────────────────────────────────────
// `@ResponsibleRoles()` já existe (`responsible-auth.decorators.ts:68`), já é
// lido pela guarda global (`responsible-auth.guard.ts:128-140`) e tem ZERO call
// sites nos dois repositórios. A tentação é usá-lo direto e acabar:
//
//     @ResponsibleRoles('COMMERCIAL', 'SELLER', 'REPRESENTATIVE', 'COORDINATOR')
//     @Put(':id/aprovar-valor')
//
// O problema dessa linha não é o que ela faz — é que ela é a MESMA lista em
// quatro rotas, escrita à mão, e na quinta alguém esquece `COORDINATOR`. O
// eixo de privilégio vira 4 cópias de um dado, e as cópias divergem sem que
// nada quebre: o contato coordenador simplesmente para de conseguir aprovar,
// num endpoint só, e ninguém descobre até ele ligar.
//
// `@PortalCapability(APPROVE_VALUE)` diz o que a rota FAZ. Quem exerce a ação é
// dado (`ROLE_CAPABILITIES`), mora num arquivo só, e é a tabela do contrato §2.1
// transcrita. Trocar quem pré-aprova passa a ser uma linha, não uma varredura.
//
// ⛔ E NÃO SE SUBSTITUI `@ResponsibleRoles()`: as duas semânticas coexistem de
// propósito. Papel é IDENTIDADE ("quem é este contato"), capacidade é ATO ("o
// que se pode fazer aqui"). Uma rota que exista para um papel específico — e não
// para um ato — continua usando `@ResponsibleRoles()`.
//
// ─────────────────────────────────────────────────────────────────────────────
// COMO ISTO É ENFORÇADO — em DOIS lugares, de propósito
// ─────────────────────────────────────────────────────────────────────────────
// 1. PROJETADO PARA PAPÉIS. O decorador grava também `RESPONSIBLE_ROLES_KEY`
//    com `rolesWithAnyCapability(caps)`. Quem barra é a guarda GLOBAL, que roda
//    em toda rota `@ResponsibleOnly()` e que ninguém pode esquecer de instalar.
//    Esta é a trava ESTRUTURAL: sobrevive a alguém apagar o `@UseGuards` abaixo,
//    a um `PortalModule` não importado, e a um controlador que esqueça tudo
//    menos o decorador.
//
// 2. CHECADO POR CAPACIDADE. `PortalCapabilityGuard` roda depois (o Nest executa
//    globais → controlador → rota) e refaz a pergunta na forma original, com a
//    mensagem que nomeia o ATO. Ela também RECUSA quando `request.responsible`
//    não existe — que é o sintoma de uma rota que ganhou `@PortalCapability`
//    e esqueceu `@ResponsibleOnly()`, caso em que a guarda global do portal
//    cedeu e o `AuthGuard` do funcionário é quem decidiu.
//
// As duas travas leem a MESMA tabela, então não podem divergir — e
// `tests/portal-recorte.test.ts` prova a equivalência para as 5 capacidades e os
// 9 papéis. A segunda existe pela mensagem e pelo caso do `@ResponsibleOnly()`
// esquecido; a primeira é a que segura o prédio.
//
// ⚠️ O guarda é aplicado PELO PRÓPRIO decorador (`applyDecorators(UseGuards(…))`).
// Não há segunda linha a lembrar — que é a lição escrita em
// `responsible-auth.guard.ts:16-21`, onde uma rota marcada sem o `@UseGuards`
// ficava completamente ABERTA.
import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RESPONSIBLE_ROLES_KEY } from '../responsible-auth/responsible-auth.decorators';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import {
  hasAnyCapability,
  PORTAL_CAPABILITY,
  PORTAL_CAPABILITY_LABELS,
  rolesWithAnyCapability,
} from './portal-capabilities';

export const PORTAL_CAPABILITY_KEY = 'portalCapability';

/**
 * A guarda de capacidade. Instalada pelo decorador; nunca escrita à mão.
 *
 * Depende apenas do `Reflector`, que é provider do núcleo do Nest — por isso
 * `@UseGuards(PortalCapabilityGuard)` funciona em qualquer controlador, mesmo
 * que o módulo dele não importe `PortalModule`.
 */
@Injectable()
export class PortalCapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // UNIÃO de classe + handler, como `@Roles()` e `@ResponsibleRoles()`:
    // acumular capacidade ALARGA o portão, nunca o estreita. Dois decoradores
    // empilhados significam "qualquer um destes atos", e não "todos eles" — se
    // um dia for preciso exigir duas capacidades ao mesmo tempo, isso é um
    // decorador novo com nome próprio, não uma mudança silenciosa desta linha.
    const required = this.reflector.getAllAndMerge<PORTAL_CAPABILITY[]>(PORTAL_CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sem exigência não há portão. É o que o reflector devolve quando o
    // decorador não foi usado, e é o caso de toda rota de leitura do portal.
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest();
    const principal: ResponsiblePrincipal | undefined = request?.responsible;

    if (!principal) {
      // A rota exige uma capacidade do portal e não há contato autenticado.
      // Quase sempre é `@ResponsibleOnly()` esquecido no handler: sem a marca, a
      // guarda global do portal CEDE e quem decidiu foi o `AuthGuard` do
      // funcionário — ou seja, um funcionário chegaria aqui com
      // `request.user` preenchido e `request.responsible` vazio.
      //
      // ⛔ Recusar é obrigatório. Deixar passar por "não sei quem é" entregaria
      // a ação a qualquer identidade autenticada, e a API tem ~466 handlers sem
      // `@Roles` que aceitam qualquer uma.
      throw new UnauthorizedException('Esta rota exige uma sessão do portal do cliente.');
    }

    if (hasAnyCapability(principal.roles, required)) return true;

    // A mensagem NOMEIA O ATO, e não o papel que falta. Quem lê é o contato do
    // cliente, que não sabe — e não tem por que saber — que o cadastro dele diz
    // `COORDINATOR`. "Seu perfil não permite pré-aprovar orçamento" ele resolve
    // com o comercial; "papel insuficiente" ele não resolve com ninguém.
    const atos = required.map(c => PORTAL_CAPABILITY_LABELS[c] ?? c).join(' ou ');
    throw new ForbiddenException(
      `Seu perfil de contato não permite ${atos}. Fale com o comercial.`,
    );
  }
}

/**
 * Exige que o contato exerça PELO MENOS UMA das capacidades listadas.
 *
 *     @ResponsibleOnly()
 *     @PortalCapability(PORTAL_CAPABILITY.APPROVE_VALUE)
 *     @Put('orcamentos/:id/aprovar-valor')
 *
 * ⚠️ `@ResponsibleOnly()` continua sendo obrigatório — é ELE que autentica. Este
 * decorador só acrescenta o portão da ação por cima; sem a marca do portal, a
 * guarda de capacidade recusa a requisição inteira (401) em vez de deixá-la
 * passar como funcionário.
 *
 * ⛔ NÃO EMPILHE `@ResponsibleRoles(...)` E `@PortalCapability(...)` NO MESMO
 * HANDLER. Os dois gravam `RESPONSIBLE_ROLES_KEY`, e `SetMetadata` na mesma
 * chave e no mesmo alvo SOBRESCREVE — um dos dois some em silêncio, e qual
 * depende da ordem em que os decoradores foram aplicados. Escolha um eixo por
 * rota: capacidade quando o portão é o ATO, papel quando é a IDENTIDADE. (Nos
 * níveis DIFERENTES — um na classe, outro no handler — não há sobrescrita:
 * `getAllAndMerge` une os dois, o que ALARGA o portão, nunca o estreita.)
 */
export const PortalCapability = (...capabilities: PORTAL_CAPABILITY[]) =>
  applyDecorators(
    SetMetadata(PORTAL_CAPABILITY_KEY, capabilities),
    // A TRAVA ESTRUTURAL: a guarda global já sabe barrar por papel, e roda
    // sempre. Projetar a capacidade para o conjunto de papéis que a exerce faz
    // o portão valer mesmo que tudo o mais desta linha seja removido.
    SetMetadata(RESPONSIBLE_ROLES_KEY, rolesWithAnyCapability(capabilities)),
    UseGuards(PortalCapabilityGuard),
  );
