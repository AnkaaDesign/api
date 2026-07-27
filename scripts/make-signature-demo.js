require('reflect-metadata');
process.env.DISABLE_WHATSAPP='true'; process.env.DISABLE_SMS='true';
const ROOT='/home/kennedy/Documents/repositories/api';
(async()=>{
  const {NestFactory}=require('@nestjs/core');
  const {AppModule}=require(ROOT+'/dist/app.module');
  const {SignatureEnvelopeService}=require(ROOT+'/dist/modules/common/signature/services/signature-envelope.service');
  const {PrismaService}=require(ROOT+'/dist/modules/common/prisma/prisma.service');
  const app=await NestFactory.create(AppModule,{logger:['error']}); await app.init();
  const env=app.get(SignatureEnvelopeService,{strict:false});
  const prisma=app.get(PrismaService,{strict:false});
  const captured=[];
  env.setWhatsAppSender({ async sendMessage(phone,message){ captured.push({phone,message}); return true; } });

  const bn=Number(process.argv[2]||583);
  const q=await prisma.taskQuote.findFirst({where:{budgetNumber:bn},include:{task:{include:{customer:true,responsibles:true}}}});
  // A trilha de auditoria e append-only; apagar envelopes exige a valvula
  // explicita `ankaa.allow_signature_audit_delete`, que so existe para casos
  // legitimos como este (limpeza de demo). SET LOCAL vale so nesta transacao.
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL ankaa.allow_signature_audit_delete = 'on'");
    await tx.$executeRawUnsafe('DELETE FROM "SignatureEnvelope" WHERE "quoteId" = $1', q.id);
  });
  await prisma.taskQuote.update({where:{id:q.id},data:{status:'PENDING', expiresAt:new Date(Date.now()+30*864e5)}});
  const actor=await prisma.user.findFirst({select:{id:true}});
  const r=await env.createEnvelope({quoteId:q.id,actorUserId:actor.id,ctx:{ipAddress:'127.0.0.1',userAgent:'demo'}});
  const signers=await prisma.envelopeSigner.findMany({where:{envelopeId:r.envelopeId},orderBy:{orderGroup:'asc'}});
  const WEB='http://localhost:5173';
  console.log('\n================ DEMO PRONTA ================');
  console.log('Orçamento nº', bn, '—', q.task?.customer?.fantasyName);
  console.log('Envelope :', r.envelopeId);
  console.log('Código   :', r.verificationCode);
  console.log('\n--- PÁGINAS PARA ABRIR ---');
  signers.forEach(s=>{
    console.log(`\n[${s.orderGroup===1?'ANKAA':'CLIENTE'}] ${s.declaredName}  (tel ${s.declaredPhone})`);
    console.log(`  ${WEB}/cliente/assinar/${s.accessToken}`);
  });
  console.log(`\n[VERIFICAÇÃO PÚBLICA]`);
  console.log(`  ${WEB}/v/${r.verificationCode}`);
  console.log(`\n[PDF congelado (API direto)]`);
  console.log(`  http://localhost:3030/assinatura/publico/${signers[0].accessToken}/document.pdf`);
  console.log('\nCPF de teste válido: 529.982.247-25');
  console.log('O código OTP aparece no terminal do API? NÃO — use o comando abaixo para lê-lo do envio capturado.');
  console.log('=============================================\n');
  await app.close(); process.exit(0);
})().catch(e=>{console.error(e); process.exit(1);});
