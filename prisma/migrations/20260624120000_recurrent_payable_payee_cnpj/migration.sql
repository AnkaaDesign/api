-- Optional CNPJ of the payee on a recurrent payable. Enables NF auto-linking by
-- emitter CNPJ + competence without coupling to the inventory Supplier model.
ALTER TABLE "RecurrentPayable" ADD COLUMN "payeeCnpj" TEXT;
