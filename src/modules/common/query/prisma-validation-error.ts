/**
 * `PrismaClientValidationError` é o Prisma dizendo "esta CONSULTA está errada"
 * (chave que o modelo não tem, argumento inválido) — erro de quem montou a
 * consulta, não falha do servidor. O filtro global já o traduz para 400, mas os
 * serviços o engoliam num `InternalServerErrorException` genérico ("Erro interno
 * do servidor ao buscar as tarefas"): o cliente via 500 e ninguém sabia qual
 * chave era. Estes dois helpers existem para os `catch` dos serviços deixarem
 * esse erro passar com o nome da chave.
 *
 * O G1 (`query-shape.guard.ts`) pega a chave inventada ANTES, na rota; isto é a
 * rede para o que escapa dele (consulta montada pelo próprio serviço, rota ainda
 * não plugada).
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * A chave que o Prisma recusou, lida da mensagem.
 *
 * O `PrismaClientValidationError` traz a frase inteira em `message`, na forma
 * "Unknown field `x` for include statement on model `Y`" (ou `for select
 * statement`, ou `argument`). Lê-se de lá porque o Prisma NÃO expõe o campo
 * culpado como dado — e uma regex sobre a mensagem é frágil por natureza, então
 * devolve `null` quando não reconhece. Errar para o lado de não adivinhar: um
 * nome errado mandaria caçar a relação errada. (Veio de `task.service.ts`.)
 */
export function unknownPrismaKeyOf(error: unknown): string | null {
  const message = (error as { message?: unknown })?.message;
  if (typeof message !== 'string') return null;
  const found = /Unknown (?:field|argument) `([^`]+)`/i.exec(message);
  return found?.[1] ?? null;
}

export function isPrismaValidationError(
  error: unknown,
): error is Prisma.PrismaClientValidationError {
  return error instanceof Prisma.PrismaClientValidationError;
}

/** A mensagem que o cliente vê, nomeando a chave quando dá para lê-la. */
export function describePrismaValidationError(error: unknown): string {
  const key = unknownPrismaKeyOf(error);
  return key
    ? `A consulta pede "${key}", que não existe no modelo.`
    : 'Consulta inválida para o banco de dados.';
}

/**
 * Nos `catch` dos serviços, ANTES de embrulhar em 500: se o erro é de
 * validação do Prisma, relança como 400 nomeado.
 */
export function rethrowPrismaValidationAsBadRequest(error: unknown): void {
  if (!isPrismaValidationError(error)) return;
  throw new BadRequestException({
    message: describePrismaValidationError(error),
    error: 'DATABASE_VALIDATION_ERROR',
    statusCode: 400,
  });
}
