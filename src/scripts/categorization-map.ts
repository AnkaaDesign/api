/**
 * Categorization mapping for the 174 uncategorized items detected in the
 * production backup of 2026-05-19.
 *
 * Mapping rationale:
 *   - PPE category (Epi)        — body protection (mask, glove, boot, coverall)
 *   - TOOL category (Ferramenta) — durable tools that don't deplete
 *                                  (sockets, pistols, ladders, lamps, supports)
 *   - REGULAR everything else mapped to the closest existing category:
 *       Tinta       — primer / paste / paint additive
 *       Abrasivos   — sanding/grinding/scotch
 *       Material    — general consumables, paint accessories, tapes, hoses
 *       Peça        — vehicle parts, fittings, fasteners, fittings
 *       Elétrico    — electrical accessories
 *       Escritório  — office supplies
 *       Consumível  — soft consumables that don't fit Material (refills)
 *
 * Borderline calls:
 *   - Pincel / Estilete / Espatula / Rolo Anti Respingo: have high consumption
 *     history → Material (REGULAR) so mc tracking still works. Marking these
 *     TOOL would zero their mc/rp/max.
 *   - Soquete Sextavado et al: 1-2 activities each → TOOL (no consumption).
 *   - Líq. de Mascaramento: paint masking liquid (NOT a mask) → Tinta.
 *   - Refil de Maçarico / Refil de Gás: consumables → Material.
 */

export interface CategoryAssignment {
  itemId: string;
  itemName: string;
  categoryName:
    | 'Epi'
    | 'Ferramenta'
    | 'Tinta'
    | 'Abrasivos'
    | 'Material'
    | 'Peça'
    | 'Elétrico'
    | 'Escritório'
    | 'Consumível';
}

export const CATEGORY_ASSIGNMENTS: CategoryAssignment[] = [
  // ===== Epi (PPE) =====
  // NOTE: "Máscara 321" and "Máscara 328" are PAINT-MASKING PRODUCTS (used to
  // cover/mask vehicle parts during painting), NOT face masks. They live in
  // Material below. Only true face/respirator masks belong in Epi.
  { itemId: '61fb86ca-bb7f-4477-8be7-4ee6bcc84683', itemName: 'Máscara Semi Facial Pequena 7501', categoryName: 'Epi' },
  { itemId: '834fef2b-62fd-40e8-a582-63f052bd1460', itemName: 'Luva Neoprene - G', categoryName: 'Epi' },
  { itemId: '6aeca123-7f38-4160-b08b-d9707a6175da', itemName: 'Luva Neoprene - M', categoryName: 'Epi' },
  { itemId: 'ca1a74c9-e52d-4da5-aff6-b49853964aa6', itemName: 'Bota Pvc - 42', categoryName: 'Epi' },
  { itemId: '60ce70f9-b607-47be-850e-d40673295a3b', itemName: 'Macacão de Segurança', categoryName: 'Epi' },
  { itemId: 'df49c809-42bb-4677-b74d-0fcbeeafd099', itemName: 'Macacão de Segurança XXG', categoryName: 'Epi' },

  // ===== Ferramenta (TOOL) — durable, no consumption =====
  { itemId: '0b0a4b73-e770-42fe-994a-d9b2a9816ba6', itemName: 'Trena 5m', categoryName: 'Ferramenta' },
  { itemId: '15279e89-9c11-4866-bdcd-97090fefde29', itemName: 'Trena 8m', categoryName: 'Ferramenta' },
  { itemId: 'e12b83e0-ef50-46ac-be20-d272f9f42dcd', itemName: 'Maçarico', categoryName: 'Ferramenta' },
  { itemId: 'a04a552e-490b-47c3-9548-a6f1fb595b03', itemName: 'Pistola Pintura', categoryName: 'Ferramenta' },
  { itemId: '2eb51ba2-3ce1-40fc-a37f-f4848a711a0a', itemName: 'Pistola Pintura K3 PR503', categoryName: 'Ferramenta' },
  { itemId: '44a3eba4-6494-4881-8cd7-3391392baef3', itemName: 'Pistola Pintura K3', categoryName: 'Ferramenta' },
  { itemId: '882caa20-9b48-42c7-8b61-5baafb1e910e', itemName: 'Pistola de Pintura PRO-534', categoryName: 'Ferramenta' },
  { itemId: '19107c18-b1bf-4216-9cc3-fd5b402fea83', itemName: 'Pistola de Pintura PR .7m', categoryName: 'Ferramenta' },
  { itemId: 'e3d28e09-3dc0-4466-b9f1-25f362fee604', itemName: 'Martelete Pneumatico PRO-300', categoryName: 'Ferramenta' },
  { itemId: 'deddcd9c-e6fc-4618-8db1-ea58f5b2976a', itemName: 'Soprador Térmico STV200', categoryName: 'Ferramenta' },
  { itemId: '3218b7cb-5850-4f71-9f37-1082def56334', itemName: 'Soprador Térmico Bateria', categoryName: 'Ferramenta' },
  { itemId: '31e40ae3-13ed-4150-acc8-627b2d1bc319', itemName: 'Seladora Plastico 081', categoryName: 'Ferramenta' },
  { itemId: '5ac3642e-7329-4f01-88ed-54b6c5fc4c92', itemName: 'Seladora Poliuretano D854.11', categoryName: 'Ferramenta' },
  { itemId: '935d1c15-75fd-4e0b-b2ea-8d535cec99df', itemName: 'Escada de Aluminio 16/degraus', categoryName: 'Ferramenta' },
  { itemId: '1f24e751-c062-480a-98ab-193a03e09fbc', itemName: 'Escova Aço Motoesmeril', categoryName: 'Ferramenta' },
  { itemId: '5ab0c45b-985b-4301-a6d4-7b966b699a88', itemName: 'Escova de Aço Latonado 1777-4', categoryName: 'Ferramenta' },
  { itemId: '0e99f89a-a393-463c-98c0-62a8372386e9', itemName: 'Soquete Sextavado 6', categoryName: 'Ferramenta' },
  { itemId: 'abe0b962-7406-4fc9-b479-a05d01a377a4', itemName: 'Soquete Sextavado 7', categoryName: 'Ferramenta' },
  { itemId: '5243fdbd-dd63-42f5-bc05-e4d6db7fb4a7', itemName: 'Soquete Sextavado 8', categoryName: 'Ferramenta' },
  { itemId: '1aade28d-597b-4838-9848-fa1fc58bb018', itemName: 'Soquete Sextavado 8 Longo', categoryName: 'Ferramenta' },
  { itemId: 'b3b82c54-deb0-4f71-895d-6bea5fe1cbb6', itemName: 'Soquete Sextavado 9', categoryName: 'Ferramenta' },
  { itemId: '605ace13-3ddb-4f88-adbd-8d7d79f22211', itemName: 'Soquete Sextavado 9 Longo', categoryName: 'Ferramenta' },
  { itemId: 'a16d3923-e9ad-4c58-b309-60bfeede93c2', itemName: 'Soquete Sextavado 11 Longo', categoryName: 'Ferramenta' },
  { itemId: 'd48d9198-278d-4c96-8c9c-c98bee6ee127', itemName: 'Soquete Sextavado 12 Longo', categoryName: 'Ferramenta' },
  { itemId: '5476597d-ba03-4cee-bcec-3bd41fd6ad88', itemName: 'Soquete Sextavado 13 Longo', categoryName: 'Ferramenta' },
  { itemId: '892a6feb-ee5e-4f8c-a856-9a4395f19fc5', itemName: 'Soquete Sextavado 14 Longo', categoryName: 'Ferramenta' },
  { itemId: '47caefcc-ce42-4e1b-9d04-324e5de46fa2', itemName: 'Soquete Sextavado 15 Longo', categoryName: 'Ferramenta' },
  { itemId: '51f92dfd-9876-4e55-af42-99639c724ce3', itemName: 'Soquete Sextavado 16 Longo', categoryName: 'Ferramenta' },
  { itemId: 'bc7ce755-ab8f-4eb3-97da-dbd3195b4522', itemName: 'Soquete Sextavado 18', categoryName: 'Ferramenta' },
  { itemId: 'b22c7be9-878d-4ffa-9de5-3e26403346ee', itemName: 'Soquete Torx T-40 Longo', categoryName: 'Ferramenta' },
  { itemId: '2cff2782-590a-40b9-a317-3b98d4ee3a9c', itemName: 'Kit Soquete Adaptador Macho', categoryName: 'Ferramenta' },
  { itemId: 'e4419c6d-2b3a-4689-ba65-c0d50e7a5a3a', itemName: 'Bico de Ar dg-10', categoryName: 'Ferramenta' },
  { itemId: '3dcbcebe-19ed-4b77-b619-753a1e151600', itemName: 'Suporte Reforçado', categoryName: 'Ferramenta' },
  { itemId: 'f7200639-3f95-4e2d-bf49-3cdb80f037fe', itemName: 'Suporte de Mangueira', categoryName: 'Ferramenta' },
  { itemId: '1fefca59-3bf6-4b50-b68d-58fd82b105b6', itemName: 'Refletor Led 50w-6500k 399021376', categoryName: 'Ferramenta' },
  { itemId: 'd78586f7-7c94-40ef-a5ff-5b6f0c8eb004', itemName: 'Lampada Led', categoryName: 'Ferramenta' },
  { itemId: '1a4d16e0-b350-4e26-bfb0-1e033749e7aa', itemName: 'Lanterna Led', categoryName: 'Ferramenta' },
  { itemId: '1f44b50c-5241-40d7-878f-1020b308e404', itemName: 'Lanterna Led Âmbar V POS/RETRO', categoryName: 'Ferramenta' },
  { itemId: 'ab763024-0bbb-4f2c-9263-354bd7401a0d', itemName: 'Lanterna Side Marker Led Âmbar', categoryName: 'Ferramenta' },
  { itemId: 'cda57e50-7f11-43b8-b32d-9c0530bf20b5', itemName: 'Fita Led', categoryName: 'Ferramenta' },
  { itemId: 'e8addc9d-cdd5-4b32-9b5d-d68c5db479f0', itemName: 'Banqueta Dobravel P/', categoryName: 'Ferramenta' },
  { itemId: '530480ce-7274-487f-971f-6806497e7616', itemName: 'Cavalete Para Pintura', categoryName: 'Ferramenta' },
  { itemId: 'cb0c60bc-9a2c-4dd7-88f2-7cc3dc0321ee', itemName: 'Vassoura de Palha', categoryName: 'Ferramenta' },
  { itemId: '04c48d67-33fe-4b9f-ba91-68d9612f3793', itemName: 'Pá de Lixo Inox', categoryName: 'Ferramenta' },
  { itemId: '986ca970-aff9-43eb-9ab3-5297afa9dc58', itemName: 'Bandeija P/pintura', categoryName: 'Ferramenta' },
  { itemId: '59471e86-275a-4c90-9d5a-9aef39ef2c15', itemName: 'Funil Reto', categoryName: 'Ferramenta' },
  { itemId: '7728e01d-ae1f-4943-9ce7-0da90fad7820', itemName: 'Balde P/ Pçs de Varão', categoryName: 'Ferramenta' },
  { itemId: '2d2ee2f9-5938-4e94-843d-03bea673f343', itemName: 'Balde Plástico', categoryName: 'Ferramenta' },
  { itemId: '7c6e90f0-2bf1-46c3-bfc9-64336b5e979c', itemName: 'Peneira', categoryName: 'Ferramenta' },

  // ===== Tinta (REGULAR) — primer / paste / paint additive =====
  { itemId: '317c256f-66ab-4310-840f-3396d68b61fb', itemName: 'Wash Primer 045', categoryName: 'Tinta' },
  { itemId: '96e2f769-5f4a-479e-8eb7-278be2d15e23', itemName: 'Wash Primer 517.600', categoryName: 'Tinta' },
  { itemId: '30fca55f-1e74-43eb-92ef-35131d5fe6ce', itemName: 'Primer 8200', categoryName: 'Tinta' },
  { itemId: '02e72ff8-8ef6-4517-85ed-3b143e100b30', itemName: 'Primer Multfill', categoryName: 'Tinta' },
  { itemId: 'eec23bf8-b58c-4db2-b67e-64cd9542b2bb', itemName: 'Primer Pu 3000', categoryName: 'Tinta' },
  { itemId: '316032a0-be1c-4136-a04e-51bed02d0b7e', itemName: 'Primer Pu Cinza 513.030', categoryName: 'Tinta' },
  { itemId: '8fb75c5d-6e81-4f69-95da-10c40db8ffe1', itemName: 'Primer Pu Fast Dry 513.540', categoryName: 'Tinta' },
  { itemId: '88b35b96-be03-44a4-ac7a-e640f499375e', itemName: 'Primer Spectra 2k P30 Cinza', categoryName: 'Tinta' },
  { itemId: '18afd277-69ce-45ad-9dfd-67c264ce8d85', itemName: 'Primer Spectra 2k P30 Branco', categoryName: 'Tinta' },
  { itemId: '2c270906-90d0-4c4e-b895-09d6837645a0', itemName: 'Pu Branco LP550', categoryName: 'Tinta' },
  { itemId: '40da39d5-9f29-4b54-9de2-a09d43370700', itemName: 'Pu Preto Intenso LP513', categoryName: 'Tinta' },
  { itemId: 'bbce68d4-903c-40ff-afdb-235db58ba5c8', itemName: 'Aditivo Anticratera 08780', categoryName: 'Tinta' },
  { itemId: '89e41187-fdcc-40bc-931d-86952b454aa8', itemName: 'Flexibilizante 509.080', categoryName: 'Tinta' },
  { itemId: '927b673d-32ac-4cd6-bfbd-759211f3b649', itemName: 'Flexibilizante 3402.04', categoryName: 'Tinta' },
  { itemId: '6f7c967a-852a-4e18-aa0e-72c20ac9d0c7', itemName: 'Massa Plastica', categoryName: 'Tinta' },
  { itemId: 'b20e5a2f-4983-4bd8-97b5-f8c98c146964', itemName: 'Massa Poliester', categoryName: 'Tinta' },
  { itemId: '1c455177-8ca2-4de7-850a-1440dd3f4180', itemName: 'Massa Poliester 508.200', categoryName: 'Tinta' },
  { itemId: '14dcc46a-fc06-4b68-a86c-2f79806149fc', itemName: 'Massa Poliester Fibras 508.800', categoryName: 'Tinta' },
  { itemId: '7f6f3c51-c00b-43a3-8865-e0e3e7b141ac', itemName: 'Líq. de Mascaramento 506.000', categoryName: 'Tinta' },

  // ===== Abrasivos =====
  { itemId: '8d73219c-df67-47d7-8e5f-6f2b38e258f8', itemName: 'Palha de Aço', categoryName: 'Abrasivos' },
  { itemId: 'b1255e2e-fd8a-4762-bfd5-35390e90973b', itemName: 'Scotch Brite AMF', categoryName: 'Abrasivos' },
  { itemId: 'c70edb6b-57ff-46bb-b4d2-c2a872b0b07f', itemName: 'Disco de Interface', categoryName: 'Abrasivos' },
  { itemId: 'e304243a-1fcb-4388-b498-6716bb4a6f57', itemName: 'Disco Flap Vila GR x', categoryName: 'Abrasivos' },
  { itemId: 'de951104-cd26-446b-99f9-f7dcf9b0d2c7', itemName: 'Disco Desbaste', categoryName: 'Abrasivos' },
  { itemId: 'f032acf7-abf6-4573-a25b-24e195abf195', itemName: 'Disco de Corte 4.1/', categoryName: 'Abrasivos' },
  { itemId: '63a068bb-b4a1-4587-92f2-a5074fe851dd', itemName: 'Hookit PRO-406', categoryName: 'Abrasivos' },
  { itemId: 'a155dd9e-71b2-4068-8751-679d37788d3e', itemName: 'Lamina Norma', categoryName: 'Abrasivos' },
  { itemId: '9f5cf77a-9348-45c2-9870-8ce2fd80d87f', itemName: 'Lamina Plotter', categoryName: 'Abrasivos' },

  // ===== Material (REGULAR) — consumables, accessories =====
  // Paint-masking products — used to cover/mask parts during paint application.
  { itemId: '33ed541a-343c-4232-bf6d-921dfdf198a6', itemName: 'Máscara 321 (paint-masking)', categoryName: 'Material' },
  { itemId: '5334cf95-0e83-404e-a8c0-cd84c888b6c7', itemName: 'Máscara 328 (paint-masking)', categoryName: 'Material' },
  { itemId: 'b4d313c5-6bc7-455a-9582-a824bce79aec', itemName: 'Pincel', categoryName: 'Material' },
  { itemId: '92639b81-9587-47e0-9cd4-81a44a677f05', itemName: 'Pincel Médio 302', categoryName: 'Material' },
  { itemId: 'eb42810b-1eae-463b-b0f4-c55f49faa08e', itemName: 'Estilete Snap Off', categoryName: 'Material' },
  { itemId: 'b4823d6c-77df-4e38-af5b-4319c4c13ea3', itemName: 'Espatula Celuloide', categoryName: 'Material' },
  { itemId: 'fac8ecb6-d78f-40cb-b1ea-20830c71e004', itemName: 'Espatula Feltro', categoryName: 'Material' },
  { itemId: '27278f33-b534-4e4a-8450-71a300787ab0', itemName: 'Espatula Inox/12cm Cab Pvc', categoryName: 'Material' },
  { itemId: '1993cbdb-4420-49a0-8508-3e1ff72fc58d', itemName: 'Espatula Rigida Adesivo 2022', categoryName: 'Material' },
  { itemId: '7fb5ece1-08cb-42c1-a96b-e907d039459a', itemName: 'Espatula de Aço', categoryName: 'Material' },
  { itemId: '2a8e33b7-7ce3-47bc-98e9-71011d47303c', itemName: 'Rolo Anti Respingo 23cm', categoryName: 'Material' },
  { itemId: 'cf036ba0-7271-493a-b2dc-e09c46b9b4f2', itemName: 'Rolo Antirespingo 15cm', categoryName: 'Material' },
  { itemId: '25b34320-f513-4792-a45d-be02e6f9519e', itemName: 'Rolo Etiqueta', categoryName: 'Material' },
  { itemId: '1e179597-cd88-471b-a931-a473aa64597e', itemName: 'Rolo Fibra Sintética', categoryName: 'Material' },
  { itemId: 'a3f13e41-8577-46db-9568-bd7482ad3e8a', itemName: 'Rolo anti respingo 9cm', categoryName: 'Material' },
  { itemId: '20c6b85a-78d2-4118-b8d4-c4fcd1996f03', itemName: 'Rolo de Fita Para Arquear', categoryName: 'Material' },
  { itemId: '9e72fb08-a3a4-46c2-a895-5e18a3356c6f', itemName: 'Adesivo Selante Cinza PU40', categoryName: 'Material' },
  { itemId: '4adb7c78-6f27-458b-a40d-2ae5c7c2aeef', itemName: 'Adesivo Selante Preto PU40', categoryName: 'Material' },
  { itemId: '53f934c4-1a7a-411a-a5dc-3820ba1a12a2', itemName: 'Fita Crepe Premium Azul PR539', categoryName: 'Material' },
  { itemId: '33b6087f-0a29-4baf-b2db-7d9e0756e128', itemName: 'Fita Crepe Uso Geral 423', categoryName: 'Material' },
  { itemId: 'e1ed0027-488c-44bc-bfec-c59e4e3185d9', itemName: 'Fita Crepe Uso Geral PR539', categoryName: 'Material' },
  { itemId: 'd35e0465-4ec8-461b-9361-704ad54c8a4e', itemName: 'Fita Filete Pvc', categoryName: 'Material' },
  { itemId: '578f9d08-f450-47ac-bb76-dd2641d41123', itemName: 'Fitilho Reciclado F10', categoryName: 'Material' },
  { itemId: '8d7be8eb-50ae-4638-983e-2613e33c992c', itemName: 'Faixa Refletiva Lateral Direita DMB9300', categoryName: 'Material' },
  { itemId: '9e8da875-3516-4411-86d4-29ba50c32983', itemName: 'Faixa Refletiva Lateral Esquerda DMB', categoryName: 'Material' },
  { itemId: '27bd8ae8-ccb6-4bba-a913-39330af56e5f', itemName: 'Faixa Refletiva Para Choque', categoryName: 'Material' },
  { itemId: 'ee6990fa-18ed-4db9-8376-204d8c541c07', itemName: 'Tampa Para Bisnaga', categoryName: 'Material' },
  { itemId: 'ae030956-8184-4c4d-9f52-a3d40d596012', itemName: 'Bisnaga Pisseta PP', categoryName: 'Material' },
  { itemId: '30447dc7-af67-48a2-833c-c39474c2f78f', itemName: 'Bisnaga Plastica PE', categoryName: 'Material' },
  { itemId: '580cc07a-35bd-4744-88b3-babaf3f261ec', itemName: 'Bisnaga Plastico PE', categoryName: 'Material' },
  { itemId: '1f6b6ed1-f61e-4a8a-b2bf-d883cd0b79dc', itemName: 'Bobina Papel Tkv', categoryName: 'Material' },
  { itemId: '2a326e73-f5c1-4443-bfa0-6969a9f07202', itemName: 'Bobina Plástico Bolha', categoryName: 'Material' },
  { itemId: '1a35f151-c7d1-4995-9f9b-50b6b0e78d8e', itemName: 'Caixa Pote Redondo PP', categoryName: 'Material' },
  { itemId: '69ac194e-b761-4192-b492-fced8d697d2a', itemName: 'Sacola Plástica', categoryName: 'Material' },
  { itemId: '886a5ef8-1122-4911-aad4-907774ee2476', itemName: 'Pacote Saco de Lixo 200 lts C/100', categoryName: 'Material' },
  { itemId: '2383ca6e-ddd5-4611-8dfc-bae0a268587c', itemName: 'Papel Kraft 70GR', categoryName: 'Material' },
  { itemId: '25881152-1e74-45db-8ed1-850ec4e96af0', itemName: 'Selo Metalico Para Arquear', categoryName: 'Material' },
  { itemId: '4caec459-c79c-4074-8de2-3b625c1119f3', itemName: 'Mangueira de Ar', categoryName: 'Material' },
  { itemId: '7aac9e04-69be-4193-8387-acc887c67b66', itemName: 'Mangueira de Água', categoryName: 'Material' },
  { itemId: 'cc6c17ef-5f16-4f40-a083-899b6b659278', itemName: 'Mangueira Irrigação', categoryName: 'Material' },
  { itemId: 'edf3ba63-4f67-4f3f-b896-2efefda6a9a7', itemName: 'Refil de Gás 400gr', categoryName: 'Material' },
  { itemId: '63609fc9-aab8-41e0-9e8d-9bbb526f4584', itemName: 'Refil de Maçarico', categoryName: 'Material' },
  { itemId: '8eebd2c8-6bb5-4bd7-b82b-5782540694e3', itemName: 'Pilha AAA', categoryName: 'Material' },

  // ===== Peça (REGULAR) — vehicle parts, fittings, fasteners =====
  { itemId: '3d817d04-9b7a-4353-9ce4-26fc92703bd4', itemName: 'Engate Rapido Fêmea SP-40', categoryName: 'Peça' },
  { itemId: '48c0957c-d297-40ee-8b6e-f618626e7bd9', itemName: 'Engate Rapido Macho PP-40', categoryName: 'Peça' },
  { itemId: 'a16f8637-b4e3-4e75-a674-2491fb60b6b3', itemName: 'Engate Rapido Macho (int) PF-20', categoryName: 'Peça' },
  { itemId: '209a5ceb-d7f1-4905-b8e8-6c3fce1b3ab4', itemName: 'Engate Rápido Macho SM-40', categoryName: 'Peça' },
  { itemId: '2dbc786c-314f-47a2-9047-7057a49c0ba2', itemName: 'Plugue Fêmea', categoryName: 'Peça' },
  { itemId: 'ce75f3c4-b1d0-4190-83a5-54ef22825cbb', itemName: 'Plugue Macho', categoryName: 'Peça' },
  { itemId: '98be5acf-c998-418a-9533-abdf49fb70b7', itemName: 'Rebite Rosca Lisa', categoryName: 'Peça' },
  { itemId: '1b3bcb5d-e14c-4f19-b884-e7a6e73789e3', itemName: 'Rebite Rosca Lisa M10', categoryName: 'Peça' },
  { itemId: '172bf5f8-0e36-476c-bd29-1887c33a5f3f', itemName: 'Rebite Rosca Sextavado 630 702', categoryName: 'Peça' },
  { itemId: '823ee738-9ac9-4c87-8424-c08bb1b6d4c9', itemName: 'Rebite de Repuxo 416', categoryName: 'Peça' },
  { itemId: '26a543fd-f577-4211-a082-89edbe06f0b5', itemName: 'Rebite de Repuxo 516', categoryName: 'Peça' },
  { itemId: '7f327dee-cd14-47a1-9c8a-70b3ab8adb1f', itemName: 'Rebite de Repuxo 525', categoryName: 'Peça' },
  { itemId: 'd3e3b74f-4ea0-413d-ba9e-c20a7f20b165', itemName: 'Rebite de Repuxo 619', categoryName: 'Peça' },
  { itemId: '53f006e2-0053-4e00-b00f-b242ef88150d', itemName: 'Rebite de Repuxo 630 33-9', categoryName: 'Peça' },
  { itemId: '067eae2e-2294-4b49-b0a5-07a4e099f02b', itemName: 'Rebite de Repuxo 640', categoryName: 'Peça' },
  { itemId: '1015a6bb-3143-49cf-8bdf-9d8aedb8fdbd', itemName: 'Parafuso Allen Inox 10x25 DIN-912', categoryName: 'Peça' },
  { itemId: '0a5497ba-8d43-4ec5-8791-b7299dda1b8a', itemName: 'Parafuso Allen M06 X 0,40', categoryName: 'Peça' },
  { itemId: '83b17ddd-97e1-43b0-9be4-ead4c1fcf0a9', itemName: 'Parafuso Sextavado Inox', categoryName: 'Peça' },
  { itemId: '69f177f5-8613-43c2-93e0-1dae19a75c8c', itemName: 'Parafuso Sextavado Inox 5/16 X 7/8', categoryName: 'Peça' },
  { itemId: '11523546-ea3d-4639-bd38-be41341891cd', itemName: 'Parafuso Sextavado Inox 5/16x1', categoryName: 'Peça' },
  { itemId: '84c6676b-b8a5-4f7a-bbf1-b25f8b5bc596', itemName: 'Parafuso Sextavado Zincado', categoryName: 'Peça' },
  { itemId: '1221d6ad-ac04-4b34-b885-bec6883aa9bc', itemName: 'Parafuso Sextavado Zincado UNC 3/', categoryName: 'Peça' },
  { itemId: '44e07b61-f7b8-413d-9420-1c547382424d', itemName: 'Parafuso Torx Inox', categoryName: 'Peça' },
  { itemId: '403754b8-cc49-4340-97b9-52368949c851', itemName: 'Niple Duplo Galv', categoryName: 'Peça' },
  { itemId: 'a374e2ea-142d-4693-b207-ffe5ca996052', itemName: 'Conexão Cotov 90°galv', categoryName: 'Peça' },
  { itemId: '7b2899f6-afc4-46fd-bbb2-7266272641f9', itemName: 'Conexão Te Galv', categoryName: 'Peça' },
  { itemId: '1fb88b25-b4fa-4572-ad6c-0f107171bd07', itemName: 'Valvula Esferica Latão 1/2', categoryName: 'Peça' },
  { itemId: 'b24a723b-35cb-4f07-a477-8e2b969174e9', itemName: 'Valvula Esferica Latão 3/4', categoryName: 'Peça' },
  { itemId: '32e5ea19-f719-469a-b0d8-c04ef2e74cb3', itemName: 'Conjunto Mancal Extremidade', categoryName: 'Peça' },
  { itemId: 'e7844d5a-7ab5-4023-8cb2-db7e88092deb', itemName: 'Conjunto Mancal Intermediário 2 Furos', categoryName: 'Peça' },
  { itemId: 'b48ec4a3-a3d6-4283-88c4-628d60693c34', itemName: 'Conjunto Mancal Intermediário 4 Furos', categoryName: 'Peça' },
  { itemId: '54ec3a5b-aa9c-419c-8d3d-27c141801c45', itemName: 'Conjunto Trava Porta Grande 430', categoryName: 'Peça' },
  { itemId: '40824501-28a8-4ea2-8e1e-38413c44023a', itemName: 'Conjunto Trava Porta Pequeno', categoryName: 'Peça' },
  { itemId: '07aa58a7-11ce-41eb-9a84-2dea32e8739f', itemName: 'Trava Porta Fêmea', categoryName: 'Peça' },
  { itemId: '591736b8-675c-48af-8bdf-ff0587254590', itemName: 'Trava Porta Macho', categoryName: 'Peça' },
  { itemId: '8708a642-524a-4e6e-a7ec-cdbae21fe056', itemName: 'Batente Borracha X', categoryName: 'Peça' },
  { itemId: '98c615cd-0cb5-4659-8451-1bbd799add3b', itemName: 'Filtro Compressor CD24286676', categoryName: 'Peça' },
  { itemId: '42fc8b12-0c6d-44b4-ba2d-38fe94f044d0', itemName: 'Filtro de Oleo CD39329602', categoryName: 'Peça' },
  { itemId: '03b98975-98ac-490b-b2a7-4fdf05e6422c', itemName: 'Regulador de Pressão RE40-04', categoryName: 'Peça' },

  // ===== Elétrico =====
  { itemId: 'f8fe2972-d26a-4749-836b-ba0426aa1e01', itemName: 'Extensão Elétrica 2x', categoryName: 'Elétrico' },
  { itemId: 'c11fed94-3b7c-45c0-8b62-8cecde9dabbb', itemName: 'Tomada 20a Preta P85510', categoryName: 'Elétrico' },
  { itemId: '9446d4ee-3c43-4c2a-9e05-111d3d4d67c6', itemName: 'Tomada 20a Vermelha P85022', categoryName: 'Elétrico' },
  { itemId: '13cd2772-b8a5-4c48-bcb1-0bce2d206db2', itemName: 'Tampa P/ Condulete 2 Modulos', categoryName: 'Elétrico' },
  { itemId: 'cebbc97b-2539-4169-b3c5-a9d232b13d27', itemName: 'Espaguete Termoretratil', categoryName: 'Elétrico' },
  { itemId: 'c7ee7d59-8405-49c0-9c51-d7c78e32db2f', itemName: 'Condulete Pvc Preto', categoryName: 'Elétrico' },
  { itemId: '514b03f0-e6ff-4a0f-8668-7e0b0933ce4a', itemName: 'Luva Redução', categoryName: 'Elétrico' },

  // ===== Escritório =====
  { itemId: '35370500-b14a-47d8-8753-f01e1231339a', itemName: 'Lapis 6b', categoryName: 'Escritório' },
  { itemId: '6bd61235-0682-4b7a-a30e-7acdb5d4b9f4', itemName: 'Pacote Papel Sulfite A4', categoryName: 'Escritório' },
];
