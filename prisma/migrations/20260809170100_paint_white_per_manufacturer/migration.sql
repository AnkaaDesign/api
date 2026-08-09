-- Um branco de fábrica para CADA montadora.
--
-- POR QUÊ. Duas coisas dependem de a montadora ter pelo menos uma tinta:
--
--   1. `colorsFor(id)` (web/.../catalog/colors.ts) devolve a paleta INTEIRA
--      quando o filtro não casa nada. Uma montadora sem tinta abre o passo
--      "Cor" com 519 cards.
--   2. `defaultColorFor(id)` devolve o PRIMEIRO item por `colorOrder` — e o
--      comentário daquele arquivo diz o que a primeira posição significa: "nos
--      catálogos escritos por gente a primeira é a mais vendida, e é um
--      branco/prata, que é exatamente o que se quer mostrar a quem ainda não
--      escolheu nada". Nenhuma das seis montadoras tinha um branco: a Scania
--      abria em `Cinza`, a DAF em `Iron Gray`, a Iveco em `Vermelho Ferrara`.
--
-- `colorOrder = 0` é abaixo de qualquer linha existente (o mínimo em uso era 1,
-- na Scania), então o branco fica em primeiro em todas as paletas sem reordenar
-- nada do que já estava lá.
--
-- A VOLVO NÃO GANHA LINHA NOVA: `Branco Volvo` (#efefef) já existia, sem
-- montadora, no catálogo geral. É a mesma tinta que este bloco criaria, com o
-- nome já dizendo de quem ela é — duplicá-la deixaria duas linhas idênticas
-- chamadas `Branco Volvo` no cadastro de tinta. Ela é AMARRADA, não copiada.
--
-- Tipo Poliuretano: é o esmalte de acabamento automotivo dos outros brancos de
-- cabine do cadastro (`Branco PU`). Sem marca de tinta (`paintBrandId` nulo) —
-- a fórmula é por marca e ninguém mediu estas ainda; `Paint.paintBrandId` é
-- anulável exatamente para esse caso.
INSERT INTO "Paint" (id, name, hex, finish, manufacturer, "paintTypeId", "colorOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  v.name,
  v.hex,
  'SOLID'::"PaintFinish",
  v.man::"TruckManufacturer",
  (SELECT id FROM "PaintType" WHERE name = 'Poliuretano'),
  0,
  NOW(),
  NOW()
FROM (VALUES
  ('Branco Scania',        '#f2f3f1', 'SCANIA'),
  ('Branco DAF',           '#f1f2f2', 'DAF'),
  ('Branco Iveco',         '#f0f1ef', 'IVECO'),
  ('Branco Mercedes-Benz', '#f1f1ee', 'MERCEDES_BENZ'),
  ('Branco Volkswagen',    '#f2f2f0', 'VOLKSWAGEN'),
  ('Branco MAN',           '#f3f3f1', 'MAN')
) AS v(name, hex, man)
-- Idempotente: reaplicar a migração num banco que já a recebeu não duplica.
WHERE NOT EXISTS (
  SELECT 1 FROM "Paint" p WHERE p.manufacturer = v.man::"TruckManufacturer" AND p.name = v.name
);

-- Volvo: amarra a tinta que já existia em vez de criar uma segunda igual.
UPDATE "Paint"
   SET manufacturer = 'VOLVO'::"TruckManufacturer",
       "colorOrder" = 0,
       "updatedAt"  = NOW()
 WHERE name = 'Branco Volvo'
   AND manufacturer IS NULL;
