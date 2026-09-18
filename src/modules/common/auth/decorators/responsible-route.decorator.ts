// api/src/modules/common/auth/decorators/responsible-route.decorator.ts
//
// A CHAVE de metadado que marca uma rota como pertencente ao portal do cliente.
//
// Ela mora aqui, e não junto do portal, por camada: quem a LÊ primeiro é o
// `AuthGuard` global, em `common/auth`. Se a constante morasse em
// `people/responsible-auth`, a guarda global passaria a depender de um módulo de
// domínio — ou, pior, alguém copiaria a string literal para os dois lados e um
// dia elas divergiriam em silêncio, abrindo a rota para ninguém ou para todos.
export const RESPONSIBLE_ROUTE_KEY = 'isResponsibleRoute';
