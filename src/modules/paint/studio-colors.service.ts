// studio-colors.service.ts

import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PaintRepository, StudioColorRow } from './repositories/paint/paint.repository';
import type { StudioColor, StudioColorGetManyResponse } from '../../types';
import { TRUCK_MANUFACTURER } from '../../constants/enums';

/**
 * `Paint.manufacturer` (enum do banco) → id da montadora no catálogo do
 * estúdio — o mesmo id de `brands.json`, que é como o engine 3D nomeia as
 * pastas de modelo e filtra a paleta.
 *
 * ESTA TABELA MORA NO SERVIDOR de propósito. Ela já existia uma vez, em
 * web/.../truck-studio/index.tsx; o Truck Studio ganhou uma segunda casca
 * (Electron), e uma tabela duplicada em dois repositórios é uma tabela que vai
 * divergir — basta uma montadora nova entrar no enum e só um dos dois lados
 * aprender o apelido dela. Traduzindo aqui, os dois clientes recebem o id
 * pronto e nenhum precisa conhecer o enum.
 *
 * Só duas linhas de fato traduzem (MERCEDES_BENZ → mb, VOLKSWAGEN → vw); as
 * outras quatro são a mesma palavra em minúsculas. Ainda assim a tabela é
 * ESCRITA POR INTEIRO em vez de um `toLowerCase()` com duas exceções: um mapa
 * completo é conferido pelo compilador contra o enum (`Record<...>`), e um
 * membro novo em `TRUCK_MANUFACTURER` quebra o build aqui, que é onde se quer
 * descobrir isso — e não num card sem cor no seletor.
 */
const STUDIO_MANUFACTURER_BY_ENUM: Record<TRUCK_MANUFACTURER, string> = {
  [TRUCK_MANUFACTURER.SCANIA]: 'scania',
  [TRUCK_MANUFACTURER.VOLVO]: 'volvo',
  [TRUCK_MANUFACTURER.DAF]: 'daf',
  [TRUCK_MANUFACTURER.IVECO]: 'iveco',
  [TRUCK_MANUFACTURER.MERCEDES_BENZ]: 'mb',
  [TRUCK_MANUFACTURER.VOLKSWAGEN]: 'vw',
  [TRUCK_MANUFACTURER.MAN]: 'man',
};

/**
 * O catálogo de cores do Truck Studio.
 *
 * Serve `GET /studio/colors`, que é `@Public()`. Por isso este serviço é
 * SOMENTE LEITURA e não tem nenhum outro método: não há aqui um caminho de
 * escrita para uma requisição sem token alcançar. Gravar a receita de uma
 * tinta continua sendo `PUT /paints/:id`, autenticado e com papéis, como
 * sempre foi.
 */
@Injectable()
export class StudioColorsService {
  private readonly logger = new Logger(StudioColorsService.name);

  constructor(private readonly paintRepository: PaintRepository) {}

  /**
   * Devolve o catálogo inteiro, já ordenado pelo repositório.
   *
   * Sem paginação de propósito: são ~522 linhas magras (nove campos), e o
   * estúdio precisa da lista toda no boot para que trocar de montadora no
   * seletor seja síncrono — uma ida à rede no meio da navegação é justamente
   * o que se quer evitar. Ver o cabeçalho de `colorsFor()` em
   * engine/catalog/colors.ts, do lado do consumidor.
   */
  async findMany(): Promise<StudioColorGetManyResponse> {
    try {
      const rows = await this.paintRepository.findStudioColors();
      const data = rows.map(row => this.toStudioColor(row));

      return {
        success: true,
        message: 'Cores encontradas com sucesso',
        data,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar cores do estúdio', error);
      throw new InternalServerErrorException('Erro ao buscar cores. Por favor, tente novamente.');
    }
  }

  /**
   * Linha do banco → objeto do catálogo.
   *
   * Monta o objeto CAMPO A CAMPO, sem espalhar a linha (`...row`): é a segunda
   * trava, depois do `select` do repositório. Se um dia alguém acrescentar uma
   * coluna à projeção sem pensar, ela ainda assim não atravessa esta função.
   *
   * `finish` sai CRU (SOLID, METALLIC, PEARL, MATTE, SATIN). O motor de tinta
   * do estúdio tem três acabamentos e reduz MATTE/SATIN a 'solid' no cliente
   * (`FINISH_FROM_API`); fazer essa redução aqui apagaria a informação para
   * todo mundo e amarraria a rota ao conjunto de shaders de hoje.
   */
  private toStudioColor(row: StudioColorRow): StudioColor {
    return {
      id: row.id,
      name: row.name,
      hex: row.hex,
      finish: row.finish,
      code: row.code ?? null,
      colorOrder: row.colorOrder,
      brand: row.paintBrand?.name ?? null,
      /* Uma montadora fora da tabela vira `null` — tinta do catálogo geral —
         em vez de um id inventado que o engine não saberia casar com pasta
         nenhuma e que sumiria da paleta em silêncio. */
      manufacturer: row.manufacturer ? (STUDIO_MANUFACTURER_BY_ENUM[row.manufacturer] ?? null) : null,
      previewConfig: (row.previewConfig as Record<string, any> | null) ?? null,
    };
  }
}
