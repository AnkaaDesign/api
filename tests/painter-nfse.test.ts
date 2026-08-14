/**
 * Guarda da NFS-e do aerografista — DPS nacional 1.01, assinatura e cofre do A1.
 *
 * Este arquivo protege as coisas que, quando quebram, quebram em SILÊNCIO: a
 * SEFIN devolve "assinatura inválida" ou um código de rejeição de leiaute, e não
 * há como saber qual das dez regras foi violada sem reler o ANEXO I.
 *
 * O que está protegido aqui:
 *
 *  1. AS REGRAS DE MEI QUE SÃO OMISSÕES. O ponto contraintuitivo do regime é que
 *     o MEI não manda ISS zerado — não manda ISS nenhum. E0600 proíbe alíquota,
 *     E0676 proíbe o grupo tribFed, E0162 proíbe regApTribSN, E0710 proíbe
 *     pTotTribSN. Um serializador ingênuo emitiria `<pAliq>0</pAliq>` e a nota
 *     seria recusada. Testar ausência é a única forma de travar isso.
 *
 *  2. tpRetISSQN = 1 OBRIGATÓRIO (E0583). MEI nunca sofre retenção de ISS porque
 *     o imposto já está no DAS. Deixar o tomador reter seria erro fiscal com
 *     dinheiro real envolvido.
 *
 *  3. O PREFIXO DE NAMESPACE (E1228). É o erro que mais derruba integração nova:
 *     `<ns1:DPS>` é rejeitado, tem de ser `<DPS xmlns="...">`. Igualmente para a
 *     assinatura: `ds:Signature` é evitado.
 *
 *  4. O <X509Certificate> NO KEYINFO. O assinador anterior deste repositório
 *     usava `keyInfoProvider`, API removida no xml-crypto v4 e ignorada em
 *     silêncio na v6 — o XML saía SEM certificado no KeyInfo e era recusado sem
 *     pista nenhuma. Aqui a assinatura é gerada E VERIFICADA de volta.
 *
 *  5. O Id DA DPS. 45 caracteres, "DPS" + 42 dígitos, com a composição exata
 *     município+tipo+inscrição+série+número. Id malformado falha na validação de
 *     esquema, antes da assinatura, com mensagem confusa.
 *
 *  6. O ENVELOPE DE CIFRAGEM. Ida e volta do PFX e da senha, e a garantia de que
 *     trocar o AAD (mover o blob de um certificado para outro) FALHA em vez de
 *     decifrar.
 *
 * Rodar: npx tsx tests/painter-nfse.test.ts
 */

import * as forge from 'node-forge';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import {
  buildCancelEventXml,
  buildDpsId,
  buildDpsXml,
  buildServiceDescription,
  formatCompetence,
  formatDpsDateTime,
} from '../src/modules/integrations/nfse/painter/dps.builder';
import { DpsSignerService } from '../src/modules/integrations/nfse/painter/dps.signer';
import {
  SefinNacionalClient,
  type SefinError,
} from '../src/modules/integrations/nfse/painter/sefin-nacional.client';
import {
  formatAccessKey,
  formatCnpjCpf,
  formatCurrency,
  parseNfseXml,
} from '../src/modules/integrations/nfse/painter/danfse.generator';
import {
  BLOCK_LINE_WIDTH,
  COL,
  COLLAPSED_H,
  DESCRICAO,
  EMPTY,
  FONT_SIZE,
  HEADER_TEXT,
  NT_VERSION as LAYOUT_NT_VERSION,
  PAGE_BORDER_WIDTH,
  QR,
  WIDTH,
  cm,
} from '../src/modules/integrations/nfse/painter/danfse.layout';
import {
  decryptPassword,
  decryptPfx,
  encryptPassword,
  encryptPfx,
  fingerprintPfx,
  parsePfx,
  resolveKek,
  unwrapDek,
  wrapNewDek,
} from '../src/modules/integrations/nfse/painter/fiscal-certificate.crypto';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const PAINTER_CNPJ = '12345678000195';
const PAINTER_MUNICIPALITY = '4109807'; // Ibiporã-PR

function baseInput() {
  return {
    ambiente: 2 as const,
    emitidoEm: new Date('2026-08-14T18:30:45.000Z'),
    competencia: new Date('2026-08-10T15:00:00.000Z'),
    serie: '00001',
    nDps: 42n,
    emitente: {
      cnpj: PAINTER_CNPJ,
      inscricaoMunicipal: null,
      municipioIbge: PAINTER_MUNICIPALITY,
      opSimpNac: 2,
      regEspTrib: 0,
    },
    tomador: {
      cnpj: '13636938000144',
      nome: 'S. RODRIGUES & G. RODRIGUES LTDA',
      municipioIbge: PAINTER_MUNICIPALITY,
      cep: '86200-000',
      logradouro: 'Rua Luis Carlos Zani',
      numero: '2493',
      bairro: 'Jardim Santa Paula',
      email: 'ankaadesign@outlook.com',
    },
    servico: {
      municipioPrestacaoIbge: PAINTER_MUNICIPALITY,
      cTribNac: '141201',
      cTribMun: null,
      descricao: 'Aerografia de dragão na lateral direita',
    },
    valorServico: 1850.5,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Identificação da DPS (TSIdDPS)');
{
  const id = buildDpsId({
    municipioIbge: PAINTER_MUNICIPALITY,
    documento: PAINTER_CNPJ,
    serie: '1',
    nDps: 42,
  });

  check('tem 45 caracteres', id.length === 45, `${id.length}: ${id}`);
  check('casa com o padrão DPS + 42 dígitos', /^DPS\d{42}$/.test(id), id);
  check('começa pelo município', id.slice(3, 10) === PAINTER_MUNICIPALITY, id.slice(3, 10));
  check('marca tipo de inscrição 2 (CNPJ)', id[10] === '2', id[10]);
  check('inscrição vem preenchida à esquerda', id.slice(11, 25) === PAINTER_CNPJ, id.slice(11, 25));
  check('série ocupa 5 posições', id.slice(25, 30) === '00001', id.slice(25, 30));
  check('número ocupa 15 posições', id.slice(30) === '000000000000042', id.slice(30));

  let rejected = false;
  try {
    buildDpsId({ municipioIbge: '410', documento: PAINTER_CNPJ, serie: '1', nDps: 1 });
  } catch {
    rejected = true;
  }
  check('município curto é rejeitado em vez de gerar Id inválido', rejected);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Regras de MEI — o que NÃO pode aparecer no XML');
{
  const { xml } = buildDpsXml(baseInput());

  check('declara opSimpNac = 2 (Optante MEI)', xml.includes('<opSimpNac>2</opSimpNac>'));
  check('declara regEspTrib = 0 (E0174)', xml.includes('<regEspTrib>0</regEspTrib>'));
  check('NÃO emite regApTribSN (E0162)', !xml.includes('regApTribSN'));
  check('NÃO emite alíquota pAliq (E0600)', !xml.includes('pAliq'));
  check('NÃO emite o grupo tribFed (E0676)', !xml.includes('<tribFed>'));
  check('NÃO emite pTotTribSN (E0710)', !xml.includes('pTotTribSN'));
  check('NÃO emite vDedRed (E0436)', !xml.includes('vDedRed'));
  check('NÃO emite benefício municipal BM (E0534)', !xml.includes('<BM>'));
  check(
    'tpRetISSQN é obrigatoriamente 1 / não retido (E0583)',
    xml.includes('<tpRetISSQN>1</tpRetISSQN>'),
  );
  check('tributação é operação tributável', xml.includes('<tribISSQN>1</tribISSQN>'));
  check('totTrib usa indTotTrib = 0', xml.includes('<indTotTrib>0</indTotTrib>'));

  check(
    'inscrição municipal ausente é OMITIDA, não enviada vazia (E0116)',
    !xml.includes('<IM>') && !xml.includes('<IM/>'),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Estrutura e recepção');
{
  const { xml, id } = buildDpsXml(baseInput());

  check('declara UTF-8', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  check('não tem BOM (E1229)', !xml.startsWith('﻿'));
  check(
    'usa namespace PADRÃO, sem prefixo (E1228)',
    xml.includes('<DPS xmlns="http://www.sped.fazenda.gov.br/nfse"') && !/<\w+:DPS/.test(xml),
  );
  check('versão do leiaute é 1.01', xml.includes('versao="1.01"'));
  check('infDPS carrega o Id', xml.includes(`<infDPS Id="${id}">`));
  check('tpEmit = 1 (prestador)', xml.includes('<tpEmit>1</tpEmit>'));
  check('cLocEmi é o município do emitente', xml.includes(`<cLocEmi>${PAINTER_MUNICIPALITY}</cLocEmi>`));
  check('código de tributação nacional 141201 (funilaria/lanternagem)', xml.includes('<cTribNac>141201</cTribNac>'));

  check('valor com 2 casas decimais', xml.includes('<vServ>1850.50</vServ>'));

  check(
    'data/hora sem milissegundos e com offset -03:00',
    /<dhEmi>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00<\/dhEmi>/.test(xml),
    xml.match(/<dhEmi>[^<]+<\/dhEmi>/)?.[0],
  );
  check(
    'competência é data-calendário em São Paulo',
    xml.includes('<dCompet>2026-08-10</dCompet>'),
    xml.match(/<dCompet>[^<]+<\/dCompet>/)?.[0],
  );

  // 21:00 UTC de 10/08 é 18:00 em SP — mesmo dia. Já 02:00 UTC de 11/08 é 23:00
  // do dia 10 em SP, e usar o dia UTC erraria a competência em um mês inteiro
  // quando a virada cai no dia 1º.
  check(
    'virada de dia UTC não muda a competência de SP',
    formatCompetence(new Date('2026-09-01T02:00:00.000Z')) === '2026-08-31',
    formatCompetence(new Date('2026-09-01T02:00:00.000Z')),
  );
  check(
    'formatação de data/hora reflete o fuso de SP',
    formatDpsDateTime(new Date('2026-08-14T18:30:45.000Z')) === '2026-08-14T15:30:45-03:00',
    formatDpsDateTime(new Date('2026-08-14T18:30:45.000Z')),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Escapes e validações de entrada');
{
  const input = baseInput();
  input.servico.descricao = 'Aerografia "chamas" & sombras <lateral>';
  const { xml } = buildDpsXml(input);

  check(
    'descrição com & < > é escapada',
    xml.includes('Aerografia &quot;chamas&quot; &amp; sombras &lt;lateral&gt;'),
    xml.match(/<xDescServ>[^<]*/)?.[0],
  );

  const withIM = buildDpsXml({
    ...baseInput(),
    emitente: { ...baseInput().emitente, inscricaoMunicipal: '98765' },
  });
  check('inscrição municipal presente é emitida', withIM.xml.includes('<IM>98765</IM>'));

  for (const [label, mutate] of [
    ['valor zero', (i: any) => (i.valorServico = 0)],
    ['valor negativo', (i: any) => (i.valorServico = -10)],
    ['CNPJ inválido', (i: any) => (i.emitente.cnpj = '123')],
  ] as const) {
    const bad = baseInput();
    mutate(bad as any);
    let threw = false;
    try {
      buildDpsXml(bad);
    } catch {
      threw = true;
    }
    check(`${label} é rejeitado antes de virar XML`, threw);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Assinatura XMLDSig');
{
  // Certificado autoassinado só para o teste — não toca em nada do ICP-Brasil.
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: `AEROGRAFISTA TESTE:${PAINTER_CNPJ}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const material = {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
    chainPem: [],
  };

  const signer = new DpsSignerService();
  const { xml } = buildDpsXml(baseInput());
  const { signedXml, packed } = signer.signAndPack(xml, material, 'infDPS');

  check('assinatura foi inserida', signedXml.includes('<Signature'));
  check(
    'KeyInfo carrega o X509Certificate (a regressão do assinador antigo)',
    signedXml.includes('<X509Certificate>'),
  );
  check('assinatura sem prefixo ds:', !signedXml.includes('<ds:Signature'));
  check(
    'canonicalização declarada é a INCLUSIVA exigida pelo esquema',
    signedXml.includes('http://www.w3.org/TR/2001/REC-xml-c14n-20010315'),
  );
  check(
    'referência aponta para o Id do infDPS',
    signedXml.includes(`URI="#${buildDpsId({ municipioIbge: PAINTER_MUNICIPALITY, documento: PAINTER_CNPJ, serie: '00001', nDps: 42 })}"`),
    signedXml.match(/URI="[^"]*"/)?.[0],
  );
  check(
    'Signature é irmã de infDPS, dentro de DPS',
    signedXml.indexOf('</infDPS>') < signedXml.indexOf('<Signature'),
  );

  // A prova de fogo: verificar a assinatura de volta.
  const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
  const signatureNode = doc.getElementsByTagName('Signature')[0];
  const verifier = new SignedXml({ publicCert: material.certificatePem });
  verifier.loadSignature(signatureNode as any);
  let verified = false;
  let verifyError = '';
  try {
    verified = verifier.checkSignature(signedXml);
  } catch (error) {
    verifyError = error instanceof Error ? error.message : String(error);
  }
  check('a assinatura gerada VERIFICA', verified, verifyError);

  // Qualquer reserialização depois de assinar invalida o digest — é por isso que
  // o XML transmitido tem de ser a string devolvida, byte a byte.
  const tampered = signedXml.replace('<vServ>1850.50</vServ>', '<vServ>1.00</vServ>');
  let tamperVerified = true;
  try {
    const tamperedDoc = new DOMParser().parseFromString(tampered, 'text/xml');
    const v2 = new SignedXml({ publicCert: material.certificatePem });
    v2.loadSignature(tamperedDoc.getElementsByTagName('Signature')[0] as any);
    tamperVerified = v2.checkSignature(tampered);
  } catch {
    tamperVerified = false;
  }
  check('adulterar o valor invalida a assinatura', !tamperVerified);

  // O corpo vai gzip PRIMEIRO, base64 depois (E1225 quando invertido).
  const unpacked = require('node:zlib')
    .gunzipSync(Buffer.from(packed, 'base64'))
    .toString('utf-8');
  check('o pacote é gzip→base64 e reabre idêntico ao assinado', unpacked === signedXml);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Evento de cancelamento');
{
  const chave = '1'.repeat(50);
  const { xml, id } = buildCancelEventXml({
    ambiente: 2,
    chaveAcesso: chave,
    cnpjAutor: PAINTER_CNPJ,
    ocorridoEm: new Date('2026-08-15T12:00:00.000Z'),
    nPedRegEvento: 1,
    descricao: 'Cancelamento de NFS-e',
    motivoCodigo: 1,
    motivo: 'Erro na emissão: valor divergente do combinado com o prestador.',
  });

  // Os dois asserts abaixo travam correções descobertas contra a SEFIN real, em
  // produção restrita — cada uma custou uma rejeição E1235.
  //
  // 1) O identificador do PEDIDO é `TSIdPedRegEvt` = `PRE[0-9]{56}` =
  //    "PRE" + chave(50) + tipo do evento(6). SEM sequencial.
  //    "EVT" + 59 dígitos é o `TSIdEvento`, que é o id do EVENTO que a SEFIN
  //    gera em resposta — não o do nosso pedido. Confundir os dois é rejeição.
  check('Id do pedido tem 59 caracteres (PRE + 56)', id.length === 59, `${id.length}`);
  check('Id casa com o padrão PRE + 56 dígitos', /^PRE\d{56}$/.test(id), id);
  check('Id começa por PRE e embute a chave', id.startsWith(`PRE${chave}`));
  check('Id termina com o tipo do evento sem o "e"', id.endsWith('101101'), id.slice(-6));

  // 2) `nPedRegEvento` NÃO é filho de infPedReg: depois de chNFSe vem direto o
  //    elemento do evento. Enviá-lo devolve "has invalid child element".
  check('NÃO emite nPedRegEvento dentro de infPedReg', !xml.includes('<nPedRegEvento>'));

  check('usa namespace padrão sem prefixo', xml.includes('<pedRegEvento xmlns='));
  check('declara o tipo de evento e101101', xml.includes('<e101101>'));
  check('carrega o motivo estruturado', xml.includes('<cMotivo>1</cMotivo>'));
  const fimChave = xml.indexOf('</chNFSe>') + '</chNFSe>'.length;
  const entreChaveEEvento = xml.slice(fimChave, xml.indexOf('<e101101>'));
  check(
    'ordem dos filhos: chNFSe imediatamente antes do evento',
    fimChave > 0 && entreChaveEEvento.trim() === '',
    JSON.stringify(entreChaveEEvento),
  );

  let rejectedShortKey = false;
  try {
    buildCancelEventXml({
      ambiente: 2,
      chaveAcesso: '123',
      cnpjAutor: PAINTER_CNPJ,
      ocorridoEm: new Date(),
      nPedRegEvento: 1,
      descricao: 'x',
      motivoCodigo: 1,
      motivo: 'y',
    });
  } catch {
    rejectedShortKey = true;
  }
  check('chave de acesso com tamanho errado é rejeitada', rejectedShortKey);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Cofre do certificado (cifragem em envelope)');
{
  process.env.FISCAL_CERT_KEK = Buffer.alloc(32, 7).toString('base64');
  const { key: kek, derivedFromJwt } = resolveKek(process.env);
  check('KEK dedicada é usada quando configurada', !derivedFromJwt);

  const pfxBytes = Buffer.from('conteúdo-binário-do-pfx-de-teste', 'utf-8');
  const password = 'senha-secreta-123';
  const fingerprint = fingerprintPfx(pfxBytes);

  check('impressão digital é SHA-256 em hex', /^[0-9a-f]{64}$/.test(fingerprint));
  check(
    'a mesma entrada gera a mesma impressão',
    fingerprintPfx(Buffer.from('conteúdo-binário-do-pfx-de-teste', 'utf-8')) === fingerprint,
  );

  const { dek, wrappedDek } = wrapNewDek(fingerprint, kek);
  const pfxBlob = encryptPfx(pfxBytes, dek, fingerprint);
  const pwdBlob = encryptPassword(password, dek, fingerprint);

  check('o PFX cifrado não contém o texto original', !pfxBlob.ciphertext.includes(pfxBytes));
  check('a senha cifrada não contém a senha original', !pwdBlob.ciphertext.includes('senha'));

  const dekBack = unwrapDek(wrappedDek, fingerprint, kek);
  check('a DEK volta idêntica', dekBack.equals(dek));
  check('o PFX volta idêntico', decryptPfx(pfxBlob, dekBack, fingerprint).equals(pfxBytes));
  check('a senha volta idêntica', decryptPassword(pwdBlob, dekBack, fingerprint) === password);

  // O AAD amarra o blob ao certificado: mover a linha de um certificado para
  // outro precisa FALHAR, não decifrar em silêncio.
  let wrongAadFailed = false;
  try {
    decryptPfx(pfxBlob, dekBack, 'outra-impressao-digital');
  } catch {
    wrongAadFailed = true;
  }
  check('decifrar com outro AAD falha (blob não é transplantável)', wrongAadFailed);

  let wrongKekFailed = false;
  try {
    unwrapDek(wrappedDek, fingerprint, Buffer.alloc(32, 9));
  } catch {
    wrongKekFailed = true;
  }
  check('desembrulhar a DEK com KEK errada falha', wrongKekFailed);

  let tamperedFailed = false;
  try {
    const corrupted = Buffer.from(pfxBlob.ciphertext);
    corrupted[0] ^= 0xff;
    decryptPfx({ ...pfxBlob, ciphertext: corrupted }, dekBack, fingerprint);
  } catch {
    tamperedFailed = true;
  }
  check('adulterar o ciphertext falha na autenticação GCM', tamperedFailed);

  let shortKekRejected = false;
  try {
    resolveKek({ FISCAL_CERT_KEK: Buffer.alloc(16, 1).toString('base64') } as NodeJS.ProcessEnv);
  } catch {
    shortKekRejected = true;
  }
  check('KEK com tamanho errado é rejeitada no boot', shortKekRejected);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Leitura do PFX');
{
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0abc';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: `AEROGRAFISTA TESTE:${PAINTER_CNPJ}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const password = 'pfx-teste';
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  const pfx = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');

  const parsed = parsePfx(pfx, password);
  check('extrai a chave privada em PEM', parsed.privateKeyPem.includes('PRIVATE KEY'));
  check('extrai o certificado em PEM', parsed.certificatePem.includes('BEGIN CERTIFICATE'));
  check(
    'lê o CNPJ pela convenção de CN "RAZÃO SOCIAL:CNPJ"',
    parsed.holderDocument === PAINTER_CNPJ,
    parsed.holderDocument ?? 'null',
  );
  check('reconhece como pessoa jurídica', !parsed.holderIsIndividual);
  check('lê a validade', parsed.notAfter.getUTCFullYear() === 2027);

  let wrongPassword = '';
  try {
    parsePfx(pfx, 'senha-errada');
  } catch (error) {
    wrongPassword = error instanceof Error ? error.message : String(error);
  }
  check(
    'senha errada devolve mensagem em pt-BR pronta para a tela',
    wrongPassword === 'Senha do certificado incorreta.',
    wrongPassword,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Leitura do erro devolvido pela SEFIN');
{
  const client = new SefinNacionalClient();
  const parse = (status: number, body: unknown) =>
    (client as unknown as { parseError(s: number, b: unknown): SefinError }).parseError(status, body);

  // Corpo REAL capturado de uma rejeição em produção restrita (14/08/2026).
  // As chaves vêm com INICIAL MAIÚSCULA — "Codigo"/"Descricao" —, e foi
  // exatamente isso que a primeira versão do parser não previu: ela caía num
  // String(item) e gravava "[object Object]", descartando o único dado que
  // permitia descobrir a causa.
  const real = parse(400, {
    tipoAmbiente: 2,
    versaoAplicativo: 'SefinNacional_1.6.0',
    dataHoraProcessamento: '2026-08-14T11:33:36.5140055-03:00',
    idDPS: 'DPS410980725111581800019000001000000000000001',
    erros: [
      {
        Codigo: 'E0041',
        Descricao: 'O município emissor não corresponde ao município do emitente MEI no CNPJ.',
      },
    ],
  });

  check('nunca produz "[object Object]"', !real.message.includes('[object Object]'), real.message);
  check('extrai o código do erro', real.code === 'E0041', String(real.code));
  check(
    'preserva a descrição legível',
    real.message.includes('município emissor não corresponde'),
    real.message,
  );
  check('classifica 400 como permanente (não adianta repetir)', real.permanent);

  // Variantes de formato que a documentação menciona.
  const lower = parse(400, { erros: [{ codigo: 'E0116', descricao: 'IM obrigatória', complemento: 'prest' }] });
  check('aceita chaves minúsculas', lower.code === 'E0116' && lower.message.includes('IM obrigatória'));
  check('anexa o complemento', lower.message.includes('(prest)'), lower.message);

  const rfc = parse(400, { title: 'Bad Request', detail: 'Falha na descompactação' });
  check('aceita RFC 7807', rfc.message.includes('Falha na descompactação'), rfc.message);

  // O caso que originou o bug: formato totalmente inesperado. Tem de sobreviver
  // como JSON legível, nunca virar "[object Object]".
  const unknown = parse(422, { algoNovo: [{ campoDesconhecido: 'valor', outro: 42 }] });
  check(
    'formato desconhecido é preservado como JSON',
    !unknown.message.includes('[object Object]') && unknown.message.includes('campoDesconhecido'),
    unknown.message,
  );

  const empty = parse(500, {});
  check('corpo vazio vira mensagem explicativa', empty.message.includes('500'), empty.message);
  check('5xx é transitório (a SEFIN pode voltar)', !empty.permanent);

  const noCert = parse(496, {});
  check('496 explica a falta de certificado cliente', noCert.message.includes('496') && noCert.permanent);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Serialização de BigInt');
{
  // nDps e File.size são BigInt. Sem o polyfill, JSON.stringify LANÇA e o
  // Express devolve 500 ao serializar a resposta — foi o que derrubou
  // GET /airbrushings assim que a listagem passou a incluir a NFS-e.
  require('../src/polyfills');
  let serialized = '';
  let threw = false;
  try {
    serialized = JSON.stringify({ nDps: 42n, size: 9007199254740993n });
  } catch {
    threw = true;
  }
  check('JSON.stringify não lança com BigInt', !threw);
  check('BigInt vira string (e não number, que perderia precisão)', serialized.includes('"42"'), serialized);
  check(
    'valor acima de MAX_SAFE_INTEGER sobrevive intacto',
    serialized.includes('"9007199254740993"'),
    serialized,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ DANFSe — leitura do XML autorizado');
{
  // Recorte fiel de uma NFS-e REAL autorizada pela SEFIN em 14/08/2026, com
  // tpAmb trocado para 1 (produção) para provar a distinção abaixo.
  const nfseXml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infNFSe Id="NFS41137002251115818000190000000000000226080664079124">
    <xLocEmi>Londrina</xLocEmi>
    <xLocPrestacao>Ibipora</xLocPrestacao>
    <nNFSe>2</nNFSe>
    <cLocIncid>4113700</cLocIncid>
    <ambGer>2</ambGer>
    <tpEmis>1</tpEmis>
    <cStat>100</cStat>
    <dhProc>2026-08-14T11:43:10-03:00</dhProc>
    <emit>
      <CNPJ>51115818000190</CNPJ>
      <xNome>51.115.818 MARCOS AURELIO LIMA DE SOUZA</xNome>
    </emit>
    <valores><vLiq>5.00</vLiq></valores>
    <DPS>
      <infDPS Id="DPS411370025111581800019000001000000000000002">
        <tpAmb>1</tpAmb>
        <dhEmi>2026-08-14T11:43:10-03:00</dhEmi>
        <serie>00001</serie>
        <nDPS>2</nDPS>
        <dCompet>2026-08-14</dCompet>
        <tpEmit>1</tpEmit>
        <cLocEmi>4113700</cLocEmi>
        <prest><CNPJ>51115818000190</CNPJ><regTrib><opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
        <toma><CNPJ>13636938000144</CNPJ><xNome>S. RODRIGUES &amp; G. RODRIGUES LTDA</xNome></toma>
        <serv><locPrest><cLocPrestacao>4109807</cLocPrestacao></locPrest><cServ><cTribNac>141201</cTribNac><xDescServ>Aerografia</xDescServ></cServ></serv>
        <valores><vServPrest><vServ>5.00</vServ></vServPrest></valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

  const data = parseNfseXml(nfseXml);

  check('chave derivada do Id tem 50 dígitos', /^\d{50}$/.test(data.chaveAcesso ?? ''), String(data.chaveAcesso));
  check('lê o número da NFS-e', data.numeroNfse === '2', String(data.numeroNfse));
  check('série preserva os zeros à esquerda', data.serieDps === '00001', String(data.serieDps));
  check(
    'prestador vem de infNFSe/emit (a DPS não traz o nome)',
    data.prestador.nome?.includes('MARCOS AURELIO') === true,
    String(data.prestador.nome),
  );
  check('tomador é a Ankaa', data.tomador.documento === '13636938000144', String(data.tomador.documento));
  check('reconhece MEI (opSimpNac = 2)', data.prestadorOpSimpNac === '2', String(data.prestadorOpSimpNac));
  check('valor do serviço vem da DPS', data.valorServico === 5, String(data.valorServico));
  check('valor líquido vem da NFS-e', data.valorLiquido === 5, String(data.valorLiquido));

  // A armadilha que quase carimbou "SEM VALIDADE JURÍDICA" em nota real:
  // `ambGer` é o ambiente GERADOR e vale 2 em TODA nota do sistema nacional.
  // O indicador de homologação é `tpAmb`, que aqui é 1 (produção).
  check(
    'ambiente vem de tpAmb (1=produção), NÃO de ambGer (que é 2 em toda nota nacional)',
    data.tpAmb === 1 && data.ambGer === '2',
    `tpAmb=${data.tpAmb} ambGer=${data.ambGer}`,
  );

  // Robustez: um XML sem `valores`, sem `toma` e sem `chNFSe` não pode derrubar
  // a geração — DANFSe que estoura é pior do que DANFSe com "-".
  const minimo = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe><nNFSe>9</nNFSe></infNFSe></NFSe>`;
  let minimoOk = true;
  let minimoData: ReturnType<typeof parseNfseXml> | null = null;
  try {
    minimoData = parseNfseXml(minimo);
  } catch {
    minimoOk = false;
  }
  check('XML mínimo não derruba o parser', minimoOk && minimoData?.numeroNfse === '9');
  check('campos ausentes viram null em vez de erro', minimoData?.tomador.documento === null);

  check('moeda formatada sem NBSP (que o pdfkit renderiza torto)', formatCurrency(1234.5) === 'R$ 1.234,50', formatCurrency(1234.5));
  check('moeda nula vira traço', formatCurrency(null) === '-');
  check('CNPJ formatado', formatCnpjCpf('13636938000144') === '13.636.938/0001-44', formatCnpjCpf('13636938000144'));
  check('chave agrupada de 4 em 4', formatAccessKey('12345678').startsWith('1234 5678'), formatAccessKey('12345678'));

  // A SEFIN NÃO altera a nota ao cancelar: cStat continua 107 e o cancelamento
  // vive num evento separado. Logo o XML sozinho nunca diz "cancelada", e a
  // marca d'água exigida pela NT 2.5.1 tem de vir do nosso próprio estado.
  check('XML autorizado não se declara cancelado (cStat 107)', data.cancelada === false);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ DANFSe — conformidade com a NT 008 (v1.02, 14/07/2026)');
{
  // A NT define FORMA, e forma quebra em silêncio: o PDF sai bonito e mesmo
  // assim fora da norma. Estas guardas travam os pontos que a NT fixa com
  // número ou texto literal.
  check('a norma é a versão vigente (1.02), não a 1.0', LAYOUT_NT_VERSION === '1.02');

  // NT 2.2.3 — espessuras e sombreamento.
  check('borda da página tem 1pt (NT 2.2.3)', PAGE_BORDER_WIDTH === 1);
  check('linhas divisórias têm 0,5pt (NT 2.2.3)', BLOCK_LINE_WIDTH === 0.5);

  // NT 2.4.1 a 2.4.4 — tamanhos MÍNIMOS de fonte são obrigatórios.
  check('título de bloco 7pt (NT 2.4.1)', FONT_SIZE.blockTitle === 7);
  check('rótulo de campo 6pt (NT 2.4.2)', FONT_SIZE.fieldLabel === 6);
  check('rótulo do bloco de identificação 7pt (NT 2.4.2)', FONT_SIZE.identLabel === 7);
  check('conteúdo 7pt (NT 2.4.4)', FONT_SIZE.content === 7);
  check('título do cabeçalho 9pt (NT 2.4.3)', FONT_SIZE.headerTitle === 9);
  check('marca d\'água mínimo 50pt (NT 2.5.1)', FONT_SIZE.watermark >= 50);

  // NT 2.4.3 — QR Code: posição e tamanho são fixados pela norma.
  check('QR Code em X 17,48cm (NT 2.4.3)', QR.x === 17.48);
  check('QR Code em Y 1,67cm (NT 2.4.3)', QR.y === 1.67);
  check('QR Code com no mínimo 1,52cm (NT 2.4.3)', QR.size >= 1.52);
  check(
    'URL do QR Code é a da consulta pública (NT 2.4.3)',
    QR.baseUrl === 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=',
    QR.baseUrl,
  );

  // NT 2.4.3 — títulos literais do cabeçalho.
  check('cabeçalho diz "DANFSe v2.0" (NT 2.4.3)', HEADER_TEXT.titulo === 'DANFSe v2.0');
  check(
    'expressão de homologação é a literal da NT',
    HEADER_TEXT.semValidade === 'NFS-e SEM VALIDADE JURÍDICA',
  );

  // NT 2.4.5, nota 12 — campo sem informação recebe traço, nunca zero nem vazio.
  check('campo ausente vira traço (nota 12)', EMPTY === '-');

  // NT 2.4.5, notas 2 a 4 — altura mínima do bloco colapsado.
  check('bloco colapsado tem 0,32cm (notas 2 a 4)', COLLAPSED_H === 0.32);

  // Grade da NT 2.4.5: 20,40cm úteis em 4 colunas de 5,09cm.
  check('largura útil é 20,40cm (NT 2.4.5)', WIDTH.full === 20.4);
  check('colunas em 0,30 / 5,41 / 10,51 / 15,62 (NT 2.4.5)',
    COL.c0 === 0.3 && COL.c1 === 5.41 && COL.c2 === 10.51 && COL.c3 === 15.62);
  check('conversão cm→pt correta', Math.abs(cm(1) - 28.3465) < 0.01, String(cm(1)));

  // cStat 107 é o status das notas de MEI — sem ele, a nota apareceria como
  // código cru no campo "Situação da NFS-e".
  check('cStat 107 é descrito como NFS-e MEI', DESCRICAO.cStat['107'] === 'NFS-e MEI');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ Descrição do serviço (xDescServ)');
{
  const base = 'Prestação de serviços de aerografia e pintura artística em veículos';

  // Formato espelhado das notas reais: as 42 do próprio aerografista citam
  // serviço + veículo + placa, e as da empresa pela Elotech usam
  // "Referente aos serviços executados no veículo ... de n série, placa, chassi".
  const completo = buildServiceDescription(base, {
    description: 'Dragão na lateral direita',
    task: {
      name: 'Carreta Confiança',
      serialNumber: '12345',
      customer: { fantasyName: 'Confiança Transportes', corporateName: null },
      truck: { plate: 'FIB9473', chassisNumber: '9BW123', category: 'TRUCK', implementType: 'DRY_CARGO' },
    },
  });

  check('começa pela natureza do serviço', completo.startsWith(base), completo.slice(0, 40));
  check('inclui o que foi feito', completo.includes('Dragão na lateral direita'), completo);
  check('inclui a placa', completo.includes('placa: FIB9473'), completo);
  check('inclui o nº de série da OS', completo.includes('n série: 12345'), completo);
  check('inclui o chassi', completo.includes('chassi: 9BW123'), completo);
  check('inclui o cliente', completo.includes('Cliente: Confiança Transportes'), completo);
  check('traduz o tipo do implemento', completo.includes('Carga Seca'), completo);
  // Frases coladas ficam ilegíveis num campo que a fiscalização lê.
  check('separa as frases com ponto', completo.includes('em veículos. Dragão'), completo);
  check('fecha a descrição do usuário com ponto', completo.includes('direita. Referente'), completo);

  const semVeiculo = buildServiceDescription(base, {
    description: null,
    task: { name: 'OS 999', serialNumber: '999', customer: null, truck: null },
  });
  check('sem veículo, cita a ordem de serviço', semVeiculo.includes('ordem de serviço 999'), semVeiculo);

  const semNada = buildServiceDescription(base, { description: null, task: null });
  check('sem dado nenhum, ainda descreve o serviço', semNada.trim().length > 0, semNada);

  // NT 2.4.5: xDescServ tem limite de 1300 caracteres.
  const gigante = buildServiceDescription(base, {
    description: 'x'.repeat(3000),
    task: { name: 'T', serialNumber: '1', customer: null, truck: null },
  });
  check('respeita o limite de 1300 caracteres', gigante.length <= 1300, String(gigante.length));
  check('trunca com reticências', gigante.endsWith('...'), gigante.slice(-10));
}

console.log(
  failures === 0
    ? '\n✅ Todas as verificações passaram.\n'
    : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
