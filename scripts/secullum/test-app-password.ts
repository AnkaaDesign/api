/**
 * Prova ao vivo: criar um funcionário no Secullum JÁ com a senha do app e
 * confirmar que essa senha realmente autentica no pontowebapp — o host onde
 * mora tudo que o nosso app faz em nome do colaborador (incluir ponto,
 * justificativas, assinatura do cartão-ponto).
 *
 * O que é verificado, em ordem:
 *   1. POST /Funcionarios?alterouSenhaApp=true com SenhaApp cria o registro;
 *   2. a senha criada autentica no pontowebapp (caminho real do nosso código);
 *   3. CONTROLE NEGATIVO — uma senha errada é rejeitada. Sem isso o passo 2 não
 *      prova nada: se o endpoint aceitasse qualquer coisa, o verde seria falso;
 *   4. setFuncionarioAppPassword troca a senha (caminho de reparo do RH), e a
 *      nova senha passa a valer enquanto a antiga deixa de valer.
 *
 * Segurança: usa uma identidade sentinela própria (nome/folha/CPF que não
 * colidem com ninguém, e diferentes das do diagnóstico) e apaga o funcionário
 * no final — inclusive se algum passo falhar. Se a exclusão não passar, o
 * funcionário é demitido (fica invisível) e o script grita o id.
 *
 * Rodar: pnpm test:secullum-app-password
 *
 * ts-node, NÃO tsx: subir o AppModule inteiro exige `emitDecoratorMetadata`, e o
 * esbuild (que o tsx usa) não emite. Sem isso o Nest injeta `undefined` em
 * construtores que dependem de metadata e a subida morre em DeepLinkService.
 */
import axios from 'axios';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { SecullumCadastrosService } from '../../src/modules/integrations/secullum/secullum-cadastros.service';
import { SecullumService } from '../../src/modules/integrations/secullum/secullum.service';

// Identidade descartável — separada da sentinela do diagnóstico ("ANKAA
// HEALTHCHECK" / folha 999999) para que uma rodada não varra a outra.
const TEST_NOME = 'ANKAA SENHA APP TESTE';
const TEST_FOLHA = '999998';
const TEST_CPF = '123.456.789-09'; // CPF de teste válido (passa no mod-11)
const SENHA_ERRADA = '987654';
const SENHA_TROCADA = '456789';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function today(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00`;
}

/**
 * Chamada crua ao pontowebapp, uma tentativa só. Existe para o controle
 * negativo: o wrapper do serviço repete 401/403 três vezes (o host rejeita
 * rajadas de credenciais válidas), o que aqui só serviria para esperar.
 */
async function rawPontowebappStatus(usuario: string, senha: string): Promise<number> {
  const base = process.env.SECULLUM_PONTOWEBAPP_URL || 'https://pontowebapp.secullum.com.br';
  const customerId = process.env.SECULLUM_CUSTOMER_ID || '118769';
  const b64 = Buffer.from(`${usuario}:${senha}:0`, 'utf-8').toString('base64');
  try {
    const r = await axios.get(`${base}/${customerId}/Justificativas`, {
      headers: {
        Authorization: `Basic ${b64}`,
        'User-Agent': 'PontoWeb/94 CFNetwork/3826.500.131 Darwin/24.5.0',
        'Accept-Language': 'pt',
        Accept: '*/*',
      },
      timeout: 30000,
    });
    return r.status;
  } catch (error: any) {
    return error?.response?.status ?? 0;
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const cadastros = app.get(SecullumCadastrosService);
  const secullum = app.get(SecullumService);
  const senhaPadrao = secullum.funcionarioAppPassword;

  let funcionarioId: number | null = null;

  try {
    console.log('\nPré-checagem: a identidade sentinela está livre');
    const [ativos, demitidos] = await Promise.all([
      cadastros.listFuncionarios(),
      cadastros.listFuncionariosDemitidos().catch(() => []),
    ]);
    const colisoes = [...ativos, ...demitidos].filter(
      (f) =>
        String(f.NumeroFolha ?? '') === TEST_FOLHA ||
        String(f.NumeroIdentificador ?? '') === TEST_FOLHA ||
        String(f.Cpf ?? '').replace(/\D/g, '') === TEST_CPF.replace(/\D/g, ''),
    );
    if (colisoes.length > 0) {
      // Resíduo de uma rodada anterior que morreu no meio: apaga antes de seguir,
      // senão o create falha com CPF/folha duplicados.
      console.log(`  ! ${colisoes.length} resíduo(s) encontrado(s), removendo...`);
      for (const c of colisoes) {
        await deleteFuncionario(secullum, Number(c.Id));
        console.log(`    - funcionário ${c.Id} (${c.Nome}) removido`);
      }
    } else {
      console.log('  ✓ nenhuma colisão');
    }

    console.log('\nCriação: POST /Funcionarios com SenhaApp');
    const [empresas, funcoes, departamentos, horarios] = await Promise.all([
      cadastros.listEmpresas(),
      cadastros.listFuncoes(),
      cadastros.listDepartamentos(),
      cadastros.listHorarios(),
    ]);
    const created = (await cadastros.createFuncionario(
      {
        Nome: TEST_NOME,
        Cpf: TEST_CPF,
        NumeroFolha: TEST_FOLHA,
        NumeroIdentificador: TEST_FOLHA,
        EmpresaId: empresas[0]?.Id ?? 1,
        HorarioId: horarios[0]?.Id ?? 1,
        FuncaoId: funcoes[0]?.Id ?? 7,
        DepartamentoId: departamentos[0]?.Id ?? 3,
        Admissao: today(),
      },
      { appPassword: senhaPadrao },
    )) as unknown as { funcionarioId?: number; Id?: number };

    funcionarioId = Number(created.funcionarioId ?? created.Id ?? 0) || null;
    check('funcionário criado', funcionarioId !== null, JSON.stringify(created));
    if (!funcionarioId) throw new Error('sem id — não dá para continuar');
    console.log(`    id=${funcionarioId} folha=${TEST_FOLHA} senha="${senhaPadrao}"`);

    const full = await cadastros.getFuncionarioFull(funcionarioId);
    check('registro relido', Number(full.Id) === funcionarioId);
    console.log(
      `    SenhaApp devolvida pelo GET: ${JSON.stringify(full.SenhaApp)} ` +
        `(o Secullum não devolve a senha em claro — o que vale é o teste de autenticação abaixo)`,
    );

    console.log('\nAutenticação no pontowebapp (caminho real do app)');
    const positivo = await secullum.getJustificativasAsFuncionario({
      usuario: TEST_FOLHA,
      senha: senhaPadrao,
    });
    check(`senha "${senhaPadrao}" autentica`, positivo.success, positivo.message);
    if (positivo.success) {
      console.log(`    ${positivo.data.length} justificativa(s) visíveis ao colaborador`);
    }

    console.log('\nControle negativo (sem isto o teste acima não prova nada)');
    const statusErrado = await rawPontowebappStatus(TEST_FOLHA, SENHA_ERRADA);
    check(
      `senha "${SENHA_ERRADA}" é rejeitada`,
      statusErrado === 401 || statusErrado === 403,
      `HTTP ${statusErrado} (esperado 401/403)`,
    );

    console.log('\nTroca de senha (caminho de reparo do RH)');
    await cadastros.setFuncionarioAppPassword(funcionarioId, SENHA_TROCADA);
    const statusNova = await rawPontowebappStatus(TEST_FOLHA, SENHA_TROCADA);
    check(`senha nova "${SENHA_TROCADA}" autentica`, statusNova === 200, `HTTP ${statusNova}`);
    const statusAntiga = await rawPontowebappStatus(TEST_FOLHA, senhaPadrao);
    check(
      `senha antiga "${senhaPadrao}" deixou de valer`,
      statusAntiga === 401 || statusAntiga === 403,
      `HTTP ${statusAntiga} (esperado 401/403)`,
    );
  } finally {
    if (funcionarioId) {
      console.log('\nLimpeza');
      try {
        await deleteFuncionario(secullum, funcionarioId);
        const ainda = await funcionarioExists(cadastros, funcionarioId);
        check('funcionário de teste excluído', !ainda);
        if (ainda) {
          await secullum
            .getApiClient()
            .post('/Funcionarios/AlterarVisibilidadeFuncionarios', [funcionarioId]);
          console.error(
            `  ! exclusão não propagou — funcionário ${funcionarioId} foi DEMITIDO ` +
              `para não ficar ativo. Confira no Secullum.`,
          );
        }
      } catch (e) {
        failures++;
        console.error(
          `  ✗ FALHA NA LIMPEZA do funcionário ${funcionarioId}: ${(e as Error).message}\n` +
            `    APAGUE MANUALMENTE no Secullum (Cadastros → Funcionários → "${TEST_NOME}").`,
        );
      }
    }
    // O contexto Nest completo sobe Redis/WhatsApp/backup junto; o desligamento
    // deles pode estourar DEPOIS de o teste já ter terminado. Isso não é
    // resultado de teste — não pode derrubar o relatório.
    await app.close().catch(() => {});
  }

  console.log(
    failures === 0
      ? '\n✅ A senha do app definida na criação funciona.\n'
      : `\n❌ ${failures} verificação(ões) falharam.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/** Exclusão real — o endpoito do Secullum exige a senha do usuário admin no corpo. */
async function deleteFuncionario(secullum: SecullumService, id: number): Promise<void> {
  await secullum.getApiClient().delete('/Funcionarios/ExcluirFuncionarios', {
    data: {
      senhaUsuario: process.env.SECULLUM_PASSWORD || '',
      listaFuncionariosIdsSelecionados: [id],
    },
  });
}

async function funcionarioExists(
  cadastros: SecullumCadastrosService,
  id: number,
): Promise<boolean> {
  const [ativos, demitidos] = await Promise.all([
    cadastros.listFuncionarios().catch(() => []),
    cadastros.listFuncionariosDemitidos().catch(() => []),
  ]);
  return [...ativos, ...demitidos].some((f) => Number(f.Id) === id);
}

main().catch((e) => {
  console.error('\n💥 Erro não tratado:', e);
  process.exit(1);
});
