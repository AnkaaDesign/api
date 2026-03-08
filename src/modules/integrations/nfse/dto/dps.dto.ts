export class DpsPrestadorDto {
  CNPJ: string;
  IM?: string;
  regTrib: {
    opSimpNac: number;
    regEspTrib: number;
  };
}

export class DpsTomadorEndNacDto {
  cMun: number;
  CEP: string;
}

export class DpsTomadorEndDto {
  endNac?: DpsTomadorEndNacDto;
  xLgr?: string;
  nro?: string;
  xCpl?: string;
  xBairro?: string;
}

export class DpsTomadorDto {
  CNPJ?: string;
  CPF?: string;
  xNome: string;
  end?: DpsTomadorEndDto;
  fone?: string;
  email?: string;
}

export class DpsServicoDto {
  locPrest: {
    cLocPrestacao: number;
  };
  cServ: {
    cTribNac: string;
    cTribMun?: string;
    xDescServ: string;
  };
}

export class DpsValoresDto {
  vServPrest: { vServ: number };
  trib: {
    tribMun: {
      tribISSQN: number;
      tpRetISSQN?: number;
    };
    totTrib: { indTotTrib: 0 | 1 };
  };
}

export class DpsDto {
  tpAmb: 1 | 2;
  dhEmi: string;
  verAplic: string;
  serie: string;
  nDPS: number;
  dCompet: string;
  tpEmit: 1 | 2;
  cLocEmi: number;
  prest: DpsPrestadorDto;
  toma: DpsTomadorDto;
  serv: DpsServicoDto;
  valores: DpsValoresDto;
}
