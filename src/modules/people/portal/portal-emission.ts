// api/src/modules/people/portal/portal-emission.ts
//
// "PARA EMITIR FALTA…" — o portão de emissão do P14 (`emissionOf`) dito ao CLIENTE.
//
// O portão interno fala a língua da Ankaa ("E3: coleta viva", "dois pagadores",
// "responsáveis na tarefa"). O cliente precisa de outra pergunta respondida:
// "o que falta para eu receber o documento para assinar — e é comigo ou com a
// Ankaa?". Por isso a tradução é por CÓDIGO, nunca pela frase interna: a frase
// interna cita coisas que o cliente não vê nem resolve (cadastro de pagador,
// validade a estender), e reproduzi-la no portal seria vazar o checklist do
// comercial.
//
// PURO (sem Prisma, sem Nest): a integração do par [P14 ∥ P13b] liga isto em
// `PortalReadService.getBudget`, e `tests/portal-emissao.test.ts` percorre a
// tabela sem banco.
import type { Emission, EmissionGateCode } from '../../../utils/emission-gate';

export interface PortalEmission {
  /** Valor e arte aprovados e nada mais falta do lado da Ankaa. */
  ready: boolean;
  /** O que falta, em frases de cliente, na ordem do portão. */
  missing: string[];
  /** A faixa pronta: "Para emitir falta: …" — `null` quando nada falta. */
  label: string | null;
}

/** Os estados do eixo em que já EXISTE documento (emitido ou assinado): não há faixa. */
const ALREADY_ISSUED = new Set([
  'AWAITING_CUSTOMER',
  'AWAITING_ANKAA',
  'SIGNED',
  'SIGNED_OFFLINE',
]);

const CLIENT_PHRASE: Record<EmissionGateCode, string | null> = {
  VALUE_NOT_APPROVED: 'a aprovação do valor',
  ARTWORK_PENDING: 'a arte aprovada de cada veículo',
  // Já existe uma coleta: o documento está (ou esteve) com o cliente — não é
  // "falta", e a tela de Assinaturas é quem fala dele.
  ENVELOPE_LIVE: null,
  // Os três abaixo são da Ankaa e têm a mesma resposta para o cliente.
  TWO_PAYERS: 'a Ankaa concluir a preparação do documento',
  VALIDITY_EXPIRED: 'a Ankaa concluir a preparação do documento',
  RESPONSIBLES: 'a Ankaa concluir a preparação do documento',
};

/**
 * `null` quando o orçamento já tem documento emitido ou assinado, ou ainda não
 * tem valor para o cliente ver (`REQUESTED`, `PENDING`, `CANCELLED`: a bola é
 * da Ankaa e o portal já diz isso pelo estado).
 */
export function portalEmissionOf(
  emission: Emission,
  budget: { status?: string | null; signatureStatus?: string | null },
): PortalEmission | null {
  if (ALREADY_ISSUED.has(budget.signatureStatus ?? '')) return null;
  if (budget.status !== 'IN_NEGOTIATION' && budget.status !== 'APPROVED') return null;
  const missing: string[] = [];
  for (const b of emission.blockers) {
    const phrase = CLIENT_PHRASE[b.code];
    if (phrase && !missing.includes(phrase)) missing.push(phrase);
  }
  return {
    ready: emission.ready,
    missing,
    label: missing.length ? `Para emitir falta: ${missing.join('; ')}.` : null,
  };
}
