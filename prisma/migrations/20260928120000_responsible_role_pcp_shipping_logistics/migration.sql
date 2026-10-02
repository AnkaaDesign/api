-- Funcoes do contato: entram PCP, EXPEDICAO e LOGISTICA, e o enum inteiro passa
-- para a ordem de exibicao definida pela empresa:
--   PCP, Compras, Coordenador, Representante, Vendedor, Financeiro, Marketing,
--   Expedicao, Logistica, Gestor de Frota, Motorista, Comercial.
--
-- POR QUE O TIPO E RECRIADO, E NAO SO `ADD VALUE`
--   `ADD VALUE ... BEFORE` insere, mas nao reordena os valores que ja existem, e
--   COMMERCIAL sai do primeiro para o ultimo lugar. A ordem de declaracao e a
--   ordem que `responsibleRolesSchema` usa para ordenar o que grava; se o tipo
--   ficasse numa ordem e o codigo em outra, nada quebraria hoje, mas os dois
--   deixariam de concordar sobre o que e "canonico".
--
-- POR QUE OS ARRAYS SAO REGRAVADOS
--   A api ordena `roles` a cada escrita e o changelog compara valores
--   serializados. Um contato gravado como {COMMERCIAL,FINANCIAL} seria regravado
--   como {FINANCIAL,COMMERCIAL} na proxima edicao de qualquer outro campo, e o
--   historico mostraria "funcoes alteradas" sem ninguem ter mexido nelas.
--   Regravar aqui, fora do changelog, deixa todo mundo ja na ordem nova.

-- 1. Sai do enum para text[].
ALTER TABLE "Representative" ALTER COLUMN "roles" DROP DEFAULT;
ALTER TABLE "Representative" ALTER COLUMN "roles" TYPE text[] USING "roles"::text[];

-- 2. Reordena. Dedup na subquery e ordenacao fora dela (`SELECT DISTINCT ...
--    ORDER BY <expressao>` e invalido quando a expressao nao esta na selecao).
UPDATE "Representative"
   SET "roles" = ARRAY(
     SELECT d.r
       FROM (SELECT DISTINCT unnest("roles") AS r) AS d
      ORDER BY array_position(
        ARRAY['PRODUCTION_PLANNING','PURCHASING','COORDINATOR','REPRESENTATIVE','SELLER','FINANCIAL','MARKETING','SHIPPING','LOGISTICS','FLEET_MANAGER','DRIVER','COMMERCIAL'],
        d.r
      )
   )
 WHERE cardinality("roles") > 1;

-- 3. Tipo novo, na ordem nova.
ALTER TYPE "RepresentativeRole" RENAME TO "RepresentativeRole_old";
CREATE TYPE "RepresentativeRole" AS ENUM (
  'PRODUCTION_PLANNING',
  'PURCHASING',
  'COORDINATOR',
  'REPRESENTATIVE',
  'SELLER',
  'FINANCIAL',
  'MARKETING',
  'SHIPPING',
  'LOGISTICS',
  'FLEET_MANAGER',
  'DRIVER',
  'COMMERCIAL'
);

-- 4. Volta para o enum. O indice GIN e reconstruido pelo proprio ALTER.
ALTER TABLE "Representative"
  ALTER COLUMN "roles" TYPE "RepresentativeRole"[] USING "roles"::"RepresentativeRole"[];
ALTER TABLE "Representative"
  ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"RepresentativeRole"[];

DROP TYPE "RepresentativeRole_old";
