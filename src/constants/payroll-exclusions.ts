// payroll-exclusions.ts
//
// Contas que existem no sistema mas NÃO representam um colaborador real, e por
// isso nunca entram em bonificação nem em folha.
//
// Identificadas por e-mail, não por id: o e-mail é único, sobrevive a
// recriação da conta e diz o que a conta é só de olhar. `payrollNumber` não
// serve — a conta de teste tem um número justamente para exercitar o caminho
// completo do Secullum.
//
// O efeito é no DIVISOR, não só na exibição: uma conta fantasma com peso 1
// aumenta o headcount médio do período e derruba o bônus de todo mundo.

/** E-mails (minúsculos) das contas fora de bonificação e folha. */
export const NON_PAYROLL_ACCOUNT_EMAILS: ReadonlySet<string> = new Set([
  // Conta de smoke-test da integração Secullum / do fluxo de bonificação.
  'plotter.ankaa@gmail.com',
]);

export function isNonPayrollAccount(email: string | null | undefined): boolean {
  return email != null && NON_PAYROLL_ACCOUNT_EMAILS.has(email.trim().toLowerCase());
}
