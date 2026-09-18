// api/src/modules/people/responsible-auth/responsible-auth.decorators.ts
//
// Os decoradores do portal do cliente. São o espelho de `@Roles()` do
// funcionário, com uma diferença que importa e uma proibição que importa mais.
//
// A DIFERENÇA — privilégio de funcionário é UM valor (`Sector.privileges`), e o
// portão pergunta "é igual a?". Papel de responsável é uma LISTA
// (`Responsible.roles`), e o portão pergunta "tem algum destes?". É a mesma
// semântica de união que `sectionsForRoles()` já usa para decidir qual fatia do
// orçamento cada contato assina — um contato com MARKETING + FINANCIAL recebe a
// união dos dois recortes, não a interseção.
//
// A PROIBIÇÃO — `ResponsibleRole` e `SECTOR_PRIVILEGES` compartilham os literais
// 'COMMERCIAL' e 'FINANCIAL'. São coisas diferentes: um é o comercial DA ANKAA,
// o outro é o contato comercial DO CLIENTE. Nenhum dos dois pode jamais
// satisfazer o portão do outro. Por isso são decoradores, chaves de metadado e
// guardas SEPARADOS — nunca um campo `role` compartilhado. O código antigo já
// tinha tropeçado nisso: o JWT do responsável batizou o claim de `roles` (plural)
// exatamente para o `AuthGuard` não o confundir com `SECTOR_PRIVILEGES`.
import { SetMetadata } from '@nestjs/common';
import type { ResponsibleRole } from '@prisma/client';
import { RESPONSIBLE_ROUTE_KEY } from '@/modules/common/auth/decorators/responsible-route.decorator';

/**
 * Marca uma rota como pertencente ao portal do cliente.
 *
 * Sem esta marca, uma sessão de responsável NÃO entra em lugar nenhum — e isso
 * é estrutural, não uma lista que alguém precisa manter: o token de sessão é
 * OPACO, não um JWT, então `AuthGuard.verifyAccessToken` o rejeita em qualquer
 * rota de funcionário. A negação é o padrão porque os dois sujeitos carregam
 * credenciais de formatos incompatíveis, não porque alguém lembrou de negar.
 *
 * Isso importa: a API tem ~466 handlers sem `@Roles`, que aceitam qualquer
 * identidade autenticada. Se a admissão do responsável dependesse de uma
 * allowlist, esses 466 estariam abertos no primeiro esquecimento.
 */
// A chave vive em `common/auth/decorators/responsible-route.decorator.ts`,
// porque quem a lê PRIMEIRO é o `AuthGuard` global. Aqui só se reexporta.
export { RESPONSIBLE_ROUTE_KEY as IS_RESPONSIBLE_ROUTE };
export const ResponsibleOnly = () => SetMetadata(RESPONSIBLE_ROUTE_KEY, true);

/**
 * Exige que o contato tenha PELO MENOS UM dos papéis listados.
 *
 * Como `@Roles()`, acumula classe + handler em UNIÃO. Sem o decorador, a rota
 * aceita qualquer responsável autenticado do cliente — use-o em tudo que mostre
 * dinheiro ou documento fiscal.
 *
 * Referência de quem vê o quê, já estabelecida pela cerimônia de assinatura
 * (`signature/quote-sections.ts`), e que vale a pena manter coerente aqui:
 *   COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR, PURCHASING → documento inteiro
 *   FINANCIAL   → tudo menos LAYOUT (vê preço, prazo, pagamento, garantia)
 *   MARKETING   → só LAYOUT (vê a arte, NÃO vê preço)
 *   FLEET_MANAGER, DRIVER → não assinam por padrão: contato operacional do
 *                           veículo, não quem obriga a empresa
 *
 * Um portal que contrarie essa tabela mostraria na tela o que o PDF assinado
 * pela mesma pessoa esconde.
 */
export const RESPONSIBLE_ROLES_KEY = 'responsibleRoles';
export const ResponsibleRoles = (...roles: ResponsibleRole[]) =>
  SetMetadata(RESPONSIBLE_ROLES_KEY, roles);
