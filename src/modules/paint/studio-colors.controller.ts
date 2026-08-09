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
   * Cache de 24 horas, o mesmo prazo dos outros estáticos da API (assets de
   * `/studio-assets/`, `/uploads/`, `.well-known/`): a tabela de tintas muda
   * quando o setor de pintura cadastra uma cor nova, o que é raro, e uma cor
   * atrasada por um dia custa menos que uma consulta por visitante. `public`
   * porque não há nada aqui que dependa de quem pede — a resposta é idêntica
   * para todo mundo e pode ficar em cache compartilhado.
   */
  @Public()
  @Get('colors')
  @Header('Cache-Control', 'public, max-age=86400') // 24 hours
  async getStudioColors(): Promise<StudioColorGetManyResponse> {
    return this.studioColorsService.findMany();
  }
}
