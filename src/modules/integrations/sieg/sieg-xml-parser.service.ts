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

    // Authorization protocol lives at the *proc* level: nfeProc.protNFe /
    // nfceProc.protNFe, or doc.protNFe for bare envelopes.
    const infProt =
      doc.nfeProc?.protNFe?.infProt ||
      doc.nfceProc?.protNFe?.infProt ||
      doc.protNFe?.infProt ||
      {};

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

    const protCStat = infProt.cStat ? String(infProt.cStat) : null;
    const cancelled = !!(protCStat === '101' || doc.cancNFe);
    const { date: issueDate, inferred: dateInferred } = this.parseDateFlagged(
      ide.dhEmi || ide.dEmi,
    );

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
          ncm: prod.NCM ? String(prod.NCM) : null,
          cfop: prod.CFOP ? String(prod.CFOP) : null,
          cest: prod.CEST ? String(prod.CEST) : null,
          ean: prod.cEAN && prod.cEAN !== 'SEM GTIN' ? String(prod.cEAN) : null,
          discount: this.toNumberOrNull(prod.vDesc),
          freight: this.toNumberOrNull(prod.vFrete),
          taxes: this.extractItemTaxes(det?.imposto),
          cst: this.extractItemCst(det?.imposto),
        };
        return item;
      })
      .filter((i): i is ParsedFiscalDocumentItem => i !== null);

    return {
      accessKey: accessKey || `${docType}_${ide.cNF || ide.nNF || 'UNK'}`,
      docType,
      operationType,
      status: cancelled ? FiscalDocumentStatus.CANCELLED : FiscalDocumentStatus.AUTHORIZED,
      issueDate,
      dateInferred,
      totalValue: parseFloat(total.vNF || '0'),
      emitCnpj: String(emit.CNPJ || ''),
      emitName: emit.xNome ? String(emit.xNome) : null,
      emitIE: emit.IE ? String(emit.IE) : null,
      emitAddress: this.extractAddress(emit.enderEmit),
      destCnpj: dest.CNPJ ? String(dest.CNPJ) : null,
      destCpf: dest.CPF ? String(dest.CPF) : null,
      destName: dest.xNome ? String(dest.xNome) : null,
      destIE: dest.IE ? String(dest.IE) : null,
      destEmail: dest.email ? String(dest.email) : null,
      destAddress: this.extractAddress(dest.enderDest),
      nfNumber: ide.nNF ? String(ide.nNF) : null,
      series: ide.serie ? String(ide.serie) : null,
      model: ide.mod ? String(ide.mod) : null,
      naturezaOperacao: ide.natOp ? String(ide.natOp) : null,
      infCpl: infNFe.infAdic?.infCpl ? String(infNFe.infAdic.infCpl) : null,
      orderCodes: this.extractOrderCodes(
        infNFe.infAdic?.infCpl ? String(infNFe.infAdic.infCpl) : null,
      ),
      protocolNumber: infProt.nProt ? String(infProt.nProt) : null,
      authorizationDate: this.parseDateOrNull(infProt.dhRecbto),
      cStat: protCStat,
      xMotivo: infProt.xMotivo ? String(infProt.xMotivo) : null,
      totals: this.extractTotals(total),
      cancelledAt: cancelled ? this.parseDateOrNull(infProt.dhRecbto) : null,
      paymentMethods: pag ?? null,
      rawXml,
      items,
    };
  }

  /**
   * Extracts purchase-order codes from an infCpl free-text blob.
   *
   * Suppliers (e.g. Farben) embed the buyer's order number(s) in the NFe
   * complementary info as a `#Ped:` block, optionally listing several
   * space-separated codes when one invoice consolidates multiple orders:
   *
   *   "#Total p/ CFOP/ICMS: 5101=... #Ped:C34673 C34505 C34508 #Vend:000428#..."
   *
   * We isolate the text between `#Ped:` and the next `#<letter>` token (e.g.
   * `#Vend`, `#Declaro`) or end-of-string, then pull each code token. A code is
   * an optional letter prefix followed by 3+ digits — this matches both the
   * `C#####` (Farben) and long-numeric marketplace formats while ignoring the
   * CFOP/value numbers that live OUTSIDE the `#Ped:` span. Returns a
   * de-duplicated, order-preserving array (empty for null / no-match input).
   */
  private extractOrderCodes(infCpl: string | null | undefined): string[] {
    if (!infCpl) return [];
    // Capture everything after "#Ped:" up to the next "#<letter>" tag or EOS.
    const block = /#Ped:\s*([\s\S]*?)(?=#[A-Za-zÀ-ÿ]|$)/.exec(infCpl);
    if (!block) return [];
    const tokens = block[1].match(/[A-Za-z]?\d{3,}/g) ?? [];
    const seen = new Set<string>();
    const codes: string[] = [];
    for (const t of tokens) {
      const code = t.toUpperCase();
      if (!seen.has(code)) {
        seen.add(code);
        codes.push(code);
      }
    }
    return codes;
  }

  /** Builds an address blob from an NFe `enderEmit`/`enderDest` node. */
  private extractAddress(ender: any): ParsedFiscalDocument['emitAddress'] {
    if (!ender || typeof ender !== 'object') return null;
    const addr = {
      logradouro: ender.xLgr ? String(ender.xLgr) : null,
      numero: ender.nro ? String(ender.nro) : null,
      complemento: ender.xCpl ? String(ender.xCpl) : null,
      bairro: ender.xBairro ? String(ender.xBairro) : null,
      municipio: ender.xMun ? String(ender.xMun) : null,
      uf: ender.UF ? String(ender.UF) : null,
      cep: ender.CEP ? String(ender.CEP) : null,
      fone: ender.fone ? String(ender.fone) : null,
    };
    return Object.values(addr).some((v) => v !== null) ? addr : null;
  }

  /** Extracts the ICMSTot totals breakdown from an NFe `total.ICMSTot` node. */
  private extractTotals(t: any): ParsedFiscalDocument['totals'] {
    if (!t || typeof t !== 'object') return null;
    const out: Record<string, number> = {};
    for (const k of [
      'vBC', 'vICMS', 'vICMSDeson', 'vProd', 'vFrete', 'vSeg',
      'vDesc', 'vOutro', 'vST', 'vIPI', 'vPIS', 'vCOFINS', 'vNF', 'vTotTrib',
    ]) {
      const n = this.toNumberOrNull(t[k]);
      if (n !== null) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  }

  /** Extracts the per-item ICMS/IPI/PIS/COFINS breakdown from `det.imposto`. */
  private extractItemTaxes(imposto: any): ParsedFiscalDocumentItem['taxes'] {
    if (!imposto || typeof imposto !== 'object') return null;
    // ICMS is wrapped in a CST-keyed sub-node (ICMS00, ICMS10, ICMSSN102, ...).
    const icmsNode = imposto.ICMS
      ? Object.values(imposto.ICMS).find((v) => v && typeof v === 'object')
      : null;
    const icms = icmsNode as any;
    const ipi = imposto.IPI?.IPITrib;
    const pis = imposto.PIS
      ? (Object.values(imposto.PIS).find((v) => v && typeof v === 'object') as any)
      : null;
    const cofins = imposto.COFINS
      ? (Object.values(imposto.COFINS).find((v) => v && typeof v === 'object') as any)
      : null;
    const taxes: ParsedFiscalDocumentItem['taxes'] = {};
    if (icms)
      taxes.icms = {
        vBC: this.toNumberOrNull(icms.vBC) ?? undefined,
        pICMS: this.toNumberOrNull(icms.pICMS) ?? undefined,
        vICMS: this.toNumberOrNull(icms.vICMS) ?? undefined,
        cst: icms.CST ? String(icms.CST) : icms.CSOSN ? String(icms.CSOSN) : undefined,
      };
    if (ipi)
      taxes.ipi = {
        vBC: this.toNumberOrNull(ipi.vBC) ?? undefined,
        pIPI: this.toNumberOrNull(ipi.pIPI) ?? undefined,
        vIPI: this.toNumberOrNull(ipi.vIPI) ?? undefined,
        cst: ipi.CST ? String(ipi.CST) : undefined,
      };
    if (pis)
      taxes.pis = {
        vBC: this.toNumberOrNull(pis.vBC) ?? undefined,
        pPIS: this.toNumberOrNull(pis.pPIS) ?? undefined,
        vPIS: this.toNumberOrNull(pis.vPIS) ?? undefined,
        cst: pis.CST ? String(pis.CST) : undefined,
      };
    if (cofins)
      taxes.cofins = {
        vBC: this.toNumberOrNull(cofins.vBC) ?? undefined,
        pCOFINS: this.toNumberOrNull(cofins.pCOFINS) ?? undefined,
        vCOFINS: this.toNumberOrNull(cofins.vCOFINS) ?? undefined,
        cst: cofins.CST ? String(cofins.CST) : undefined,
      };
    return Object.keys(taxes).length ? taxes : null;
  }

  /** Pulls the ICMS CST/CSOSN code for quick display on the item row. */
  private extractItemCst(imposto: any): string | null {
    if (!imposto?.ICMS) return null;
    const node = Object.values(imposto.ICMS).find(
      (v) => v && typeof v === 'object',
    ) as any;
    if (!node) return null;
    return node.CST ? String(node.CST) : node.CSOSN ? String(node.CSOSN) : null;
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
    const infProt =
      doc.cteProc?.protCTe?.infProt || doc.CT_eProc?.protCTe?.infProt || {};
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
    const { date: issueDate, inferred: dateInferred } = this.parseDateFlagged(
      ide.dhEmi || ide.dEmi,
    );

    return {
      accessKey: accessKey || `CTE_${ide.nCT || 'UNK'}`,
      docType: FiscalDocumentType.CTE,
      operationType,
      status: FiscalDocumentStatus.AUTHORIZED,
      issueDate,
      dateInferred,
      totalValue: cteTotal,
      emitCnpj: String(emit.CNPJ || ''),
      emitName: emit.xNome ? String(emit.xNome) : null,
      emitIE: emit.IE ? String(emit.IE) : null,
      emitAddress: this.extractAddress(emit.enderEmit),
      destCnpj: dest.CNPJ ? String(dest.CNPJ) : null,
      destCpf: dest.CPF ? String(dest.CPF) : null,
      destName: dest.xNome ? String(dest.xNome) : null,
      destAddress: this.extractAddress(dest.enderDest),
      nfNumber: ide.nCT ? String(ide.nCT) : null,
      series: ide.serie ? String(ide.serie) : null,
      model: ide.mod ? String(ide.mod) : null,
      naturezaOperacao: ide.natOp ? String(ide.natOp) : null,
      protocolNumber: infProt.nProt ? String(infProt.nProt) : null,
      authorizationDate: this.parseDateOrNull(infProt.dhRecbto),
      cStat: infProt.cStat ? String(infProt.cStat) : null,
      xMotivo: infProt.xMotivo ? String(infProt.xMotivo) : null,
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
    const tribMun = valoresNFSe.trib?.tribMun || infDPS.valores?.trib?.tribMun || {};

    const emitCnpj = String(emit.CNPJ || emit.CPF || '');
    const tomaCnpj = String(toma.CNPJ || '');
    const tomaCpf = String(toma.CPF || '');
    const dhEmi = infDPS.dhEmi || infNFSe.dhProc;
    const { date: issueDate, inferred: dateInferred } = this.parseDateFlagged(dhEmi);
    const nfNumber = String(infNFSe.nNFSe || infDPS.nDPS || '');

    const valorServicos = this.toNumberOrNull(
      valoresDPS.vServ || valoresNFSe.vServPrest?.vServ,
    );
    const valorLiquido = this.toNumberOrNull(valoresNFSe.vLiq);
    // Prefer vLiq (valor líquido após retenções) — that's what hits the bank.
    // Fall back to vServ (gross service value) when vLiq is missing.
    const totalValue = valorLiquido ?? valorServicos ?? 0;

    // cStat 100/107/135 = autorizada; 101 = cancelada.
    const cStat = String(infNFSe.cStat || '100');
    const cancelled = cStat === '101';

    const operationType =
      emitCnpj === (this.companyCnpj || '')
        ? FiscalDocumentOperation.SAIDA
        : FiscalDocumentOperation.ENTRADA;

    const itemListaServico = cServ.cTribNac ? String(cServ.cTribNac) : null;
    const discriminacao = String(
      cServ.xDescServ || cServ.descServ || infNFSe.xTribNac || '',
    );
    const items: ParsedFiscalDocumentItem[] = [
      {
        code: itemListaServico,
        description: discriminacao,
        quantity: null,
        unit: null,
        unitValue: null,
        totalValue: valorServicos ?? totalValue,
      },
    ];

    return {
      accessKey: this.synthNfseKey(emitCnpj, issueDate, nfNumber),
      docType: FiscalDocumentType.NFSE,
      operationType,
      status: cancelled ? FiscalDocumentStatus.CANCELLED : FiscalDocumentStatus.AUTHORIZED,
      issueDate,
      dateInferred,
      totalValue,
      emitCnpj,
      emitName: emit.xNome ? String(emit.xNome) : null,
      destCnpj: tomaCnpj || null,
      destCpf: tomaCpf || null,
      destName: toma.xNome ? String(toma.xNome) : null,
      nfNumber: nfNumber || null,
      cStat,
      authorizationDate: this.parseDateOrNull(infNFSe.dhProc),
      cancelledAt: cancelled ? this.parseDateOrNull(infNFSe.dhProc) : null,
      issValue: this.toNumberOrNull(tribMun.vISSQN || valoresNFSe.vISS),
      issRate: this.toNumberOrNull(tribMun.pAliq),
      issRetained: tribMun.tpRetISSQN != null ? String(tribMun.tpRetISSQN) === '1' : null,
      baseCalculo: this.toNumberOrNull(valoresNFSe.vBC || tribMun.vBC),
      valorLiquido,
      valorServicos,
      codigoTributacaoMunicipio: cServ.cTribMun ? String(cServ.cTribMun) : null,
      municipioPrestacao: serv.locPrest?.cLocPrestacao
        ? String(serv.locPrest.cLocPrestacao)
        : null,
      itemListaServico,
      paymentMethods: null,
      rawXml,
      items,
    };
  }

  private parseDPS(infDPS: any, rawXml: string): ParsedFiscalDocument {
    const prest = infDPS.prest || {};
    const tomad = infDPS.toma || infDPS.tomador || {};
    const valores = infDPS.valores?.vServPrest || infDPS.valores || {};
    const tribMun = infDPS.valores?.trib?.tribMun || {};
    const dhEmi = infDPS.dhEmi || infDPS.dEmi;
    const emitCnpj = String(prest.CNPJ || prest.cnpj || '');
    const nfNumber = String(infDPS.nDPS || infDPS.nNFSe || '');
    const { date: issueDate, inferred: dateInferred } = this.parseDateFlagged(dhEmi);

    const operationType =
      emitCnpj === (this.companyCnpj || '')
        ? FiscalDocumentOperation.SAIDA
        : FiscalDocumentOperation.ENTRADA;

    // SEFIN Nacional DPS carries the service description under `serv.cServ` /
    // `serv.discServ` (some integrators emit `xDescServ` instead).
    const valorServicos = this.toNumberOrNull(valores.vServ || valores.vServPrest);
    const totalValue = valorServicos ?? 0;
    const servico = infDPS.serv || infDPS.servico || {};
    const cServ = servico.cServ || {};
    const itemListaServico = cServ.cTribNac
      ? String(cServ.cTribNac)
      : servico.cServ && typeof servico.cServ !== 'object'
        ? String(servico.cServ)
        : null;
    const items: ParsedFiscalDocumentItem[] = [
      {
        code: itemListaServico,
        description: String(
          servico.discServ || cServ.xDescServ || servico.xDescServ || servico.descServ || '',
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
      dateInferred,
      totalValue,
      emitCnpj,
      emitName: prest.xNome || prest.razaoSocial || null,
      destCnpj: tomad.CNPJ || tomad.cnpj || null,
      destCpf: tomad.CPF || tomad.cpf || null,
      destName: tomad.xNome || tomad.razaoSocial || null,
      nfNumber: nfNumber || null,
      issValue: this.toNumberOrNull(tribMun.vISSQN),
      issRate: this.toNumberOrNull(tribMun.pAliq),
      issRetained: tribMun.tpRetISSQN != null ? String(tribMun.tpRetISSQN) === '1' : null,
      valorServicos,
      codigoTributacaoMunicipio: cServ.cTribMun ? String(cServ.cTribMun) : null,
      itemListaServico,
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
    // ABRASF can carry one Servico object or an array of them.
    const servicoRaw = decl.Servico || info.Servico || {};
    const servicoList: any[] = Array.isArray(servicoRaw) ? servicoRaw : [servicoRaw];
    const servico = servicoList[0] || {};
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
    const { date: issueDate, inferred: dateInferred } = this.parseDateFlagged(dataEmissao);

    const operationType =
      prestCnpj === (this.companyCnpj || '')
        ? FiscalDocumentOperation.SAIDA
        : FiscalDocumentOperation.ENTRADA;

    const valorLiquido = this.toNumberOrNull(
      valoresNfse.ValorLiquidoNfse || valoresNfse.valorLiquidoNfse,
    );
    const valorServicos = this.toNumberOrNull(
      valoresServico.ValorServicos || valoresServico.valorServicos,
    );
    const baseCalculo = this.toNumberOrNull(
      valoresNfse.BaseCalculo || valoresServico.BaseCalculo,
    );
    // Total: ValorLiquidoNfse is the canonical "what arrived at the bank" amount
    // in Elotech. Fall back to ValorServicos then BaseCalculo.
    const totalValue = valorLiquido ?? valorServicos ?? baseCalculo ?? 0;

    const items: ParsedFiscalDocumentItem[] = servicoList
      .map((s) => {
        const v = s?.Valores || {};
        const code = s?.ItemListaServico
          ? String(s.ItemListaServico)
          : s?.itemListaServico
            ? String(s.itemListaServico)
            : null;
        const desc = String(s?.Discriminacao || s?.discriminacao || '');
        if (!code && !desc) return null;
        return {
          code,
          description: desc,
          quantity: null,
          unit: null,
          unitValue: null,
          totalValue:
            this.toNumberOrNull(v.ValorServicos || v.valorServicos) ?? totalValue,
        } as ParsedFiscalDocumentItem;
      })
      .filter((i): i is ParsedFiscalDocumentItem => i !== null);
    if (items.length === 0) {
      items.push({
        code: null,
        description: '',
        quantity: null,
        unit: null,
        unitValue: null,
        totalValue,
      });
    }

    const cancelled = !!(info.NfseCancelamento || info.Cancelada === 'true');
    const itemListaServico = servico.ItemListaServico
      ? String(servico.ItemListaServico)
      : null;

    return {
      accessKey: this.synthNfseKey(prestCnpj, issueDate, nfNumber),
      docType: FiscalDocumentType.NFSE,
      operationType,
      status: cancelled
        ? FiscalDocumentStatus.CANCELLED
        : FiscalDocumentStatus.AUTHORIZED,
      issueDate,
      dateInferred,
      totalValue,
      emitCnpj: prestCnpj,
      emitName: prest.RazaoSocial || prest.razaoSocial || null,
      emitIE: prest.InscricaoMunicipal ? String(prest.InscricaoMunicipal) : null,
      destCnpj: tomadCnpj || null,
      destCpf: tomadCpf || null,
      destName: tomad.RazaoSocial || tomad.razaoSocial || tomad.xNome || null,
      destEmail: tomad.Contato?.Email ? String(tomad.Contato.Email) : null,
      nfNumber: nfNumber || null,
      protocolNumber: info.CodigoVerificacao ? String(info.CodigoVerificacao) : null,
      issValue: this.toNumberOrNull(valoresServico.ValorIss || valoresServico.valorIss),
      issRate: this.toNumberOrNull(valoresServico.Aliquota || valoresServico.aliquota),
      issRetained:
        valoresServico.IssRetido != null
          ? String(valoresServico.IssRetido) === '1' ||
            String(valoresServico.IssRetido).toLowerCase() === 'true'
          : null,
      baseCalculo,
      valorLiquido,
      valorServicos,
      codigoTributacaoMunicipio: servico.CodigoTributacaoMunicipio
        ? String(servico.CodigoTributacaoMunicipio)
        : null,
      municipioPrestacao: servico.MunicipioPrestacaoServico
        ? String(servico.MunicipioPrestacaoServico)
        : servico.CodigoMunicipio
          ? String(servico.CodigoMunicipio)
          : null,
      itemListaServico,
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
    return this.parseDateFlagged(value).date;
  }

  /**
   * Parses an XML date and reports whether it had to be inferred (missing or
   * unparseable → "now"). Callers persist `inferred` so the UI can warn that
   * the issue date may be wrong.
   */
  private parseDateFlagged(value: unknown): { date: Date; inferred: boolean } {
    if (!value) return { date: new Date(), inferred: true };
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? { date: new Date(), inferred: true }
      : { date: parsed, inferred: false };
  }

  /** Like parseDate but returns null instead of "now" when missing/invalid. */
  private parseDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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
