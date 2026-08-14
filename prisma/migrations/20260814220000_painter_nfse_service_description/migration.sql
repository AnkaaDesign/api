-- Descrição padrão do serviço, mais próxima do que as notas reais deste negócio
-- já usam.
--
-- As 42 NFS-e que o aerografista emitiu pelo portal descrevem o serviço E o
-- veículo ("PRESTAÇÃO DE SERVIÇOS EM REFORMA E PINTURA DE CAMINHÃO BETONEIRA",
-- "Caminhão Confiança (Morango Lado Esquerdo) Placa: FIB-9473"). O texto antigo
-- era genérico demais para cumprir esse papel.
--
-- O detalhamento por nota (veículo, placa, chassi, nº de série, cliente) é
-- montado em tempo de emissão por `buildServiceDescription`; este campo é só a
-- primeira linha, que descreve a natureza do serviço.

ALTER TABLE "FiscalEmitterProfile"
  ALTER COLUMN "serviceDescription"
  SET DEFAULT 'Prestação de serviços de aerografia e pintura artística em veículos';

UPDATE "FiscalEmitterProfile"
  SET "serviceDescription" = 'Prestação de serviços de aerografia e pintura artística em veículos'
  WHERE "serviceDescription" = 'Serviço de aerografia e pintura artística';
