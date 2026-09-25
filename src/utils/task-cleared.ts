// utils/task-cleared.ts

/**
 * A liberação segue o IMPLEMENTO, não a previsão.
 *
 * `cleared` ("liberado") quer dizer que o veículo está liberado para entrar/entrou.
 * Por isso gravar `entryDate` auto-libera a tarefa: se há data de entrada o implemento
 * está fisicamente aqui.
 *
 * O caminho inverso — gravar `forecastDate` zera `cleared`, exigindo nova
 * confirmação — só faz sentido enquanto o implemento ainda NÃO entrou. Depois da
 * entrada ele vira efeito colateral silencioso: qualquer tela que reenvie
 * `forecastDate` junto do resto do formulário (a de orçamento do app manda o valor
 * INALTERADO) desliberava a tarefa e ainda tirava o implemento do pátio, sem deixar
 * rastro — `cleared` não vai para o ChangeLog. Foi o que aconteceu com a Frutamina
 * em 2026-08-24: entrada dada em 17/08, desliberada por um salvamento de orçamento
 * em 24/08, e a tarefa passou a aparecer como "Previsão vencida sem liberação".
 *
 * Regra: com `entryDate` preenchida a tarefa está liberada e assim permanece. Um
 * `cleared` explícito vindo do chamador continua vencendo — quem desmarca
 * "Liberado" na mão está dizendo que o implemento foi embora.
 */
export function hasEntered(entryDate: Date | string | null | undefined): boolean {
  return entryDate !== null && entryDate !== undefined && entryDate !== '';
}
