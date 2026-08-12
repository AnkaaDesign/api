-- Tipos de entidade de ChangeLog para o lado de contas a pagar.
--
-- Até aqui NÃO existia membro algum para `RecurrentPayable` nem para
-- `RecurrentPayableOccurrence`. A edição de uma conta recorrente APAGA e
-- REESCREVE ocorrências já materializadas (o ramo de mudança de cadência faz
-- `deleteMany`, o de valor faz `updateMany`), e nada disso deixava rastro: a
-- única forma de responder "o que mudou na Diária de Limpeza e quando" era
-- diferenciar os dumps noturnos do banco. Mesmo problema — e mesma correção —
-- de INSTALLMENT/INVOICE/BANK_SLIP em 2026-08-09.
--
-- ADITIVA E SEGURA PARA APLICAR ANTES DO CÓDIGO: acrescentar valores a um enum
-- não altera nenhuma linha existente e nenhum caminho de leitura passa a
-- enxergar algo diferente. O código novo é que começa a gravar com eles.

ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'RECURRENT_PAYABLE';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'RECURRENT_PAYABLE_OCCURRENCE';
