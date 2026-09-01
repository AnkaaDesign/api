// api/src/modules/production/task-quote/task-quote-receipt.builder.ts
//
// HTML do recibo de quitação (cupom) enviado ao cliente quando o orçamento
// vira SETTLED. Documento à parte do orçamento assinado (`quote-html.builder.ts`):
// aqui não há cláusulas contratuais, é só o comprovante de "pago" para o cliente
// guardar — por isso vive em `task-quote/`, não em `common/signature/`.

export interface TaskQuoteReceiptData {
  budgetNumber: number;
  settledAtLabel: string;
  customerName: string;
  customerDocument: string | null;
  vehicleLabel: string | null;
  services: { description: string; amount: number }[];
  total: number;
  /** Mostra "a NFS-e foi enviada por e-mail" só quando a tarefa realmente emite NFS-e. */
  nfseNoticeEnabled: boolean;
}

export interface TaskQuoteReceiptCompanyInfo {
  name: string;
  corporateName: string;
  cnpjFormatted: string;
  addressShort: string;
  phone: string;
}

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Formata CNPJ/CPF a partir dos dígitos. Escrita aqui em vez de reaproveitar
 * `signature/utils/identity.ts` de propósito: aquele módulo está em edição
 * concorrente por outra sessão no momento em que este arquivo foi criado, e
 * uma máscara de documento não vale o acoplamento a um arquivo em fluxo.
 */
export function formatDocument(document: string | null | undefined): string | null {
  if (!document) return null;
  const digits = document.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return document;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildTaskQuoteReceiptHtml(
  data: TaskQuoteReceiptData,
  company: TaskQuoteReceiptCompanyInfo,
  logoDataUri: string | null,
): string {
  const kvRows: { label: string; value: string }[] = [
    { label: 'DATA', value: data.settledAtLabel },
    { label: 'CLIENTE', value: escapeHtml(data.customerName.toUpperCase()) },
  ];
  if (data.customerDocument) {
    kvRows.push({ label: 'CNPJ', value: data.customerDocument });
  }
  if (data.vehicleLabel) {
    kvRows.push({ label: 'VEÍCULO', value: escapeHtml(data.vehicleLabel.toUpperCase()) });
  }

  const itemsHtml = data.services
    .map(
      s => `<tr><td class="desc">${escapeHtml(s.description)}</td><td class="amt">${formatCurrencyBRL(s.amount).replace('R$', '').trim()}</td></tr>`,
    )
    .join('\n');

  const kvHtml = kvRows
    .map(row => `<div class="kv"><span class="k">${row.label}</span><span class="v">${row.value}</span></div>`)
    .join('\n');

  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="${company.name}">` : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 80mm;
    font-family: 'Courier New', Courier, monospace;
    color: #1a1a1a;
    background: #fffdf7;
  }
  .roll { padding: 8mm 5mm 8mm; }

  .center { text-align: center; }
  header { text-align: center; padding: 0 0 3mm; }
  header img { height: 15mm; }
  .co-name { font-size: 11pt; font-weight: bold; letter-spacing: 3px; margin-top: 2mm; color: #0a5c1e; }
  .co-sub { font-size: 6.6pt; color: #555; margin-top: 1.5mm; line-height: 1.5; }

  .dash { border-top: 1px dashed #999; margin: 4mm 0; }
  .dash.strong { border-top: 1.5px dashed #1a1a1a; }

  .title { text-align: center; font-size: 9.5pt; font-weight: bold; letter-spacing: 2px; }
  .sub-title { text-align: center; font-size: 7pt; color: #666; margin-top: 1mm; }

  .kv { display: flex; justify-content: space-between; font-size: 7.6pt; margin-top: 2.2mm; gap: 3mm; }
  .kv .k { color: #555; white-space: nowrap; }
  .kv .v { font-weight: bold; text-align: right; }

  table.items { width: 100%; margin-top: 4mm; font-size: 7.6pt; border-collapse: collapse; }
  table.items td { padding: 1.8mm 0; vertical-align: top; }
  table.items .amt { text-align: right; white-space: nowrap; font-weight: bold; }

  .total-line { display: flex; justify-content: space-between; align-items: baseline; margin-top: 4mm; padding-top: 3mm; border-top: 1.5px dashed #1a1a1a; }
  .total-line .lbl { font-size: 9pt; font-weight: bold; letter-spacing: 1px; }
  .total-line .val { font-size: 14pt; font-weight: bold; color: #1a1a1a; }

  .paid-badge {
    margin: 4mm auto 0; width: fit-content;
    border: 1.5px solid #1a1a1a; color: #1a1a1a; font-weight: bold;
    font-size: 8.5pt; letter-spacing: 3px; padding: 1.6mm 4mm;
  }

  .thanks { text-align: center; margin-top: 6mm; font-size: 8.3pt; line-height: 1.6; }
  .thanks b { display: block; font-size: 9.5pt; margin-bottom: 1.5mm; }

  footer { text-align: center; font-size: 6.3pt; color: #888; margin-top: 6mm; line-height: 1.7; }
</style>
</head>
<body>
  <div class="roll">
    <header>
      ${logoImg}
      <div class="co-name">${escapeHtml(company.name.toUpperCase())}</div>
      <div class="co-sub">${escapeHtml(company.corporateName)}<br>CNPJ ${company.cnpjFormatted}<br>${escapeHtml(company.addressShort)}</div>
    </header>

    <div class="dash strong"></div>

    <div class="title">RECIBO DE QUITAÇÃO</div>
    <div class="sub-title">Orçamento Nº ${data.budgetNumber}</div>

    ${kvHtml}

    <div class="dash"></div>

    <table class="items">
      ${itemsHtml}
    </table>

    <div class="total-line">
      <span class="lbl">TOTAL PAGO</span>
      <span class="val">${formatCurrencyBRL(data.total)}</span>
    </div>

    <div class="paid-badge center">✓ LIQUIDADO</div>

    <div class="dash"></div>

    <div class="thanks">
      <b>Obrigado pela confiança!</b>
      Foi um prazer colorir sua frota.<br>Esperamos te ver na estrada em breve.
    </div>

    <div class="dash"></div>

    <footer>
      ${escapeHtml(company.phone)}<br>
      Este comprovante não possui valor fiscal.${data.nfseNoticeEnabled ? '<br>\n      A NFS-e foi enviada separadamente por e-mail.' : ''}
    </footer>
  </div>
</body>
</html>
`;
}
