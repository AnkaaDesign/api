import { memoFingerprint, nameSimilarity, nameTokens } from './text-normalization';

describe('memoFingerprint', () => {
  it('collapses noisy OFX prefixes to the supplier core', () => {
    const fp = memoFingerprint('PAGAMENTO PIX-PIX_DEB ACME TINTAS RIBEIRAO PRETO');
    expect(fp).toBe('acme preto ribeirao tintas');
  });

  it('produces the same fingerprint across different months for the same supplier', () => {
    const a = memoFingerprint(
      'PIX-PIX_DEB ACME TINTAS RIBEIRAO PRETO 12.345.678/0001-90 15/03/2026 R$ 1.234,56',
    );
    const b = memoFingerprint(
      'TED CRED ACME TINTAS RIBEIRAO PRETO 12345678000190 20/04/2026 R$ 987,00',
    );
    expect(a).toBe(b);
    expect(a).toBe('acme preto ribeirao tintas');
  });

  it('is order-independent — tokens get sorted', () => {
    expect(memoFingerprint('TINTAS ACME')).toBe(memoFingerprint('ACME TINTAS'));
  });

  it('strips formatted and unformatted CNPJ/CPF', () => {
    expect(memoFingerprint('PIX 12.345.678/0001-90 FORNECEDOR XYZ')).toBe(
      memoFingerprint('PIX FORNECEDOR XYZ'),
    );
    expect(memoFingerprint('PIX 12345678000190 XYZ')).toBe(memoFingerprint('PIX XYZ'));
    expect(memoFingerprint('PIX 123.456.789-01 XYZ')).toBe(memoFingerprint('PIX XYZ'));
  });

  it('strips dates in common Brazilian formats', () => {
    expect(memoFingerprint('PIX 15/03/2026 ACME')).toBe(memoFingerprint('PIX ACME'));
    expect(memoFingerprint('PIX 15-03-2026 ACME')).toBe(memoFingerprint('PIX ACME'));
    expect(memoFingerprint('PIX 15.03.26 ACME')).toBe(memoFingerprint('PIX ACME'));
  });

  it('strips R$ amounts', () => {
    expect(memoFingerprint('PIX R$ 1.234,56 ACME')).toBe(memoFingerprint('PIX ACME'));
    expect(memoFingerprint('PIX r$ 999 ACME')).toBe(memoFingerprint('PIX ACME'));
  });

  it('normalises accents and case', () => {
    expect(memoFingerprint('Açaí Distribuidora')).toBe(
      memoFingerprint('ACAI DISTRIBUIDORA'),
    );
  });

  it('drops short noise tokens (<3 chars) and stopword tokens', () => {
    expect(memoFingerprint('PIX TED DOC PAGTO LTDA')).toBeNull();
    expect(memoFingerprint('PIX A B C D E F')).toBeNull();
  });

  it('returns null for empty or whitespace input', () => {
    expect(memoFingerprint(null)).toBeNull();
    expect(memoFingerprint('')).toBeNull();
    expect(memoFingerprint('   ')).toBeNull();
  });

  it('differentiates suppliers whose only shared term is a legal-form word', () => {
    const a = memoFingerprint('PIX ACME LTDA');
    const b = memoFingerprint('PIX OUTRA LTDA');
    expect(a).toBe('acme');
    expect(b).toBe('outra');
    expect(a).not.toBe(b);
  });
});

describe('nameSimilarity', () => {
  it('returns 1.0 when one set is a subset of the other (overlap)', () => {
    // "ACME TINTAS" fully contained in "ACME TINTAS RIBEIRAO PRETO"
    expect(nameSimilarity('ACME TINTAS', 'ACME TINTAS RIBEIRAO PRETO')).toBe(1);
  });

  it('returns 0 for disjoint names', () => {
    expect(nameSimilarity('ACME TINTAS', 'BETA COMBUSTIVEIS')).toBe(0);
  });

  it('returns 0 for null/empty inputs', () => {
    expect(nameSimilarity(null, 'ACME')).toBe(0);
    expect(nameSimilarity('ACME', null)).toBe(0);
    expect(nameSimilarity('', '')).toBe(0);
  });

  it('handles partial overlap below 1.0', () => {
    // 1 shared token out of (2 + 2 - 1) = 3 → 0.33 jaccard, 0.5 overlap; max = 0.5
    const sim = nameSimilarity('ACME TINTAS', 'BETA TINTAS');
    expect(sim).toBeCloseTo(0.5, 5);
  });
});

describe('nameTokens', () => {
  it('drops legal-form noise and short tokens', () => {
    const tokens = nameTokens('ACME COMERCIO DE TINTAS LTDA');
    expect(tokens.has('acme')).toBe(true);
    expect(tokens.has('tintas')).toBe(true);
    expect(tokens.has('comercio')).toBe(false);
    expect(tokens.has('ltda')).toBe(false);
    expect(tokens.has('de')).toBe(false);
  });
});
