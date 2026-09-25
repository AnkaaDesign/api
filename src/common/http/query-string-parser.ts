import * as qs from 'qs';

/**
 * O parser da query string de todas as rotas (`main.ts`: `app.set('query parser', …)`).
 *
 * Fica num módulo próprio para que os testes que batem a URL EXATA de um cliente
 * (a Agenda do app, G32) passem pelo mesmo parser da API em execução.
 *
 * Aceita a notação de colchetes do axios e a de pontos (`orderBy[0].forecastDate.sort`).
 * Numeric coercion is INTENTIONALLY NOT done here — query schemas that need numbers
 * must opt in via z.coerce.number(). The previous blanket /^\d+$/ coercion silently
 * broke z.string() params that received all-digit input (FITID search, CNPJ filter,
 * amount filter) by turning the input into a Number before Zod validation.
 */
export function parseQueryString(str: string): Record<string, unknown> {
  return qs.parse(str, {
    depth: 10,
    arrayLimit: 100,
    parameterLimit: 1000,
    parseArrays: true,
    allowDots: true, // Changed to true to support array[0].field notation
    strictNullHandling: true,
    decoder: (value, defaultDecoder, charset) => {
      // Handle boolean strings (safe — Zod schemas expecting strings can
      // re-coerce via z.preprocess if a literal "true"/"false" payload is
      // needed; none currently exist).
      if (value === 'true') return true;
      if (value === 'false') return false;
      return defaultDecoder(value, defaultDecoder, charset);
    },
  });
}
