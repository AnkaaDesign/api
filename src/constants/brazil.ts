// packages/constants/src/brazil.ts

export const BRAZILIAN_STATES = [
  "AC", // Acre
  "AL", // Alagoas
  "AP", // Amapá
  "AM", // Amazonas
  "BA", // Bahia
  "CE", // Ceará
  "DF", // Distrito Federal
  "ES", // Espírito Santo
  "GO", // Goiás
  "MA", // Maranhão
  "MT", // Mato Grosso
  "MS", // Mato Grosso do Sul
  "MG", // Minas Gerais
  "PA", // Pará
  "PB", // Paraíba
  "PR", // Paraná
  "PE", // Pernambuco
  "PI", // Piauí
  "RJ", // Rio de Janeiro
  "RN", // Rio Grande do Norte
  "RS", // Rio Grande do Sul
  "RO", // Rondônia
  "RR", // Roraima
  "SC", // Santa Catarina
  "SP", // São Paulo
  "SE", // Sergipe
  "TO", // Tocantins
] as const;

export type BrazilianState = (typeof BRAZILIAN_STATES)[number];

export const BRAZILIAN_STATE_NAMES: Record<BrazilianState, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};
