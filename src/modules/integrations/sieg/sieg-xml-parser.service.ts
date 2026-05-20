import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser } from 'fast-xml-parser';
import {
  FiscalDocumentOperation,
  FiscalDocumentStatus,
  FiscalDocumentType,
} from '@prisma/client';
import { ParsedFiscalDocument, ParsedFiscalDocumentItem } from './types/sieg.types';

/**
 * Parses NF-e / NFC-e / CT-e / NFS-e XML payloads into a uniform shape the
 * reconciliation module can match against bank transactions.
 *
 * NFSe is special: it does NOT have the 44-digit access key NFe uses, so we
 * synthesize one: `NFSE_<emitCnpj>_<YYYYMM>_<nfNumber>`.
 */
@Injectable()
export class SiegXmlParserService {
  private readonly logger = new Logger(SiegXmlParserService.name);
  // S. Rodrigues & G. Rodrigues LTDA (Ankaa) — fixed for this deployment.
  // The env var is still honored for testing, but never required at runtime.
  private static readonly DEFAULT_COMPANY_CNPJ = '13636938000144';

  private readonly parser: XMLParser;
  private readonly companyCnpj: string;

  constructor(private readonly config: ConfigService) {
    this.companyCnpj =
      this.config.get<string>('COMPANY_CNPJ') ||
      SiegXmlParserService.DEFAULT_COMPANY_CNPJ;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    });
  }

  /**
   * Decodes a base64 XML payload (or raw XML string) into a parsed document.
   * Returns null when the XML can't be classified.
   */
  parse(xmlOrBase64: string): ParsedFiscalDocument | null {
    let rawXml: string;
    try {
      // Heuristic: SIEG returns base64. NFe XML always starts with <?xml or <NFe.
      if (xmlOrBase64.trimStart().startsWith('<')) {
        rawXml = xmlOrBase64;
      } else {
        rawXml = Buffer.from(xmlOrBase64, 'base64').toString('utf8');
      }
    } catch {
      return null;
    }

    let doc: any;
    try {
      doc = this.parser.parse(rawXml);
    } catch (err) {
      this.logger.warn(`Failed to parse XML: ${(err as Error).message}`);
      return null;
    }

    if (doc.nfeProc || doc.NFe) return this.parseNFe(doc, rawXml, FiscalDocumentType.NFE);
    if (doc.nfceProc || doc.NFCe) return this.parseNFe(doc, rawXml, FiscalDocumentType.NFCE);
    if (doc.cteProc || doc.CTe || doc.CT_eProc || doc.CTeOS) return this.parseCTe(doc, rawXml);
    if (doc.DPS || doc.dpsProc || doc.CompNfse || doc.NFSe) return this.parseNFSe(doc, rawXml);

    this.logger.warn('XML root not recognized as NFe/NFCe/CTe/NFSe');
    return null;
  }

  private parseNFe(
    doc: any,
    rawXml: string,
    docType: FiscalDocumentType,
  ): ParsedFiscalDocument | null {
    const nfeRoot = doc.nfeProc?.NFe ?? doc.NFe ?? doc.nfceProc?.NFe ?? doc.NFCe;
    if (!nfeRoot?.infNFe) return null;
    const infNFe = nfeRoot.infNFe;

    const idAttr = infNFe['@_Id'] || '';
    const accessKey = idAttr.replace(/^NFe/, '').replace(/^NFCe/, '');

    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const total = infNFe.total?.ICMSTot || {};
    const pag = infNFe.pag?.detPag;

    // Derive operation from the COMPANY's perspective:
    //   - company is emitter   → SAIDA (we sold / issued)
    //   - company is recipient → ENTRADA (we received)
    // Never trust `tpNF` as a fallback: that field is written from the
    // emitter's perspective (tpNF=1 = the emitter is selling), which inverts
    // the meaning when we're the destinatário.
    const emitCnpj = String(emit.CNPJ || '');
    const operationType: FiscalDocumentOperation =
      emitCnpj === this.companyCnpj
        ? FiscalDocumentOperation.SAIDA
        // Either destCnpj matches (typical case) or neither side matches
        // (third-party NFe imported by mistake) — both default to ENTRADA so
        // they don't masquerade as outbound sales.
        : FiscalDocumentOperation.ENTRADA;

    const cancelled = !!(doc.protNFe?.infProt?.cStat === '101' || doc.cancNFe);

    // NFe `det` may be a single object or an array (fast-xml-parser collapses
    // single-element arrays). Always normalize to an array before iterating.
    const detRaw = infNFe.det;
    const detList: any[] = detRaw ? (Array.isArray(detRaw) ? detRaw : [detRaw]) : [];
    const items: ParsedFiscalDocumentItem[] = detList
      .map((det) => {
        const prod = det?.prod;
        if (!prod) return null;
        const item: ParsedFiscalDocumentItem = {
          code: prod.cProd ? String(prod.cProd) : null,
          description: prod.xProd ? String(prod.xProd) : '',
          quantity: this.toNumberOrNull(prod.qCom),
          unit: prod.uCom ? String(prod.uCom) : null,
          unitValue: this.toNumberOrNull(prod.vUnCom),
          totalValue: this.toNumberOrZero(prod.vProd),
        };
        return item;
      })
      .filter((i): i is ParsedFiscalDocumentItem => i !== null);

    return {
      accessKey: accessKey || `${docType}_${ide.cNF || Date.now()}_${ide.nNF || ''}`,
      docType,
      operationType,
      status: cancelled ? FiscalDocumentStatus.CANCELLED : FiscalDocumentStatus.AUTHORIZED,
      issueDate: this.parseDate(ide.dhEmi || ide.dEmi),
      totalValue: parseFloat(total.vNF || '0'),
      emitCnpj: String(emit.CNPJ || ''),
      emitName: emit.xNome ? String(emit.xNome) : null,
      destCnpj: dest.CNPJ ? String(dest.CNPJ) : null,
      destCpf: dest.CPF ? String(dest.CPF) : null,
      destName: dest.xNome ? String(dest.xNome) : null,
      nfNumber: ide.nNF ? String(ide.nNF) : null,
      paymentMethods: pag ?? null,
      rawXml,
      items,
    };
  }

  private parseCTe(doc: any, rawXml: string): ParsedFiscalDocument | null {
    const cteRoot = doc.cteProc?.CTe ?? doc.CTe ?? doc.CT_eProc?.CTe;
    if (!cteRoot?.infCte && !cteRoot?.infCTe) return null;
    const infCTe = cteRoot.infCte || cteRoot.infCTe;

    const idAttr = infCTe['@_Id'] || '';
    const accessKey = idAttr.replace(/^CTe/, '');

    const ide = infCTe.ide || {};
    const emit = infCTe.emit || {};
    const dest = infCTe.dest || infCTe.rem || infCTe.toma || {};
    const vPrest = infCTe.vPrest || {};

    const operationType =
      String(emit.CNPJ || '') === (this.companyCnpj || '')
        ? FiscalDocumentOperation.SAIDA
        : FiscalDocumentOperation.ENTRADA;

    // CTe is a freight document; it has no product/service line items in the
    // sense the NF detail modal expects. We synthesize a single descriptive row
    // so the modal still renders something useful.
    const cteTotal = parseFloat(vPrest.vTPrest || '0');
    const cteDesc =
      (infCTe.infCTeNorm?.infServico?.xDescServ as string | undefined) ??
      'Prestação de serviço de transporte';
    const items: ParsedFiscalDocumentItem[] = [
      {
        code: null,
        description: String(cteDesc),
        quantity: null,
        unit: null,
        unitValue: null,
        totalValue: cteTotal,
      },
    ];

    return {
      accessKey: accessKey || `CTE_${Date.now()}`,
      docType: FiscalDocumentType.CTE,
      operationType,
      status: FiscalDocumentStatus.AUTHORIZED,
      issueDate: this.parseDate(ide.dhEmi || ide.dEmi),
      totalValue: cteTotal,
      emitCnpj: String(emit.CNPJ || ''),
      emitName: emit.xNome ? String(emit.xNome) : null,
      destCnpj: dest.CNPJ ? String(dest.CNPJ) : null,
      destCpf: dest.CPF ? String(dest.CPF) : null,
      destName: dest.xNome ? String(dest.xNome) : null,
      nfNumber: ide.nCT ? String(ide.nCT) : null,
      paymentMethods: null,
      rawXml,
      items,
    };
  }

  private parseNFSe(doc: any, rawXml: string): ParsedFiscalDocument | null {
    // SPED Nacional NFSe — <NFSe><infNFSe> with embedded <DPS><infDPS>. Detect
    // by the lowercase `infNFSe` (Elotech ABRASF v2.03 uses capital `InfNfse`).
    if (doc.NFSe?.infNFSe) return this.parseSefinNFSe(doc.NFSe.infNFSe, rawXml);

    // Standalone DPS (no NFSe envelope) — issued before the NFSe authorization step.
    const dps = doc.DPS?.infDPS || doc.dpsProc?.DPS?.infDPS;
    if (dps) return this.parseDPS(dps, rawXml);

    // ABRASF (Elotech v2.03 and other municipal variants).
    const abrasfInfo = doc.CompNfse?.Nfse?.InfNfse || doc.NFSe?.InfNFSe;
    if (abrasfInfo) return this.parseABRASF(abrasfInfo, rawXml);

    return null;
  }

  /**
   * SPED Nacional NFSe (Sistema Nacional). Schema rooted at
   * `<NFSe><infNFSe>`, with the prestador in `emit`, tomador in
   * `DPS.infDPS.toma`, and the liquid value in `valores.vLiq`.
   */
  private parseSefinNFSe(infNFSe: any, rawXml: string): ParsedFiscalDocument {
    const emit = infNFSe.emit || {};
    const valoresNFSe = infNFSe.valores || {};
    const infDPS = infNFSe.DPS?.infDPS || {};
    const toma = infDPS.toma || {};
    const serv = infDPS.serv || {};
    const cServ = serv.cServ || {};
    const valoresDPS = infDPS.valores?.vServPrest || infDPS.valores || {};

    const emitCnpj = String(emit.CNPJ || emit.CPF || '');
    const tomaCnpj = String(toma.CNPJ || '');
    const tomaCpf = String(toma.CPF || '');
    const dhEmi = infDPS.dhEmi || infNFSe.dhProc;
    const issueDate = this.parseDate(dhEmi);
    const nfNumber = String(infNFSe.nNFSe || infDPS.nDPS || '');

    // Prefer vLiq (valor líquido após retenções) — that's what hits the bank.
    // Fall back to vServ (gross service value) when vLiq is missing.
    const totalValue = parseFloat(
      valoresNFSe.vLiq || valoresDPS.vServ || valoresNFSe.vServPrest?.vServ || '0',
    );

    // cStat 100/107/135 = autorizada; 101 = cancelada.
    const cStat = String(infNFSe.cStat || '100');
    const cancelled = cStat === '101';

    const operationType =
      emitCnpj === (this.companyCnpj || '')
        ? FiscalDocumentOperation.SAIDA
        : FiscalDocumentOperation.ENTRADA;

    const items: ParsedFiscalDocumentItem[] = [
      {
        code: cServ.cTribNac ? String(cServ.cTribNac) : null,
        description: String(
          cServ.xDescServ || cServ.descServ || infNFSe.xTribNac || '',
        ),
        quantity: null,
        unit: null,
        unitValue: null,
        totalValue,
      },
    ];

    return {
      accessKey: this.synthNfseKey(emitCnpj, issueDate, nfNumber),
      docType: FiscalDocumentType.NFSE,
      operationType,
      status: cancelled ? FiscalDocumentStatus.CANCELLED : FiscalDocumentStatus.AUTHORIZED,
      issueDate,
      totalValue,
      emitCnpj,
      emitName: emit.xNome ? String(emit.xNome) : null,
      destCnpj: tomaCnpj || null,
      destCpf: tomaCpf || null,
      destName: toma.xNome ? String(toma.xNome) : null,
      nfNumber: nfNumber || null,
      paymentMethods: null,
      rawXml,
      items,
    };
  }

  private parseDPS(infDPS: any, rawXml: string): ParsedFiscalDocument {
    const prest = infDPS.prest || {};
    const tomad = infDPS.toma || infDPS.tomador || {};
    const valores = infDPS.valores?.vServPrest || infDPS.valores || {};
    const dhEmi = infDPS.dhEmi || infDPS.dEmi;
    const emitCnpj = String(prest.CNPJ || prest.cnpj || '');
    const nfNumber = String(infDPS.nDPS || infDPS.nNFSe || '');
    const issueDate = this.parseDate(dhEmi);

    const operationType =
      emitCnpj === (this.companyCnpj || '')
        ? FiscalDocumentOperation.SAIDA
        : FiscalDocumentOperation.ENTRADA;

    // SEFIN Nacional DPS carries the service description under `serv.cServ` /
    // `serv.discServ` (some integrators emit `xDescServ` instead).
    const totalValue = parseFloat(valores.vServ || valores.vServPrest || '0');
    const servico = infDPS.serv || infDPS.servico || {};
    const items: ParsedFiscalDocumentItem[] = [
      {
        code: servico.cServ ? String(servico.cServ) : null,
        description: String(
          servico.discServ || servico.xDescServ || servico.descServ || '',
        ),
        quantity: null,
        unit: null,
        unitValue: null,
        totalValue,
      },
    ];

    return {
      accessKey: this.synthNfseKey(emitCnpj, issueDate, nfNumber),
      docType: FiscalDocumentType.NFSE,
      operationType,
      status: FiscalDocumentStatus.AUTHORIZED,
      issueDate,
      totalValue,
      emitCnpj,
      emitName: prest.xNome || prest.razaoSocial || null,
      destCnpj: tomad.CNPJ || tomad.cnpj || null,
      destCpf: tomad.CPF || tomad.cpf || null,
      destName: tomad.xNome || tomad.razaoSocial || null,
      nfNumber: nfNumber || null,
      paymentMethods: null,
      rawXml,
      items,
    };
  }

  private parseABRASF(info: any, rawXml: string): ParsedFiscalDocument {
    // Elotech v2.03 (and most municipal ABRASF variants) nest Tomador/Servico
    // inside InfNfse → DeclaracaoPrestacaoServico → InfDeclaracaoPrestacaoServico.
    // Older/simpler variants put them at the InfNfse root. Resolve once.
    const decl = info.DeclaracaoPrestacaoServico?.InfDeclaracaoPrestacaoServico || {};

    const prest =
      info.PrestadorServico ||
      info.IdentificacaoPrestador ||
      info.Prestador ||
      decl.Prestador ||
      {};
    const tomad =
      decl.Tomador ||
      decl.TomadorServico ||
      info.TomadorServico ||
      info.IdentificacaoTomador ||
      info.Tomador ||
      {};
    const servico = decl.Servico || info.Servico || {};
    const valoresNfse = info.ValoresNfse || {};
    const valoresServico = servico.Valores || {};

    const dataEmissao = info.DataEmissao || info.dataEmissao;

    // Elotech path: prest.IdentificacaoPrestador.CpfCnpj.Cnpj
    // Other variants flatten one level: prest.CpfCnpj.Cnpj or prest.Cnpj
    const prestCnpj = String(
      prest.IdentificacaoPrestador?.CpfCnpj?.Cnpj ||
        prest.IdentificacaoPrestador?.Cnpj ||
        prest.CpfCnpj?.Cnpj ||
        prest.Cnpj ||
        prest.cnpj ||
        '',
    );
    const tomadCnpj = String(
      tomad.IdentificacaoTomador?.CpfCnpj?.Cnpj ||
        tomad.CpfCnpj?.Cnpj ||
        tomad.Cnpj ||
        '',
    );
    const tomadCpf = String(
      tomad.IdentificacaoTomador?.CpfCnpj?.Cpf || tomad.CpfCnpj?.Cpf || tomad.Cpf || '',
    );
    const nfNumber = String(info.Numero || info.numero || '');
    const issueDate = this.parseDate(dataEmissao);

    const operationType =
      prestCnpj === (this.companyCnpj || '')
        ? FiscalDocumentOperation.SAIDA
        : FiscalDocumentOperation.ENTRADA;

    // Total: ValoresNfse.ValorLiquidoNfse is the canonical "what arrived at the
    // bank" amount in Elotech. Fall back to Servico.Valores.ValorServicos for
    // variants that don't carry the NFSe-level totals.
    const totalValue = parseFloat(
      valoresNfse.ValorLiquidoNfse ||
        valoresNfse.valorLiquidoNfse ||
        valoresServico.ValorServicos ||
        valoresServico.valorServicos ||
        valoresNfse.BaseCalculo ||
        '0',
    );

    const items: ParsedFiscalDocumentItem[] = [
      {
        code: servico.ItemListaServico
          ? String(servico.ItemListaServico)
          : servico.itemListaServico
            ? String(servico.itemListaServico)
            : null,
        description: String(servico.Discriminacao || servico.discriminacao || ''),
        quantity: null,
        unit: null,
        unitValue: null,
        totalValue,
      },
    ];

    return {
      accessKey: this.synthNfseKey(prestCnpj, issueDate, nfNumber),
      docType: FiscalDocumentType.NFSE,
      operationType,
      status: FiscalDocumentStatus.AUTHORIZED,
      issueDate,
      totalValue,
      emitCnpj: prestCnpj,
      emitName: prest.RazaoSocial || prest.razaoSocial || null,
      destCnpj: tomadCnpj || null,
      destCpf: tomadCpf || null,
      destName: tomad.RazaoSocial || tomad.razaoSocial || tomad.xNome || null,
      nfNumber: nfNumber || null,
      paymentMethods: null,
      rawXml,
      items,
    };
  }

  private synthNfseKey(emitCnpj: string, issueDate: Date, nfNumber: string): string {
    const ym = `${issueDate.getUTCFullYear()}${String(issueDate.getUTCMonth() + 1).padStart(2, '0')}`;
    return `NFSE_${emitCnpj || '00000000000000'}_${ym}_${nfNumber || Date.now()}`;
  }

  private parseDate(value: unknown): Date {
    if (!value) return new Date();
    const s = String(value);
    const parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  /**
   * Brazilian SEFAZ XML emits numeric fields as strings (e.g. "1.0000",
   * "12.50"). Returns null when the field is missing/empty/unparseable.
   */
  private toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
  }

  private toNumberOrZero(value: unknown): number {
    return this.toNumberOrNull(value) ?? 0;
  }
}
