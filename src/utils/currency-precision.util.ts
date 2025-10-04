export function toPrecision(value: number, precision: number = 2): number {
  const multiplier = Math.pow(10, precision);
  return Math.round(value * multiplier) / multiplier;
}

export function roundCurrency(value: number): number {
  return toPrecision(value, 2);
}

export function roundAverage(value: number): number {
  return toPrecision(value, 2);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}