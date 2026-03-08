export class NfseEmitResponseDto {
  idDPS: string;
  chDPS: string;
  nNFSe?: string;
  cVerif?: string;
  dhProc?: string;
  cStat: string;
  xMotivo: string;
}

export class NfseQueryResponseDto {
  nNFSe: string;
  cVerif: string;
  dhEmi: string;
  sit: string;
  xml?: string;
}

export class NfseCancelResponseDto {
  nNFSe: string;
  cStat: string;
  xMotivo: string;
  dhCanc?: string;
}
