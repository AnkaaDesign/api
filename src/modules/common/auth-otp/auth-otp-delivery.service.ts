// api/src/modules/common/auth-otp/auth-otp-delivery.service.ts
//
// Entrega de CÓDIGO DE ACESSO, compartilhada por dois sujeitos:
//   • funcionário (`User`)        — recuperação de senha e primeiro acesso
//   • contato do cliente (`Responsible`) — login no portal
//
// E, desde 20/09/2026, de AVISO sem código para o contato do cliente
// (`deliverNotice`) — o que o sistema de NOTIFICAÇÕES passou a precisar quando
// `Notification.responsibleId` nasceu. A escada é a mesma; ver `AuthOtpNotice`
// para por que ela não virou um terceiro serviço.
//
// POR QUE ISTO EXISTE
//   O código do funcionário saía por SMS da Twilio. O canal oficial de WhatsApp
//   (Meta Cloud API) entrou em produção em 16/09 e hoje está LIGADO
//   (`WHATSAPP_CLOUD_ENABLED=true`), e é um canal melhor por três motivos
//   concretos, não por preferência:
//
//   1. ENTREGA ATESTADA POR TERCEIRO. O envio devolve um `wamid` e a Meta manda
//      webhooks `sent → delivered → read`. "O código saiu às 14:05 e chegou ao
//      aparelho" deixa de ser afirmação nossa sobre nós mesmos.
//   2. CHEGA. O telefone do contato de cliente é NOT NULL e único no cadastro;
//      o e-mail é opcional. Quem só tem telefone simplesmente não tinha como
//      receber código nenhum.
//   3. CUSTA MENOS e não depende de uma conta Twilio que ninguém confere.
//
//   O SMS continua existindo no código para outros usos, mas deixou de ser
//   caminho de autenticação.
//
// O QUE ESTE SERVIÇO NÃO FAZ
//   Não gera, não guarda e não confere código. Ele só ENTREGA a string que
//   recebeu e conta o que aconteceu. Quem gera, guarda como HMAC e confere com
//   incremento atômico é o dono do desafio (`ResponsibleAuthChallengeService`
//   para o portal; `VerificationService` para o funcionário, que segue como
//   está). Misturar as duas coisas foi exatamente o que apodreceu o fluxo
//   antigo do `Responsible`, onde o código era gerado com `Math.random()`,
//   gravado em texto claro e nunca enviado.
import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppCloudSender } from '@/modules/integrations/whatsapp-cloud/whatsapp-cloud-sender.service';
import { EmailService } from '@/modules/common/mailer/services/email.service';
import { maskEmail, maskPhone } from '@/modules/common/signature/utils/identity';
import { accessCodeTemplate, type AuthOtpWhatsAppTemplate } from './auth-otp-templates';

export type AuthOtpChannel = 'WHATSAPP' | 'EMAIL';

export interface AuthOtpTarget {
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Um AVISO — mensagem sem código, entregue pela MESMA escada deste serviço.
 *
 * POR QUE AQUI, E NÃO NUM TERCEIRO SERVIÇO
 *   Existem exatamente DOIS caminhos que alcançam um contato de cliente hoje: a
 *   cerimônia de assinatura (`signature-envelope.service.ts`, que tem a própria
 *   ponte porque fala com o Baileys quando a Cloud está desligada) e este. A
 *   escada "WhatsApp oficial primeiro, e-mail depois, nunca lança, devolve por
 *   qual canal saiu" é a mesma para um código e para um aviso; o que muda é o
 *   CONTEÚDO. Duplicar a escada num terceiro serviço garantiria que as duas
 *   divergissem — e a primeira a divergir seria a do aviso, que ninguém testa
 *   fazendo login.
 *
 * ⚠️ `whatsapp: null` NÃO é omissão: é a declaração de que este aviso ainda não
 * tem template aprovado na Meta. Fora da janela de 24 h a Cloud API recusa
 * qualquer corpo escrito por nós (é por isso que `WhatsAppCloudSender` nem
 * oferece `sendText`), então "mandar mesmo assim" não é uma opção que exista.
 * Com `null`, a perna do WhatsApp reporta o motivo e a escada cai para o
 * e-mail — em vez de fingir que tentou.
 */
export interface AuthOtpNotice {
  /** Template aprovado na Meta, ou `null` enquanto não houver um. */
  whatsapp: AuthOtpWhatsAppTemplate | null;
  /** A versão por e-mail. Sempre existe: é o canal que não depende da Meta. */
  email: { subject: string; html: string; kind: string };
}

export interface AuthOtpDeliveryResult {
  ok: boolean;
  /** Só preenchido quando `ok`. */
  channel?: AuthOtpChannel;
  /** Destino já mascarado — a tela diz para onde foi sem expor o contato. */
  destinationMask?: string;
  /** `wamid` da Meta ou messageId do SMTP: o comprovante. */
  providerMessageId?: string;
  /** Motivo legível quando nenhum canal aceitou. */
  reason?: string;
}

@Injectable()
export class AuthOtpDeliveryService {
  private readonly logger = new Logger(AuthOtpDeliveryService.name);

  constructor(
    private readonly whatsapp: WhatsAppCloudSender,
    private readonly email: EmailService,
  ) {}

  /** O canal preferido existe e está ligado? A tela usa isto para se explicar. */
  get whatsappAvailable(): boolean {
    return this.whatsapp.isConfigured;
  }

  /**
   * Entrega o código, WhatsApp primeiro. Sobre `preferred`, ver `ladder`.
   *
   * NUNCA LANÇA. Um canal morto não pode virar 500 numa rota pública; o chamador
   * precisa do `{ ok: false, reason }` para gravar o desafio como não entregue e
   * dizer algo útil na tela.
   */
  async deliver(
    target: AuthOtpTarget,
    code: string,
    preferred?: AuthOtpChannel,
  ): Promise<AuthOtpDeliveryResult> {
    return this.ladder(preferred, {
      WHATSAPP: () => this.viaWhatsApp(target, code),
      EMAIL: () => this.viaEmail(target, code),
    });
  }

  /**
   * Entrega um AVISO (sem código) pela mesma escada.
   *
   * É o que o portal do responsável usa para dizer ao contato do cliente que o
   * orçamento dele saiu da fila e já tem valores — e é a primeira mensagem do
   * sistema de NOTIFICAÇÕES que alcança alguém de fora da Ankaa.
   *
   * ⚠️ NUNCA LANÇA, pelo mesmo motivo do código: quem chama é um dispatch de
   * notificação rodando depois de uma transação de negócio já confirmada. Um
   * canal morto não pode desfazer uma pré-aprovação que já aconteceu.
   */
  async deliverNotice(
    target: AuthOtpTarget,
    notice: AuthOtpNotice,
    preferred?: AuthOtpChannel,
  ): Promise<AuthOtpDeliveryResult> {
    return this.ladder(preferred, {
      WHATSAPP: () => this.viaWhatsAppTemplate(target, notice.whatsapp),
      EMAIL: () => this.viaEmailHtml(target, notice.email),
    });
  }

  /**
   * A escada, uma só.
   *
   * `preferred` permite respeitar o que a pessoa DIGITOU: quem entrou com o
   * telefone espera o código naquele telefone. É a mesma regra que
   * `AuthService.dispatchCode` já aplicava, e ela existe porque a alternativa —
   * mandar sempre pelo que o cadastro tem — surpreende justamente quem tem dois
   * contatos e escolheu um. Para um AVISO não há "o que a pessoa digitou", e o
   * parâmetro simplesmente não é passado: vale a ordem padrão.
   */
  private async ladder(
    preferred: AuthOtpChannel | undefined,
    legs: Record<AuthOtpChannel, () => Promise<AuthOtpDeliveryResult>>,
  ): Promise<AuthOtpDeliveryResult> {
    const order: AuthOtpChannel[] =
      preferred === 'EMAIL' ? ['EMAIL', 'WHATSAPP'] : ['WHATSAPP', 'EMAIL'];

    const failures: string[] = [];

    for (const channel of order) {
      const attempt = await legs[channel]();

      if (attempt.ok) return attempt;
      if (attempt.reason) failures.push(`${channel}: ${attempt.reason}`);
    }

    return {
      ok: false,
      reason: failures.length
        ? failures.join(' · ')
        : 'Nenhum canal de contato disponível para este cadastro.',
    };
  }

  /**
   * Entrega por UM canal, sem fallback.
   *
   * Existe para quem já tem a própria lógica de prioridade e só quer trocar a
   * implementação de uma perna — é o caso de `AuthService.dispatchCode`, que já
   * decide a ordem a partir do que a pessoa DIGITOU e só precisava que a perna
   * do telefone deixasse de ser SMS e passasse a ser WhatsApp.
   */
  async deliverVia(
    channel: AuthOtpChannel,
    target: AuthOtpTarget,
    code: string,
  ): Promise<AuthOtpDeliveryResult> {
    return channel === 'WHATSAPP'
      ? this.viaWhatsApp(target, code)
      : this.viaEmail(target, code);
  }

  private async viaWhatsApp(
    target: AuthOtpTarget,
    code: string,
  ): Promise<AuthOtpDeliveryResult> {
    return this.viaWhatsAppTemplate(target, accessCodeTemplate(code));
  }

  /**
   * A perna do WhatsApp, genérica: recebe o template já montado.
   *
   * `template === null` é o estado normal de um aviso cujo texto ainda não foi
   * aprovado pela Meta. Ele PULA o canal em vez de tentar texto livre — a Cloud
   * API recusa corpo próprio fora da janela de 24 h, e todo aviso do sistema
   * nasce fora dela.
   */
  private async viaWhatsAppTemplate(
    target: AuthOtpTarget,
    template: AuthOtpWhatsAppTemplate | null,
  ): Promise<AuthOtpDeliveryResult> {
    if (!template) {
      return { ok: false, reason: 'sem template aprovado na Meta para esta mensagem' };
    }
    if (!this.whatsapp.isConfigured) {
      return { ok: false, reason: 'canal oficial desligado' };
    }
    if (!target.phone) {
      return { ok: false, reason: 'sem telefone no cadastro' };
    }

    // `sendTemplate` é contratualmente "nunca lança" — o try é para o caso de
    // uma exceção de rede escapar de dentro dele, não para o caminho normal.
    try {
      const result = await this.whatsapp.sendTemplate(target.phone, template);
      if (!result.ok) {
        return { ok: false, reason: result.reason ?? 'envio recusado' };
      }
      return {
        ok: true,
        channel: 'WHATSAPP',
        destinationMask: maskPhone(target.phone),
        // O `wamid` é o comprovante: é por ele que o webhook `sent → delivered
        // → read` nos encontra depois. Guardá-lo é o que permite dizer "o
        // código saiu às 14:05 e chegou ao aparelho" com atestado de terceiro.
        providerMessageId: result.wamid,
      };
    } catch (error) {
      // O código JAMAIS entra no log — é o defeito que desqualificou o
      // `VerificationService`, que imprime o código esperado em `warn`.
      this.logger.error(`Falha ao entregar código por WhatsApp: ${(error as Error).message}`);
      return { ok: false, reason: 'falha de transporte' };
    }
  }

  private async viaEmail(target: AuthOtpTarget, code: string): Promise<AuthOtpDeliveryResult> {
    if (!target.email) {
      return { ok: false, reason: 'sem e-mail no cadastro' };
    }

    try {
      const baseData = this.email.createBaseEmailData(target.name);
      // ⛔ NÃO É `sendPasswordResetCode`, e era. Quem recebe este código é o
      // contato do CLIENTE, que não tem senha no sistema — o portal entra só
      // por código. O e-mail chegava dizendo "você solicitou a redefinição da
      // sua senha", que acusa um pedido que ele não fez sobre uma credencial
      // que ele não tem: a leitura natural é invasão, e a reação é ligar para
      // o comercial achando que a conta foi tomada.
      const result = await this.email.sendAccessCode(target.email, {
        ...baseData,
        accessCode: code,
        expiryMinutes: 10,
      });

      if (!result.success) {
        return { ok: false, reason: result.error ?? 'envio recusado' };
      }
      return {
        ok: true,
        channel: 'EMAIL',
        destinationMask: maskEmail(target.email),
        providerMessageId: result.messageId,
      };
    } catch (error) {
      this.logger.error(`Falha ao entregar código por e-mail: ${(error as Error).message}`);
      return { ok: false, reason: 'falha de transporte' };
    }
  }

  /**
   * A perna do e-mail para AVISO: assunto e HTML já prontos.
   *
   * Usa `sendEmailWithRetry`, que é o mesmo transporte (e a mesma política de
   * 3 tentativas com recuo) por baixo de `sendPasswordResetCode`. O que não se
   * reusa é o TEMPLATE do código: um aviso de orçamento chegando com a moldura
   * de "redefinir senha" é o mesmo defeito de fundo que fez `ACCESS_CODE` não
   * reusar `orcamento_codigo` no WhatsApp — contexto que não bate com o ato.
   */
  private async viaEmailHtml(
    target: AuthOtpTarget,
    email: { subject: string; html: string; kind: string },
  ): Promise<AuthOtpDeliveryResult> {
    if (!target.email) {
      return { ok: false, reason: 'sem e-mail no cadastro' };
    }

    try {
      const result = await this.email.sendEmailWithRetry(
        target.email,
        email.subject,
        email.html,
        email.kind,
      );

      if (!result.success) {
        return { ok: false, reason: result.error ?? 'envio recusado' };
      }
      return {
        ok: true,
        channel: 'EMAIL',
        destinationMask: maskEmail(target.email),
        providerMessageId: result.messageId,
      };
    } catch (error) {
      this.logger.error(`Falha ao entregar aviso por e-mail: ${(error as Error).message}`);
      return { ok: false, reason: 'falha de transporte' };
    }
  }
}
