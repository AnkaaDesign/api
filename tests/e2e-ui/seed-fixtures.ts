/**
 * Fixtures do banco de teste (`ankaa_qa_e2e`, clone do acervo).
 *
 * Só o que a TELA não tem como criar: a senha do usuário que contra-assina.
 *
 * A contra-assinatura da Ankaa é feita pelo representante comercial do orçamento
 * — e, na falta dele, pelo diretor configurado. O serviço confere que quem chama
 * é AQUELE signatário (por isso um ADMIN qualquer leva 403, e está certo),
 * então o e2e precisa entrar no sistema como ele. A senha é copiada do
 * `qa.admin` (mesmo hash, mesma senha) e só existe no banco de teste.
 */
import { prisma } from './helpers/env';

async function main() {
  const modelo = await prisma.user.findFirst({
    where: { email: 'qa.admin@ankaa.test' },
    select: { password: true },
  });
  if (!modelo?.password) throw new Error('usuário qa.admin não encontrado no banco de teste');

  const diretor = await prisma.user.findFirst({
    where: { name: { contains: 'Sergio', mode: 'insensitive' } },
    select: { id: true, name: true, email: true, password: true },
  });
  if (!diretor) throw new Error('diretor não encontrado');

  await prisma.user.update({ where: { id: diretor.id }, data: { password: modelo.password, verified: true } });
  console.log(`senha de teste aplicada a ${diretor.name} <${diretor.email}>`);
  await prisma.$disconnect();
}
main();
