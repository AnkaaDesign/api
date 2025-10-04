// Email templates for different types of communications
// All templates are in Brazilian Portuguese

interface BaseTemplateData {
  companyName: string;
  supportEmail: string;
  supportPhone: string;
  supportUrl: string;
  userName?: string;
}

interface PasswordResetTemplateData extends BaseTemplateData {
  resetUrl: string;
  resetToken: string;
}

interface TemporaryPasswordTemplateData extends BaseTemplateData {
  loginUrl: string;
  temporaryPassword: string;
}

interface AccountVerificationTemplateData extends BaseTemplateData {
  verificationUrl: string;
  verificationToken: string;
}

interface EmailVerificationCodeTemplateData extends BaseTemplateData {
  verificationCode: string;
  expiryMinutes: number;
}

interface PasswordResetCodeTemplateData extends BaseTemplateData {
  resetCode: string;
  expiryMinutes: number;
}

interface PasswordChangedTemplateData extends BaseTemplateData {
  loginUrl: string;
  changeTime: string;
}

interface AccountStatusChangeTemplateData extends BaseTemplateData {
  loginUrl: string;
  newStatus: string;
  reason?: string;
  changeTime: string;
}

interface WelcomeTemplateData extends BaseTemplateData {
  loginUrl: string;
}

const baseEmailStyle = `
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    line-height: 1.6;
    color: #333;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  }
  .header {
    background: #16802B;
    color: white;
    padding: 20px;
    text-align: center;
    border-radius: 8px 8px 0 0;
  }
  .content {
    background: white;
    padding: 30px;
    border: 1px solid #ddd;
    border-top: none;
  }
  .footer {
    background: #f8f9fa;
    padding: 20px;
    text-align: center;
    border: 1px solid #ddd;
    border-top: none;
    border-radius: 0 0 8px 8px;
    font-size: 14px;
    color: #666;
  }
  .button {
    display: inline-block;
    padding: 12px 30px;
    background: #16802B;
    color: white;
    text-decoration: none;
    border-radius: 5px;
    font-weight: bold;
    margin: 20px 0;
  }
  .button:hover {
    background: #125a1f;
  }
  .alert {
    background: #fff3cd;
    border: 1px solid #ffeaa7;
    border-radius: 5px;
    padding: 15px;
    margin: 20px 0;
  }
  .warning {
    background: #f8d7da;
    border: 1px solid #f5c6cb;
    border-radius: 5px;
    padding: 15px;
    margin: 20px 0;
  }
  .success {
    background: #d4edda;
    border: 1px solid #c3e6cb;
    border-radius: 5px;
    padding: 15px;
    margin: 20px 0;
  }
  .code {
    background: #f1f3f4;
    border: 1px solid #dadce0;
    border-radius: 5px;
    padding: 15px;
    font-family: 'Courier New', monospace;
    font-size: 18px;
    font-weight: bold;
    text-align: center;
    margin: 20px 0;
  }
`;

export function generatePasswordResetTemplate(data: PasswordResetTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Redefinir Senha - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>🔒 Redefinir Senha</h1>
        <p>Solicitação de redefinição de senha</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <p>Você solicitou a redefinição da sua senha no sistema ${data.companyName}.</p>
        
        <p>Para criar uma nova senha, clique no botão abaixo:</p>
        
        <div style="text-align: center;">
          <a href="${data.resetUrl}" class="button">Redefinir Senha</a>
        </div>
        
        <div class="alert">
          <strong>⚠️ Importante:</strong>
          <ul>
            <li>Este link expira em <strong>2 horas</strong></li>
            <li>Se você não solicitou esta redefinição, ignore este email</li>
            <li>Por segurança, não compartilhe este link com outras pessoas</li>
          </ul>
        </div>
        
        <p>Se o botão não funcionar, copie e cole o link abaixo no seu navegador:</p>
        <p style="word-break: break-all; background: #f5f5f5; padding: 10px; border-radius: 5px;">
          ${data.resetUrl}
        </p>
      </div>
      
      <div class="footer">
        <p>Se você não solicitou esta redefinição, pode ignorar este email com segurança.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}

export function generateTemporaryPasswordTemplate(data: TemporaryPasswordTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Senha Temporária - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>🔑 Senha Temporária</h1>
        <p>Sua nova senha temporária</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <p>Sua senha foi redefinida por um administrador. Use a senha temporária abaixo para fazer login:</p>
        
        <div class="code">
          ${data.temporaryPassword}
        </div>
        
        <div style="text-align: center;">
          <a href="${data.loginUrl}" class="button">Fazer Login</a>
        </div>
        
        <div class="warning">
          <strong>🚨 Atenção:</strong>
          <ul>
            <li>Esta é uma senha temporária</li>
            <li>Você será solicitado a criar uma nova senha após o login</li>
            <li>Por segurança, não compartilhe esta senha com outras pessoas</li>
            <li>Faça login o quanto antes para definir sua nova senha</li>
          </ul>
        </div>
        
        <p>Se você não conseguir fazer login, entre em contato com o administrador.</p>
      </div>
      
      <div class="footer">
        <p>Se você não esperava este email, entre em contato conosco imediatamente.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}

export function generateAccountVerificationTemplate(data: AccountVerificationTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verificar Conta - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>✅ Verificar Conta</h1>
        <p>Confirme seu endereço de email</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <p>Bem-vindo ao ${data.companyName}! Para confirmar seu cadastro e acessar sua conta, clique no botão abaixo:</p>
        
        <div style="text-align: center;">
          <a href="${data.verificationUrl}" class="button">Verificar Email</a>
        </div>
        
        <div class="alert">
          <strong>📋 Próximos passos:</strong>
          <ol>
            <li>Clique no botão "Verificar Email" acima</li>
            <li>Seu email será confirmado automaticamente</li>
            <li>Você será redirecionado para fazer login</li>
            <li>Comece a usar o sistema!</li>
          </ol>
        </div>
        
        <p>Se o botão não funcionar, copie e cole o link abaixo no seu navegador:</p>
        <p style="word-break: break-all; background: #f5f5f5; padding: 10px; border-radius: 5px;">
          ${data.verificationUrl}
        </p>
      </div>
      
      <div class="footer">
        <p>Se você não se cadastrou no ${data.companyName}, pode ignorar este email.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}

export function generatePasswordChangedNotificationTemplate(
  data: PasswordChangedTemplateData,
): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Senha Alterada - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>🔐 Senha Alterada</h1>
        <p>Confirmação de alteração de senha</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <div class="success">
          <p><strong>✅ Sua senha foi alterada com sucesso!</strong></p>
          <p>Data e hora: ${data.changeTime}</p>
        </div>
        
        <p>Esta é uma notificação de segurança para informar que sua senha foi alterada no sistema ${data.companyName}.</p>
        
        <div class="alert">
          <strong>🔒 Informações de segurança:</strong>
          <ul>
            <li>Se você fez esta alteração, não é necessário fazer nada</li>
            <li>Se você não fez esta alteração, sua conta pode ter sido comprometida</li>
            <li>Neste caso, entre em contato conosco imediatamente</li>
          </ul>
        </div>
        
        <div style="text-align: center;">
          <a href="${data.loginUrl}" class="button">Fazer Login</a>
        </div>
        
        <p>Se você não alterou sua senha, recomendamos que:</p>
        <ul>
          <li>Entre em contato com o administrador imediatamente</li>
          <li>Verifique se há atividade suspeita em sua conta</li>
          <li>Considere alterar senhas de outros serviços se usar a mesma senha</li>
        </ul>
      </div>
      
      <div class="footer">
        <p>Este é um email automático de segurança. Se você não esperava este email, entre em contato conosco.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}

export function generateAccountStatusChangeTemplate(data: AccountStatusChangeTemplateData): string {
  const isActive = data.newStatus === 'ACTIVE';
  const statusText = isActive ? 'Ativa' : 'Inativa';
  const statusColor = isActive ? '#28a745' : '#dc3545';

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Status da Conta Alterado - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>👤 Status da Conta</h1>
        <p>Alteração no status da sua conta</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <p>O status da sua conta no sistema ${data.companyName} foi alterado.</p>
        
        <div style="background: ${isActive ? '#d4edda' : '#f8d7da'}; border: 1px solid ${isActive ? '#c3e6cb' : '#f5c6cb'}; border-radius: 5px; padding: 15px; margin: 20px 0;">
          <p><strong>📋 Detalhes da alteração:</strong></p>
          <ul>
            <li><strong>Novo status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span></li>
            <li><strong>Data e hora:</strong> ${data.changeTime}</li>
            ${data.reason ? `<li><strong>Motivo:</strong> ${data.reason}</li>` : ''}
          </ul>
        </div>
        
        ${
          isActive
            ? `
          <div class="success">
            <p><strong>✅ Sua conta está ativa!</strong></p>
            <p>Você pode fazer login e usar o sistema normalmente.</p>
          </div>
          
          <div style="text-align: center;">
            <a href="${data.loginUrl}" class="button">Fazer Login</a>
          </div>
        `
            : `
          <div class="warning">
            <p><strong>⚠️ Sua conta está inativa!</strong></p>
            <p>Você não conseguirá fazer login ou usar o sistema até que sua conta seja reativada.</p>
            <p>Se você acredita que isso é um erro, entre em contato com o administrador.</p>
          </div>
        `
        }
        
        <p>Se você tiver dúvidas sobre esta alteração, entre em contato conosco.</p>
      </div>
      
      <div class="footer">
        <p>Este é um email automático de notificação. Se você não esperava este email, entre em contato conosco.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}

export function generateEmailVerificationCodeTemplate(
  data: EmailVerificationCodeTemplateData,
): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Código de Verificação - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>🔐 Código de Verificação</h1>
        <p>Confirme seu endereço de email</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <p>Para verificar sua conta no ${data.companyName}, use o código de verificação abaixo:</p>
        
        <div class="code">
          ${data.verificationCode}
        </div>
        
        <div class="alert">
          <strong>📋 Informações importantes:</strong>
          <ul>
            <li>Este código é válido por <strong>${data.expiryMinutes} minutos</strong></li>
            <li>Digite o código exatamente como mostrado acima</li>
            <li>Se você não solicitou este código, ignore este email</li>
            <li>Por segurança, não compartilhe este código com outras pessoas</li>
          </ul>
        </div>
        
        <div class="success">
          <p><strong>✅ Próximos passos:</strong></p>
          <ol>
            <li>Volte para a tela de verificação</li>
            <li>Digite o código de 6 dígitos acima</li>
            <li>Clique em "Verificar Código"</li>
            <li>Sua conta será verificada automaticamente</li>
          </ol>
        </div>
        
        <p>Após a verificação, você poderá fazer login e usar todas as funcionalidades do sistema.</p>
      </div>
      
      <div class="footer">
        <p>Se você não se cadastrou no ${data.companyName}, pode ignorar este email com segurança.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}

export function generatePasswordResetCodeTemplate(data: PasswordResetCodeTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Código para Redefinir Senha - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>🔒 Redefinir Senha</h1>
        <p>Código de verificação para redefinir sua senha</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <p>Você solicitou a redefinição da sua senha no sistema ${data.companyName}. Use o código abaixo:</p>
        
        <div class="code">
          ${data.resetCode}
        </div>
        
        <div class="alert">
          <strong>⚠️ Importante:</strong>
          <ul>
            <li>Este código é válido por <strong>${data.expiryMinutes} minutos</strong></li>
            <li>Digite o código exatamente como mostrado acima</li>
            <li>Se você não solicitou esta redefinição, ignore este email</li>
            <li>Por segurança, não compartilhe este código com outras pessoas</li>
          </ul>
        </div>
        
        <div class="success">
          <p><strong>🔄 Como redefinir sua senha:</strong></p>
          <ol>
            <li>Volte para a tela de redefinição de senha</li>
            <li>Digite o código de 6 dígitos acima</li>
            <li>Crie sua nova senha</li>
            <li>Confirme a nova senha</li>
            <li>Clique em "Redefinir Senha"</li>
          </ol>
        </div>
        
        <p>Após redefinir, você poderá fazer login com sua nova senha.</p>
      </div>
      
      <div class="footer">
        <p>Se você não solicitou esta redefinição, pode ignorar este email com segurança.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}

export function generateWelcomeEmailTemplate(data: WelcomeTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bem-vindo ao ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header">
        <h1>🎉 Bem-vindo!</h1>
        <p>Seja bem-vindo ao ${data.companyName}</p>
      </div>
      
      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>
        
        <p>É um prazer ter você conosco! Sua conta foi criada com sucesso e você já pode começar a usar o sistema.</p>
        
        <div style="text-align: center;">
          <a href="${data.loginUrl}" class="button">Acessar Sistema</a>
        </div>
        
        <div class="success">
          <p><strong>🚀 Próximos passos:</strong></p>
          <ol>
            <li>Clique no botão "Acessar Sistema" acima</li>
            <li>Faça login com suas credenciais</li>
            <li>Complete seu perfil, se necessário</li>
            <li>Explore as funcionalidades do sistema</li>
          </ol>
        </div>
        
        <div class="alert">
          <p><strong>💡 Dicas importantes:</strong></p>
          <ul>
            <li>Mantenha suas credenciais seguras</li>
            <li>Não compartilhe sua senha com outras pessoas</li>
            <li>Se tiver dúvidas, consulte nossa equipe de suporte</li>
            <li>Explore o sistema com calma para se familiarizar</li>
          </ul>
        </div>
        
        <p>Estamos aqui para ajudar você a aproveitar ao máximo o sistema. Se tiver alguma dúvida, não hesite em nos contatar!</p>
      </div>
      
      <div class="footer">
        <p>Obrigado por fazer parte do ${data.companyName}!</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
      </div>
    </body>
    </html>
  `;
}
