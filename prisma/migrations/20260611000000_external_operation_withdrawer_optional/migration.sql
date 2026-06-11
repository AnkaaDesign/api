-- ExternalOperation: withdrawerName becomes optional (customer OR responsible name is
-- now the rule — customerId required for CHARGEABLE at create, enforced in the app layer).
ALTER TABLE "ExternalOperation" ALTER COLUMN "withdrawerName" DROP NOT NULL;

-- M1: rewrite stale favorite slugs left over from the retiradas-externas → operacoes-externas
-- rename (favorites store FAVORITE_PAGES enum VALUES, i.e. route paths).
-- Old variants that ever existed in FAVORITE_PAGES:
--   '/estoque/retiradas-externas'            (ESTOQUE_RETIRADAS_EXTERNAS_LISTAR)
--   '/estoque/retiradas-externas/cadastrar'  (ESTOQUE_RETIRADAS_EXTERNAS_CADASTRAR)
UPDATE "Preferences"
SET "favorites" = array_replace(
  array_replace(
    "favorites",
    '/estoque/retiradas-externas/cadastrar',
    '/estoque/operacoes-externas/cadastrar'
  ),
  '/estoque/retiradas-externas',
  '/estoque/operacoes-externas'
)
WHERE "favorites" && ARRAY['/estoque/retiradas-externas', '/estoque/retiradas-externas/cadastrar'];
