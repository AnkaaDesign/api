-- CNPJ/CPF do cliente passam a ser gravados SÓ COM DÍGITOS (02/10/2026).
--
-- A unicidade ("Customer_cnpj_key", "Customer_cpf_key") compara texto: um
-- cadastro com máscara ("12.345.678/0001-90") e outro só com dígitos eram,
-- para o banco, documentos diferentes — o faturamento criava o duplicado sem
-- 409. O código já grava dígitos (create, update, quickCreate); esta migration
-- traz o legado para a mesma forma.
--
-- ⛔ COLISÃO NÃO SE RESOLVE SOZINHA. Se a forma só-dígitos de um documento já
-- existe em OUTRO cadastro, os dois são o mesmo cliente e fundi-los é decisão
-- humana (tarefas, cobranças e notas apontam para cada um). Esses ficam como
-- estão e vão para a triagem (`_Mig0924_Triage`, kind
-- CUSTOMER_DOCUMENT_COLLISION, note = "<id> cnpj|cpf <valor>"); a busca do
-- código acha as duas formas (`documentLookupForms`), então o 409 continua
-- valendo para eles.
--
-- Medido no clone de 21/09 (ankaa_implemento): 0 CNPJ e 0 CPF com máscara.

INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
SELECT 'CUSTOMER_DOCUMENT_COLLISION', NULL, NULL, c.id || ' cnpj ' || c.cnpj
FROM "Customer" c
WHERE c.cnpj ~ '\D'
  AND EXISTS (
    SELECT 1 FROM "Customer" o
    WHERE o.id <> c.id
      AND regexp_replace(o.cnpj, '\D', '', 'g') = regexp_replace(c.cnpj, '\D', '', 'g')
  );

INSERT INTO "_Mig0924_Triage" (kind, "fileId", "taskId", note)
SELECT 'CUSTOMER_DOCUMENT_COLLISION', NULL, NULL, c.id || ' cpf ' || c.cpf
FROM "Customer" c
WHERE c.cpf ~ '\D'
  AND EXISTS (
    SELECT 1 FROM "Customer" o
    WHERE o.id <> c.id
      AND regexp_replace(o.cpf, '\D', '', 'g') = regexp_replace(c.cpf, '\D', '', 'g')
  );

UPDATE "Customer" c
SET cnpj = NULLIF(regexp_replace(c.cnpj, '\D', '', 'g'), '')
WHERE c.cnpj ~ '\D'
  AND NOT EXISTS (
    SELECT 1 FROM "Customer" o
    WHERE o.id <> c.id
      AND regexp_replace(o.cnpj, '\D', '', 'g') = regexp_replace(c.cnpj, '\D', '', 'g')
  );

UPDATE "Customer" c
SET cpf = NULLIF(regexp_replace(c.cpf, '\D', '', 'g'), '')
WHERE c.cpf ~ '\D'
  AND NOT EXISTS (
    SELECT 1 FROM "Customer" o
    WHERE o.id <> c.id
      AND regexp_replace(o.cpf, '\D', '', 'g') = regexp_replace(c.cpf, '\D', '', 'g')
  );
