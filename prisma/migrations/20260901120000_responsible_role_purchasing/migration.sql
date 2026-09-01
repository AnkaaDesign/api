-- Funcoes do contato: entra COMPRAS, sai PROPRIETARIO.
--
-- POR QUE PROPRIETARIO SAI
--   A funcao passou a decidir QUAL RECORTE do orcamento o contato recebe para
--   assinar (ver `signature/quote-sections.ts`). "Proprietario" nomeia uma
--   pessoa, nao uma area de interesse, e por isso nao responde a essa pergunta.
--   Quem a tinha recebe COMMERCIAL + MARKETING + FINANCIAL + FLEET_MANAGER: a
--   uniao dessas quatro devolve o documento inteiro, que e o que o proprietario
--   de fato precisa ver, e as etiquetas continuam dizendo algo verdadeiro sobre
--   as areas que ele acompanha.
--
-- POR QUE O TIPO E RECRIADO, E NAO SO ALTERADO
--   Postgres nao remove valor de enum. E a ORDEM DE DECLARACAO importa aqui:
--   `responsibleRolesSchema` ordena as funcoes por ela para manter estavel o
--   diff do changelog, e a ordem nova agrupa por fatia do documento (primeiro
--   as que recebem tudo, depois as que recebem recorte, por ultimo as que por
--   padrao nao assinam). Recriar e a unica forma de conseguir as duas coisas.

-- 1. Sai do enum para text[], onde da para reescrever os valores.
ALTER TABLE "Representative" ALTER COLUMN "roles" DROP DEFAULT;
ALTER TABLE "Representative" ALTER COLUMN "roles" TYPE text[] USING "roles"::text[];

-- 2. Reescreve OWNER. `array_remove` primeiro, senao o DISTINCT o traria de volta.
--    ORDER BY na subquery: o valor gravado ja sai na ordem canonica do enum novo,
--    para que o changelog nao registre uma alteracao onde nada mudou.
UPDATE "Representative"
   SET "roles" = ARRAY(
     -- Dedup na subquery e ordenacao fora dela: `SELECT DISTINCT ... ORDER BY
     -- <expressao>` e invalido no Postgres quando a expressao nao esta na lista
     -- de selecao, e escrever a expressao ali traria a coluna auxiliar para
     -- dentro do array.
     SELECT d.r
       FROM (
         SELECT DISTINCT unnest(
           array_remove("roles", 'OWNER')
           || ARRAY['COMMERCIAL', 'MARKETING', 'FINANCIAL', 'FLEET_MANAGER']
         ) AS r
       ) AS d
      ORDER BY array_position(
        ARRAY['COMMERCIAL','SELLER','REPRESENTATIVE','COORDINATOR','PURCHASING','MARKETING','FINANCIAL','FLEET_MANAGER','DRIVER'],
        d.r
      )
   )
 WHERE 'OWNER' = ANY("roles");

-- 3. Tipo novo, na ordem nova.
ALTER TYPE "RepresentativeRole" RENAME TO "RepresentativeRole_old";
CREATE TYPE "RepresentativeRole" AS ENUM (
  'COMMERCIAL',
  'SELLER',
  'REPRESENTATIVE',
  'COORDINATOR',
  'PURCHASING',
  'MARKETING',
  'FINANCIAL',
  'FLEET_MANAGER',
  'DRIVER'
);

-- 4. Volta para o enum. O indice GIN e reconstruido pelo proprio ALTER.
ALTER TABLE "Representative"
  ALTER COLUMN "roles" TYPE "RepresentativeRole"[] USING "roles"::"RepresentativeRole"[];
ALTER TABLE "Representative"
  ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"RepresentativeRole"[];

DROP TYPE "RepresentativeRole_old";
