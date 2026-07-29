-- Torna o e-mail o canal padrão da assinatura eletrônica.
--
-- Roda numa transação separada da que criou 'EMAIL_OTP' (ver 20260729140000),
-- que é o que permite referenciar o valor aqui.

-- 1. Um signatário pode não ter telefone. O telefone continua sendo a
--    identidade do contato no cadastro, mas deixou de ser condição para
--    assinar: quem recebe o código agora é o e-mail.
ALTER TABLE "EnvelopeSigner" ALTER COLUMN "declaredPhone" DROP NOT NULL;

-- 2. phoneSource -> contactSource. A coluna nunca guardou um telefone, só a
--    procedência do contato ('customer_registry'). Com o canal em e-mail o
--    nome antigo passou a mentir. Renomear é barato agora (8 linhas).
ALTER TABLE "EnvelopeSigner" RENAME COLUMN "phoneSource" TO "contactSource";

-- 3. Novos signatários nascem EMAIL_OTP. As linhas existentes NÃO são tocadas:
--    o WHATSAPP_OTP delas é um fato histórico sobre como aquela pessoa se
--    autenticou, não uma configuração a ser atualizada.
ALTER TABLE "EnvelopeSigner" ALTER COLUMN "authMethod" SET DEFAULT 'EMAIL_OTP';

-- 4. O signatário precisa ser alcançável pelo canal que o authMethod declara.
--    NOT VALID de propósito: vale para todo INSERT/UPDATE futuro, mas não
--    revalida as linhas antigas -- entre elas as já SIGNED, que não podem ser
--    reescritas nem para satisfazer uma constraint.
ALTER TABLE "EnvelopeSigner"
  ADD CONSTRAINT "EnvelopeSigner_contact_matches_auth_method"
  CHECK (
    CASE "authMethod"
      WHEN 'EMAIL_OTP'    THEN "declaredEmail" IS NOT NULL AND btrim("declaredEmail") <> ''
      WHEN 'WHATSAPP_OTP' THEN "declaredPhone" IS NOT NULL AND btrim("declaredPhone") <> ''
      WHEN 'SMS_OTP'      THEN "declaredPhone" IS NOT NULL AND btrim("declaredPhone") <> ''
      ELSE TRUE
    END
  ) NOT VALID;
