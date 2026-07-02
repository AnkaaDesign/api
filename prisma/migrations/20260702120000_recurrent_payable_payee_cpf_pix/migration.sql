-- Tomador may now be an individual (CPF) as well as a company (CNPJ). NF
-- auto-linking still keys off payeeCnpj; payeeCpf is informational.
ALTER TABLE "RecurrentPayable" ADD COLUMN "payeeCpf" TEXT;

-- PIX key to pay this bill (only set when paymentMethod = PIX). Stored as
-- entered (CPF/CNPJ/email/phone/random) and surfaced in Contas a Pagar.
ALTER TABLE "RecurrentPayable" ADD COLUMN "pixKey" TEXT;
