// =====================
// NFS-e Nacional - DPS (Declaracao de Prestacao de Servicos)
// =====================

export interface NfseDps {
  infDPS: {
    tpAmb: 1 | 2; // 1=Producao, 2=Homologacao
    dhEmi: string; // ISO datetime
    verAplic: string; // App version
    serie: string;
    nDPS: number;
    dCompet: string; // yyyy-MM-dd
    tpEmit: 1 | 2; // 1=Prestador, 2=Tomador
    cLocEmi: number; // IBGE city code
    subst?: {
      chSubstda?: string;
      cMotivo?: string;
    };
    prest: {
      CNPJ: string;
      IM?: string; // Inscricao Municipal
    };
    toma: {
      CNPJ?: string;
      CPF?: string;
      xNome: string;
      end?: {
        endNac?: {
          cMun: number;
          CEP: string;
          xLgr: string;
          nro: string;
          xCpl?: string;
          xBairro: string;
        };
      };
      fone?: string;
      email?: string;
    };
    serv: {
      cServ: {
        cTribNac: string;
        cTribMun?: string;
        xDescServ: string;
      };
      comExt?: {
        mdPrestacao: number;
        vincPrest: number;
        tpMoeda: number;
        vServMoeda: number;
      };
    };
    valores: {
      vServPrest: {
        vReceb?: number;
        vServ: number;
      };
      vDescCondIncworked?: {
        vDescIncworked?: number;
        vDescCond?: number;
      };
      trib: {
        totTrib: {
          indTotTrib: 0 | 1;
          vTotTribFed?: number;
          vTotTribEst?: number;
          vTotTribMun?: number;
        };
        ISS: {
          aliq?: number;
          vBCISS?: number;
          vISS?: number;
          vLiq?: number;
          tpRetISSQN?: 1 | 2; // 1=Nao retido, 2=Retido
        };
      };
    };
  };
}

// =====================
// NFS-e API Responses
// =====================

export interface NfseEmitResponse {
  idDPS: string;
  chDPS: string;
  nNFSe?: string;
  cVerif?: string;
  dhProc?: string;
  cStat: string;
  xMotivo: string;
}

export interface NfseQueryResponse {
  nNFSe: string;
  cVerif: string;
  dhEmi: string;
  sit: string;
  xml?: string;
}

export interface NfseCancelResponse {
  nNFSe: string;
  cStat: string;
  xMotivo: string;
  dhCanc?: string;
}
