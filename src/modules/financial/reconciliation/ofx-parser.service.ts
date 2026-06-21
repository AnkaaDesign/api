import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BankTransactionSubtype,
  BankTransactionType,
} from '@prisma/client';
import { ParsedOfxStatement, ParsedOfxTransaction } from './types/reconciliation.types';

// node-ofx-parser has no type defs; require dynamically to keep the rest of the
// codebase strictly typed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ofxParser: { parse(content: string): any } = require('node-ofx-parser');

@Injectable()
export class OfxParserService {
  private readonly logger = new Logger(OfxParserService.name);

  /**
   * Parses a Sicredi OFX file buffer or string.
   * Tolerates SGML (OFX 1.x) and XML (OFX 2.x).
   */
  parse(content: Buffer | string): ParsedOfxStatement {
    const raw = typeof content === 'string' ? content : content.toString('utf8');
    const normalized = this.normalize(raw);

    let parsed: any;
    try {
      parsed = ofxParser.parse(normalized);
    } catch (err) {
      this.logger.error(`OFX parse failed: ${(err as Error).message}`);
      throw new Error('Arquivo OFX inválido');
    }

    const ofx = parsed.OFX || parsed.ofx || parsed;
    const stmtRs =
      ofx?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS ??
      ofx?.bankmsgsrsv1?.stmttrnrs?.stmtrs ??
      ofx?.STMTRS ??
      ofx?.stmtrs;

    if (!stmtRs) {
      throw new Error('Arquivo OFX não contém extrato bancário (STMTRS ausente)');
    }

    const bankAcct = stmtRs.BANKACCTFROM || stmtRs.bankacctfrom || {};
    const tranList = stmtRs.BANKTRANLIST || stmtRs.banktranlist || {};

    const stmttrn = tranList.STMTTRN || tranList.stmttrn || [];
    const stmttrnArray = Array.isArray(stmttrn) ? stmttrn : [stmttrn];

    const bankCode = String(bankAcct.BANKID || bankAcct.bankid || '748');
    const transactions = stmttrnArray
      .filter((t: any) => t && (t.TRNAMT || t.trnamt) !== undefined)
      .map((t: any, index: number) => this.parseTransaction(t, index));

    // Sicredi packs the cooperativa (agência) and conta corrente into ACCTID
    // as a single 16-digit string: AAAACCCCCCCCCCCD (4-digit cooperativa +
    // 11-digit conta padded with leading zeros + 1-digit check digit).
    let agency = String(bankAcct.BRANCHID || bankAcct.branchid || '');
    let accountNumber = String(bankAcct.ACCTID || bankAcct.acctid || '');
    if (bankCode === '748' && !agency && accountNumber.length >= 8) {
      agency = accountNumber.slice(0, 4);
      accountNumber = accountNumber.slice(4);
    }

    return {
      bankCode,
      bankName: bankCode === '748' ? 'Sicredi' : `Banco ${bankCode}`,
      agency,
      accountNumber,
      ownerCnpj: null,
      periodStart: this.parseOfxDate(tranList.DTSTART || tranList.dtstart),
      periodEnd: this.parseOfxDate(tranList.DTEND || tranList.dtend),
      transactions,
    };
  }

  private parseTransaction(t: any, index = 0): ParsedOfxTransaction {
    const amount = parseFloat(String(t.TRNAMT || t.trnamt || '0').replace(',', '.'));
    const type =
      amount >= 0 ? BankTransactionType.CREDIT : BankTransactionType.DEBIT;
    const trnType = String(t.TRNTYPE || t.trntype || '');
    const rawMemo = String(t.MEMO || t.memo || '').trim();
    // Sicredi puts the user-typed PIX/TED description in the top-level <NAME>
    // tag (a direct child of <STMTTRN>), distinct from <PAYEE><NAME> which is
    // the OFX-spec US-check-payee block. Capture it so users see their own
    // descriptions, not just the bank's standardized MEMO string.
    const rawName = String(t.NAME || t.name || '').trim();
    const checkNum = String(t.CHECKNUM || t.checknum || '').trim() || null;
    const payee = t.PAYEE || t.payee;
    const payeeName = payee?.NAME || payee?.name || null;

    // Merge NAME into memo, deduping when NAME is already contained in MEMO.
    let memo: string | null;
    if (!rawName) {
      memo = rawMemo || null;
    } else if (rawMemo.toUpperCase().includes(rawName.toUpperCase())) {
      memo = rawMemo;
    } else {
      memo = rawMemo ? `${rawName} - ${rawMemo}` : rawName;
    }

    const rawDatePosted = String(t.DTPOSTED || t.dtposted || '');
    const rawAmount = String(t.TRNAMT || t.trnamt || '');
    return {
      // Prefer the bank-provided FITID. When absent, synthesize a DETERMINISTIC
      // id from DTPOSTED + TRNAMT + MEMO + the line's position in the statement.
      // The old `${Date.now()}_${Math.random()}` produced a different id on every
      // import, defeating the (bankCode, agency, accountNumber, fitId) dedupe and
      // duplicating rows on re-import. The seq disambiguates two truly identical
      // same-day/same-amount/same-memo lines so neither is silently dropped.
      fitId: String(
        t.FITID ||
          t.fitid ||
          `SYN-${createHash('sha1')
            .update(`${rawDatePosted}|${rawAmount}|${memo ?? ''}|${index}`)
            .digest('hex')
            .slice(0, 24)}`,
      ),
      postedAt: this.parseOfxDate(t.DTPOSTED || t.dtposted),
      amount,
      type,
      subtype: this.inferSubtype(trnType, memo),
      rawTrnType: trnType || null,
      memo,
      counterpartyCnpjCpf: this.extractCnpjCpf(memo),
      counterpartyName: payeeName || rawName || this.extractCounterpartyName(memo),
      runningBalance: null,
      ...(checkNum ? { checkNum } : {}),
    } as ParsedOfxTransaction;
  }

  /**
   * Best-effort SGML normalization: Sicredi exports valid OFX 1.x SGML, but
   * some library parsers prefer balanced tags. node-ofx-parser handles SGML
   * natively; this hook is here for known quirks.
   */
  private normalize(raw: string): string {
    return raw.replace(/\r\n/g, '\n');
  }

  private parseOfxDate(value: unknown): Date {
    if (!value) return new Date();
    const s = String(value).replace(/\[.*\]$/, '');
    // YYYYMMDD or YYYYMMDDHHMMSS or YYYYMMDDHHMMSS.fff
    const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) {
      const parsed = new Date(s);
      return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    }
    // Bank reconciliation only cares about the calendar day, not the sub-day
    // timing. Brazilian banks (Sicredi etc) emit DTPOSTED in local São Paulo
    // time without a timezone suffix — if we parsed the time as UTC, a 00:00
    // posting would shift back to 21:00 of the previous day in PT-BR locale,
    // making Monday transactions look like Sunday ones in the UI. Force noon
    // UTC always so the calendar day is unambiguous in every timezone.
    const [, y, mo, d] = m;
    return new Date(`${y}-${mo}-${d}T12:00:00Z`);
  }

  private inferSubtype(trnType: string, memo: string | null): BankTransactionSubtype {
    const haystack = `${trnType} ${memo || ''}`.toUpperCase();
    // Order matters: more specific patterns first.
    //
    // Tribute memos (DARF / GPS / arrecadação) deliberately route to OUTROS so
    // the classifier's memo-regex layer downstream tags them as category
    // TRIBUTO. This needs to win OVER the generic TARIFA pattern below,
    // otherwise a memo like "TARIFA REF DARF" (rare but possible) would get
    // subtype TARIFA and the classifier's subtype fast path would tag it as
    // category TARIFA_BANCARIA instead of TRIBUTO.
    if (/DARF|ARRECADAC|TRIBUTO|IMPOSTO/.test(haystack)) return BankTransactionSubtype.OUTROS;
    if (/\bIOF\b/.test(haystack)) return BankTransactionSubtype.IOF;
    if (/TARIFA|TAR\.BANC|TAR BANC/.test(haystack)) return BankTransactionSubtype.TARIFA;
    if (/\bPIX\b/.test(haystack)) return BankTransactionSubtype.PIX;
    if (/\bTED\b/.test(haystack)) return BankTransactionSubtype.TED;
    if (/\bDOC\b/.test(haystack)) return BankTransactionSubtype.DOC;
    if (/BOLETO|COBRAN[CÇ]A|LIQUIDACAO/.test(haystack)) return BankTransactionSubtype.BOLETO;
    if (/CART[AÃ]O|CARD|COMPRAS NACIONAIS|COMPRA NACIONAL/.test(haystack))
      return BankTransactionSubtype.CARTAO;
    if (/TRANSFER[EÊ]NCIA|TRANSF/.test(haystack))
      return BankTransactionSubtype.TRANSFERENCIA;
    if (/ESTORNO|DEVOLU[CÇ][AÃ]O/.test(haystack)) return BankTransactionSubtype.ESTORNO;
    if (/RENDIMENTO|JUROS/.test(haystack)) return BankTransactionSubtype.RENDIMENTO;
    return BankTransactionSubtype.OUTROS;
  }

  /**
   * Extracts CNPJ/CPF from a Sicredi memo without concatenating unrelated digit
   * runs. Matching priority:
   *   1. Formatted CNPJ (XX.XXX.XXX/XXXX-XX)
   *   2. Formatted CPF  (XXX.XXX.XXX-XX)
   *   3. Standalone 14-digit run (not adjacent to other digits)
   *   4. Standalone 11-digit run (not adjacent to other digits)
   */
  private extractCnpjCpf(memo: string | null): string | null {
    if (!memo) return null;
    const cnpjFmt = memo.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    if (cnpjFmt) return cnpjFmt[0].replace(/\D/g, '');
    const cpfFmt = memo.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    if (cpfFmt) return cpfFmt[0].replace(/\D/g, '');
    const cnpjPlain = memo.match(/(?<!\d)\d{14}(?!\d)/);
    if (cnpjPlain) return cnpjPlain[0];
    const cpfPlain = memo.match(/(?<!\d)\d{11}(?!\d)/);
    if (cpfPlain) return cpfPlain[0];
    return null;
  }

  private extractCounterpartyName(memo: string | null): string | null {
    if (!memo) return null;
    // Remove CNPJ/CPF digits and common prefixes; keep the alphabetic portion.
    const cleaned = memo
      .replace(/\d{11,14}/g, '')
      .replace(/^[\s\-:/]+/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned || null;
  }
}
