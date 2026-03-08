import { Injectable } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';
import { DpsDto } from './dto';

interface CancelEventInput {
  tpAmb: 1 | 2;
  chNFSe: string;
  dhEvento: string;
  nPedRegEvento: number;
  xMotivo: string;
}

@Injectable()
export class NfseXmlBuilderService {
  private readonly xmlBuilder: XMLBuilder;

  constructor() {
    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: true,
      attributeNamePrefix: '@_',
    });
  }

  /**
   * Build the cancellation event XML (pedRegEvento) for NFS-e Nacional.
   * Event type e101101 = cancellation by emitter.
   */
  buildCancelEventXml(input: CancelEventInput): string {
    const xmlObj = {
      '?xml': {
        '@_version': '1.0',
        '@_encoding': 'UTF-8',
      },
      pedRegEvento: {
        '@_xmlns': 'http://www.sped.fazenda.gov.br/nfse',
        '@_versao': '1.00',
        infPedReg: {
          tpAmb: input.tpAmb,
          verAplic: 'ANKAA-1.0',
          dhEvento: input.dhEvento,
          nPedRegEvento: input.nPedRegEvento,
          tpEvento: 'e101101',
          chNFSe: input.chNFSe,
          detEvento: {
            '@_versEvento': '1.00',
            pedCancNFSe: {
              xMotivo: input.xMotivo,
            },
          },
        },
      },
    };

    return this.xmlBuilder.build(xmlObj);
  }

  /**
   * Format datetime as TSDateTimeUTC: AAAA-MM-DDThh:mm:ss-03:00
   * SEFIN requires no milliseconds and explicit timezone (not 'Z').
   */
  private formatDateTime(isoString: string): string {
    const d = new Date(isoString);
    const brMs = -3 * 60 * 60 * 1000;
    const local = new Date(d.getTime() + brMs);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}-03:00`;
  }

  buildDpsXml(dps: DpsDto): string {
    // Build the TSIdDPS identifier (45 chars):
    // "DPS" (3) + cLocEmi (7) + tpInscFed (1) + CNPJ/CPF (14) + serie (5) + nDPS (15)
    const cnpj = dps.prest.CNPJ?.replace(/\D/g, '');
    const tpInscFed = cnpj ? '2' : '1';
    const inscFed = (cnpj || '').padStart(14, '0');
    const cLocEmi = String(dps.cLocEmi).padStart(7, '0');
    const serie = String(dps.serie).padStart(5, '0');
    const nDPS = String(dps.nDPS).padStart(15, '0');
    const idDPS = `DPS${cLocEmi}${tpInscFed}${inscFed}${serie}${nDPS}`;

    const xmlObj = {
      '?xml': {
        '@_version': '1.0',
        '@_encoding': 'UTF-8',
      },
      DPS: {
        '@_xmlns': 'http://www.sped.fazenda.gov.br/nfse',
        '@_versao': '1.00',
        infDPS: {
          '@_Id': idDPS,
          tpAmb: dps.tpAmb,
          dhEmi: this.formatDateTime(dps.dhEmi),
          verAplic: dps.verAplic,
          serie: dps.serie,
          nDPS: dps.nDPS,
          dCompet: dps.dCompet,
          tpEmit: dps.tpEmit,
          cLocEmi: dps.cLocEmi,
          prest: this.buildPrestador(dps.prest),
          toma: this.buildTomador(dps.toma),
          serv: this.buildServico(dps.serv),
          valores: this.buildValores(dps.valores),
        },
      },
    };

    return this.xmlBuilder.build(xmlObj);
  }

  private buildPrestador(prest: DpsDto['prest']): Record<string, any> {
    const result: Record<string, any> = {
      CNPJ: prest.CNPJ,
    };
    if (prest.IM) {
      result.IM = prest.IM;
    }
    result.regTrib = {
      opSimpNac: prest.regTrib.opSimpNac,
      regEspTrib: prest.regTrib.regEspTrib,
    };
    return result;
  }

  private buildTomador(toma: DpsDto['toma']): Record<string, any> {
    const result: Record<string, any> = {};

    if (toma.CNPJ) {
      result.CNPJ = toma.CNPJ;
    }
    if (toma.CPF) {
      result.CPF = toma.CPF;
    }

    result.xNome = toma.xNome;

    if (toma.end?.endNac) {
      const end: Record<string, any> = {
        endNac: {
          cMun: toma.end.endNac.cMun,
          CEP: toma.end.endNac.CEP,
        },
      };
      if (toma.end.xLgr) end.xLgr = toma.end.xLgr;
      if (toma.end.nro) end.nro = toma.end.nro;
      if (toma.end.xCpl) end.xCpl = toma.end.xCpl;
      if (toma.end.xBairro) end.xBairro = toma.end.xBairro;
      result.end = end;
    }

    if (toma.fone) {
      result.fone = toma.fone;
    }
    if (toma.email) {
      result.email = toma.email;
    }

    return result;
  }

  private buildServico(serv: DpsDto['serv']): Record<string, any> {
    return {
      locPrest: {
        cLocPrestacao: serv.locPrest.cLocPrestacao,
      },
      cServ: {
        cTribNac: serv.cServ.cTribNac,
        ...(serv.cServ.cTribMun ? { cTribMun: serv.cServ.cTribMun } : {}),
        xDescServ: serv.cServ.xDescServ,
      },
    };
  }

  private buildValores(valores: DpsDto['valores']): Record<string, any> {
    const tribMun: Record<string, any> = {
      tribISSQN: valores.trib.tribMun.tribISSQN,
    };

    if (valores.trib.tribMun.tpRetISSQN !== undefined) {
      tribMun.tpRetISSQN = valores.trib.tribMun.tpRetISSQN;
    }

    return {
      vServPrest: {
        vServ: valores.vServPrest.vServ,
      },
      trib: {
        tribMun,
        totTrib: {
          indTotTrib: valores.trib.totTrib.indTotTrib,
        },
      },
    };
  }
}
