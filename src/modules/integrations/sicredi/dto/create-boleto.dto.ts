export class CreateBoletoDto {
  codigoBeneficiario: string;
  tipoCobranca: 'NORMAL' | 'HIBRIDO';
  pagador: {
    tipoPessoa: 'PESSOA_FISICA' | 'PESSOA_JURIDICA';
    documento: string;
    nome: string;
    endereco?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    telefone?: string;
    email?: string;
  };
  beneficiarioFinal?: {
    tipoPessoa: 'PESSOA_FISICA' | 'PESSOA_JURIDICA';
    documento: string;
    nome: string;
    logradouro?: string;
    numeroEndereco?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  };
  especieDocumento: string;
  nossoNumero?: number;
  seuNumero?: string;
  dataVencimento: string;
  valor: number;
  tipoDesconto?: 'VALOR' | 'PERCENTUAL';
  valorDesconto1?: number;
  dataDesconto1?: string;
  valorDesconto2?: number;
  dataDesconto2?: string;
  valorDesconto3?: number;
  dataDesconto3?: string;
  tipoJuros?: 'VALOR' | 'PERCENTUAL';
  juros?: number;
  multa?: number;
  validadeAposVencimento?: number;
  informativos?: string[];
  mensagens?: string[];
}
