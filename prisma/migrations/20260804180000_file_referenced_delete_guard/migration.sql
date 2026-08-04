-- Um arquivo em uso nao pode ser excluido -- garantido pelo banco, nao pelo app.
--
-- Em 2026-06-07 uma limpeza de "orfaos" removeu 146 linhas de "File" apontando para
-- /srv/files/Fotos/. 32 delas eram o layout aprovado de orcamentos vivos (entre eles o
-- #415, tarefa 38407, ja BUDGET_APPROVED). Nenhuma trava disparou, nenhum ChangeLog foi
-- escrito, e os bytes sumiram do disco e dos dois espelhos de backup.
--
-- Duas falhas independentes tiveram que coincidir:
--
--   1. Os arquivos estavam numa pasta generica. O upload mandou o contexto "quote-layout"
--      (a chave do mapa e "quote-layouts"), getFolderPath caiu no roteamento por MIME e
--      largou tudo na raiz do storage. Isso decidiu QUAIS arquivos foram olhados.
--   2. A verificacao de referencia nao conseguia VER a referencia. "O que aponta para
--      este arquivo?" era respondido enumerando FKs que referenciam File.id. O vinculo do
--      layout de orcamento nao e uma delas: e File."quoteLayoutId", uma coluna NO File
--      apontando PARA FORA, para TaskQuote. Qualquer checagem so-de-entrada responde
--      "sem referencias" para TODO layout de orcamento do banco, em qualquer pasta.
--
-- A falha 2 e a que generaliza, e a que o app sozinho nao resolve: a exclusao de junho
-- foi SQL ad-hoc, um caminho onde nenhuma validacao TypeScript existe. Por isso a regra
-- mora aqui. FileReferenceService (src/modules/common/file/services/file-reference.service.ts)
-- e o espelho desta funcao no app, para dar erro amigavel antes de chegar no banco -- mas
-- e este gatilho que vale para psql, script de manutencao e migracao.
--
-- Nao substitui backup: impede a exclusao errada, nao restaura a que ja aconteceu.

-- Toda referencia viva a um arquivo, lida do catalogo VIVO de FKs.
-- Derivada, nao declarada: uma relacao criada por uma migracao futura passa a ser coberta
-- no dia em que ela sobe, sem ninguem lembrar de atualizar lista nenhuma. Foi exatamente
-- uma lista escrita a mao (13 das ~50 relacoes) que deixou passar quoteLayoutId no app.
CREATE OR REPLACE FUNCTION file_blocking_references(p_file_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r     record;
  hit   boolean;
  refs  text[] := ARRAY[]::text[];
BEGIN
  -- Saida: coluna no proprio File. Invisivel para o catalogo de entrada -- o ponto cego
  -- que fez 32 layouts aprovados vivos parecerem orfaos.
  IF EXISTS (
    SELECT 1 FROM "File" WHERE "id" = p_file_id AND "quoteLayoutId" IS NOT NULL
  ) THEN
    -- Cast explicito: com um literal cru o parser resolve `anyarray || anyarray`
    -- e tenta ler a string como literal de array.
    refs := refs || 'File.quoteLayoutId (layout aprovado de orcamento)'::text;
  END IF;

  -- Entrada: todas as FKs que apontam para File.id.
  FOR r IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema    = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND ccu.table_name     = 'File'
      AND ccu.column_name    = 'id'
      -- thumbnail_jobs e dado DERIVADO do arquivo, nao um uso dele: apagar o arquivo e
      -- justamente o que deve limpar essas linhas (onDelete: Cascade).
      AND tc.table_name <> 'thumbnail_jobs'
    ORDER BY tc.table_name, kcu.column_name
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', r.tbl, r.col)
      INTO hit USING p_file_id;
    IF hit THEN
      refs := refs || (r.tbl || '.' || r.col)::text;
    END IF;
  END LOOP;

  RETURN refs;
END;
$$;

COMMENT ON FUNCTION file_blocking_references(text) IS
  'Toda referencia viva a um File: FKs de entrada (catalogo) + colunas de saida do File. '
  'Vazio = seguro para excluir. Usada pelo gatilho file_no_delete_when_referenced.';

CREATE OR REPLACE FUNCTION file_block_referenced_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  refs text[];
BEGIN
  -- Valvula, mesmo padrao de ankaa.allow_signature_audit_delete: SET LOCAL, portanto vale
  -- so ate o fim da transacao e nao ha como esquece-la aberta. Existe para desmontagens
  -- deliberadas que apagam o dono ANTES do arquivo -- e para que uma limpeza consciente
  -- seja um ato explicito, nao um DELETE distraido.
  IF COALESCE(current_setting('ankaa.allow_referenced_file_delete', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;

  refs := file_blocking_references(OLD."id");

  IF COALESCE(array_length(refs, 1), 0) > 0 THEN
    RAISE EXCEPTION
      'File % ("%") esta em uso e nao pode ser excluido. Em uso por: %',
      OLD."id", OLD."filename", array_to_string(refs, ', ')
      USING
        ERRCODE = 'restrict_violation',
        HINT    = 'Desvincule o arquivo da entidade dona antes de exclui-lo. '
                  'Numa desmontagem deliberada, apague o dono primeiro ou abra a valvula '
                  'na transacao: SET LOCAL ankaa.allow_referenced_file_delete = ''on''.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "file_no_delete_when_referenced" ON "File";
CREATE TRIGGER "file_no_delete_when_referenced"
  BEFORE DELETE ON "File"
  FOR EACH ROW EXECUTE FUNCTION file_block_referenced_delete();
