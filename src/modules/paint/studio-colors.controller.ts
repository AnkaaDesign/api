// studio-colors.controller.ts

import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { StudioColorsService } from './studio-colors.service';
import type { StudioColorGetManyResponse } from '../../types';

/**
 * Catálogo PÚBLICO de cores do Truck Studio.
 *
 * POR QUE UMA ROTA À PARTE, e não um relaxamento de `/paints`: aquele endpoint
 * devolve a tinta inteira e aceita `include` pela query string — fórmulas,
 * componentes, itens de estoque, tarefas. Abrir ele ao público seria abrir
 * tudo isso junto. Esta rota devolve nove campos escolhidos a dedo e não
 * aceita parâmetro nenhum, então não existe requisição capaz de alargá-la. As
 * rotas de `/paints` seguem exatamente como estavam, com JWT e papéis.
 *
 * POR QUE PÚBLICA: o estúdio roda em duas cascas — o site e um Electron —, e
 * em ambas o seletor de cor abre antes de qualquer login. A árvore de assets
 * 3D em `/studio-assets/` já é servida assim (ver o comentário em main.ts), e
 * uma cor de catálogo é do mesmo tipo de dado que um modelo de cabine:
 * material de vitrine, não dado de cliente.
 *
 * O `@Public()` é o que o AuthGuard global lê — ele marca `isPublic`, e o
 * guard devolve `true` antes de procurar o Bearer (ver auth.guard.ts). O
 * throttler global NÃO é dispensado: sem `@NoRateLimit()`, esta rota continua
 * sob o limite padrão, que é o que se quer num endpoint sem autenticação.
 */
@Controller('studio')
export class StudioColorsController {
  constructor(private readonly studioColorsService: StudioColorsService) {}

  /**
   * `GET /studio/colors` — a paleta inteira, ordenada por `colorOrder` e nome.
   *
   * `no-cache`, e NÃO as 24 horas que estavam aqui.
   *
   * A premissa antiga era que "a tabela de tintas muda quando o setor cadastra
   * uma cor nova, o que é raro, e uma cor atrasada por um dia custa menos que
   * uma consulta por visitante". Isso deixou de ser verdade quando o Ajuste da
   * Tinta do Truck Studio passou a GRAVAR nesta mesma tabela: cada receita
   * salva escreve `previewConfig` e muda esta resposta. E quem salva é
   * exatamente quem precisa vê-la de volta — o usuário gravava a receita, dava
   * F5 e o navegador servia a paleta de ontem, do próprio cache. A receita
   * estava no banco o tempo todo; ela só não voltava. Um dia de atraso não
   * custa "menos que uma consulta": custa o trabalho parecer perdido.
   *
   * É o mesmo erro que os manifestos do studio tiveram, e a mesma correção:
   * `immutable`/`max-age` longo pertence a quem é imutável por construção — a
   * geometria, cujo nome de arquivo muda a cada bake. Esta resposta é EDITADA
   * NO LUGAR, então o que ela precisa é de revalidação.
   *
   * `no-cache` não é "não armazene": armazena e REVALIDA, então o estado
   * estável continua sendo um 304 de corpo vazio contra o ETag que o Nest já
   * emite — uma requisição condicional por carga, não 120 KB.
   */
  @Public()
  @Get('colors')
  @Header('Cache-Control', 'no-cache, must-revalidate')
  async getStudioColors(): Promise<StudioColorGetManyResponse> {
    return this.studioColorsService.findMany();
  }
}
