-- A RECUSA DEIXOU DE MATAR A COLETA.
--
-- Com o envelope seguindo vivo depois de uma recusa, o operador pode pedir de
-- novo ao contato que recusou (`resendInvitation`), e esse gesto devolve a vez
-- dele. A trilha é append-only e é prova: registrar a reabertura como um evento
-- existente diria outra coisa sobre o que aconteceu.
--
-- Postgres exige cada valor novo de enum numa instrução própria, fora de
-- transação envolvente.
ALTER TYPE "SignatureEventType" ADD VALUE IF NOT EXISTS 'SIGNER_REOPENED';
