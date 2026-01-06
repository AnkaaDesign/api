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

// =====================
// Notification Template
// =====================

interface NotificationEmailTemplateData extends BaseTemplateData {
  notificationType: 'TASK' | 'ORDER' | 'STOCK' | 'USER' | 'SYSTEM' | 'VACATION' | 'GENERAL';
  eventType: string;
  importance: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
  metadata?: Record<string, string>;
  timestamp: string;
}

const notificationTypeConfig: Record<string, { icon: string; color: string; label: string }> = {
  TASK: { icon: '📋', color: '#3b82f6', label: 'Tarefa' },
  ORDER: { icon: '🛒', color: '#8b5cf6', label: 'Pedido' },
  STOCK: { icon: '📦', color: '#f59e0b', label: 'Estoque' },
  USER: { icon: '👤', color: '#10b981', label: 'Usuário' },
  SYSTEM: { icon: '⚙️', color: '#6b7280', label: 'Sistema' },
  VACATION: { icon: '🏖️', color: '#06b6d4', label: 'Férias' },
  GENERAL: { icon: '🔔', color: '#16802B', label: 'Geral' },
};

const importanceConfig: Record<string, { color: string; bgColor: string; label: string }> = {
  URGENT: { color: '#dc2626', bgColor: '#fef2f2', label: 'URGENTE' },
  HIGH: { color: '#ea580c', bgColor: '#fff7ed', label: 'ALTA PRIORIDADE' },
  NORMAL: { color: '#16802B', bgColor: '#f0fdf4', label: 'NORMAL' },
  LOW: { color: '#6b7280', bgColor: '#f9fafb', label: 'BAIXA PRIORIDADE' },
};

export function generateNotificationEmailTemplate(data: NotificationEmailTemplateData): string {
  const typeConfig = notificationTypeConfig[data.notificationType] || notificationTypeConfig.GENERAL;
  const importConfig = importanceConfig[data.importance] || importanceConfig.NORMAL;

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${data.title} - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header" style="background: ${typeConfig.color};">
        <h1>${typeConfig.icon} ${typeConfig.label}</h1>
        <p>${data.eventType}</p>
      </div>

      <div class="content">
        ${data.importance !== 'NORMAL' ? `
        <div style="background: ${importConfig.bgColor}; border-left: 4px solid ${importConfig.color}; padding: 12px 15px; margin-bottom: 20px; border-radius: 4px;">
          <strong style="color: ${importConfig.color};">${importConfig.label}</strong>
        </div>
        ` : ''}

        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>

        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0; color: #333;">${data.title}</h3>
          <p style="margin: 0; color: #555; line-height: 1.6; white-space: pre-wrap;">${data.message}</p>
        </div>

        ${data.metadata && Object.keys(data.metadata).length > 0 ? `
        <div style="margin: 20px 0;">
          <strong style="color: #333;">Detalhes:</strong>
          <table style="width: 100%; margin-top: 10px; border-collapse: collapse;">
            ${Object.entries(data.metadata).map(([key, value]) => `
              <tr>
                <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 500; width: 40%;">${key}</td>
                <td style="padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb;">${value}</td>
              </tr>
            `).join('')}
          </table>
        </div>
        ` : ''}

        ${data.actionUrl ? `
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.actionUrl}" class="button" style="background: ${typeConfig.color};">${data.actionText || 'Ver Detalhes'}</a>
        </div>
        ` : ''}

        <p style="font-size: 13px; color: #6c757d; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
          Recebido em: ${data.timestamp}
        </p>
      </div>

      <div class="footer">
        <p>Esta é uma notificação automática do sistema ${data.companyName}.</p>
        <p>Para alterar suas preferências de notificação, acesse as configurações do seu perfil.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail}${data.supportPhone ? ` | 📱 ${data.supportPhone}` : ''}</p>
      </div>
    </body>
    </html>
  `;
}

// =====================
// Task Notification Template
// =====================

interface TaskNotificationTemplateData extends BaseTemplateData {
  eventType: 'status' | 'assignment' | 'deadline' | 'comment' | 'artwork' | 'completion' | 'priority';
  taskTitle: string;
  taskDescription?: string;
  previousValue?: string;
  newValue?: string;
  dueDate?: string;
  assignedBy?: string;
  assignedTo?: string;
  commentAuthor?: string;
  commentText?: string;
  taskUrl: string;
}

const taskEventLabels: Record<string, { title: string; description: string }> = {
  status: { title: 'Status Alterado', description: 'O status da tarefa foi atualizado' },
  assignment: { title: 'Tarefa Atribuída', description: 'Uma tarefa foi atribuída a você' },
  deadline: { title: 'Prazo Próximo', description: 'O prazo da tarefa está se aproximando' },
  comment: { title: 'Novo Comentário', description: 'Alguém comentou na tarefa' },
  artwork: { title: 'Arte Atualizada', description: 'Os arquivos de arte foram modificados' },
  completion: { title: 'Tarefa Concluída', description: 'A tarefa foi concluída' },
  priority: { title: 'Prioridade Alterada', description: 'A prioridade da tarefa foi alterada' },
};

export function generateTaskNotificationTemplate(data: TaskNotificationTemplateData): string {
  const eventConfig = taskEventLabels[data.eventType] || { title: 'Atualização de Tarefa', description: 'A tarefa foi atualizada' };

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${eventConfig.title} - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header" style="background: #3b82f6;">
        <h1>📋 ${eventConfig.title}</h1>
        <p>${eventConfig.description}</p>
      </div>

      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>

        <div style="background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; padding: 15px; margin: 20px 0;">
          <h3 style="margin: 0 0 5px 0; color: #1e40af;">${data.taskTitle}</h3>
          ${data.taskDescription ? `<p style="margin: 0; color: #3b82f6; font-size: 14px;">${data.taskDescription}</p>` : ''}
        </div>

        ${data.eventType === 'status' && data.previousValue && data.newValue ? `
        <div style="margin: 20px 0;">
          <p><strong>Mudança de Status:</strong></p>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
            <span style="background: #f3f4f6; padding: 8px 12px; border-radius: 4px; text-decoration: line-through; color: #6b7280;">${data.previousValue}</span>
            <span style="color: #9ca3af;">→</span>
            <span style="background: #dbeafe; padding: 8px 12px; border-radius: 4px; color: #1e40af; font-weight: 500;">${data.newValue}</span>
          </div>
        </div>
        ` : ''}

        ${data.eventType === 'assignment' && data.assignedBy ? `
        <p><strong>Atribuído por:</strong> ${data.assignedBy}</p>
        ` : ''}

        ${data.eventType === 'deadline' && data.dueDate ? `
        <div class="alert">
          <strong>⏰ Prazo:</strong> ${data.dueDate}
        </div>
        ` : ''}

        ${data.eventType === 'comment' && data.commentAuthor && data.commentText ? `
        <div style="background: #f9fafb; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-weight: 500;">${data.commentAuthor} comentou:</p>
          <p style="margin: 0; color: #374151; font-style: italic;">"${data.commentText}"</p>
        </div>
        ` : ''}

        ${data.eventType === 'priority' && data.previousValue && data.newValue ? `
        <div style="margin: 20px 0;">
          <p><strong>Mudança de Prioridade:</strong></p>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
            <span style="background: #f3f4f6; padding: 8px 12px; border-radius: 4px; color: #6b7280;">${data.previousValue}</span>
            <span style="color: #9ca3af;">→</span>
            <span style="background: #fef3c7; padding: 8px 12px; border-radius: 4px; color: #92400e; font-weight: 500;">${data.newValue}</span>
          </div>
        </div>
        ` : ''}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.taskUrl}" class="button" style="background: #3b82f6;">Ver Tarefa</a>
        </div>
      </div>

      <div class="footer">
        <p>Esta é uma notificação automática do sistema ${data.companyName}.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail}${data.supportPhone ? ` | 📱 ${data.supportPhone}` : ''}</p>
      </div>
    </body>
    </html>
  `;
}

// =====================
// Order Notification Template
// =====================

interface OrderNotificationTemplateData extends BaseTemplateData {
  eventType: 'created' | 'status' | 'fulfilled' | 'cancelled' | 'overdue';
  orderNumber: string;
  orderDescription?: string;
  customerName?: string;
  previousStatus?: string;
  newStatus?: string;
  dueDate?: string;
  cancellationReason?: string;
  orderUrl: string;
  items?: Array<{ name: string; quantity: number }>;
}

const orderEventLabels: Record<string, { title: string; description: string; color: string }> = {
  created: { title: 'Novo Pedido', description: 'Um novo pedido foi criado', color: '#16802B' },
  status: { title: 'Status Atualizado', description: 'O status do pedido foi alterado', color: '#3b82f6' },
  fulfilled: { title: 'Pedido Finalizado', description: 'O pedido foi concluído com sucesso', color: '#10b981' },
  cancelled: { title: 'Pedido Cancelado', description: 'O pedido foi cancelado', color: '#ef4444' },
  overdue: { title: 'Pedido Atrasado', description: 'O pedido está atrasado', color: '#f59e0b' },
};

export function generateOrderNotificationTemplate(data: OrderNotificationTemplateData): string {
  const eventConfig = orderEventLabels[data.eventType] || orderEventLabels.status;

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${eventConfig.title} - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header" style="background: ${eventConfig.color};">
        <h1>🛒 ${eventConfig.title}</h1>
        <p>${eventConfig.description}</p>
      </div>

      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>

        <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h3 style="margin: 0; color: #333;">Pedido #${data.orderNumber}</h3>
            ${data.customerName ? `<span style="color: #6b7280; font-size: 14px;">Cliente: ${data.customerName}</span>` : ''}
          </div>
          ${data.orderDescription ? `<p style="margin: 0; color: #555;">${data.orderDescription}</p>` : ''}
        </div>

        ${data.eventType === 'status' && data.previousStatus && data.newStatus ? `
        <div style="margin: 20px 0;">
          <p><strong>Mudança de Status:</strong></p>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
            <span style="background: #f3f4f6; padding: 8px 12px; border-radius: 4px; color: #6b7280;">${data.previousStatus}</span>
            <span style="color: #9ca3af;">→</span>
            <span style="background: #dbeafe; padding: 8px 12px; border-radius: 4px; color: #1e40af; font-weight: 500;">${data.newStatus}</span>
          </div>
        </div>
        ` : ''}

        ${data.eventType === 'overdue' && data.dueDate ? `
        <div class="warning">
          <strong>⚠️ Atenção:</strong> Este pedido deveria ter sido entregue em ${data.dueDate}
        </div>
        ` : ''}

        ${data.eventType === 'cancelled' && data.cancellationReason ? `
        <div class="alert">
          <strong>Motivo do cancelamento:</strong> ${data.cancellationReason}
        </div>
        ` : ''}

        ${data.eventType === 'fulfilled' ? `
        <div class="success">
          <strong>✅ Pedido finalizado com sucesso!</strong>
        </div>
        ` : ''}

        ${data.items && data.items.length > 0 ? `
        <div style="margin: 20px 0;">
          <strong>Itens do Pedido:</strong>
          <table style="width: 100%; margin-top: 10px; border-collapse: collapse;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Item</th>
                <th style="padding: 10px; text-align: center; border: 1px solid #e5e7eb; width: 100px;">Qtd</th>
              </tr>
            </thead>
            <tbody>
              ${data.items.map(item => `
                <tr>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${item.name}</td>
                  <td style="padding: 10px; text-align: center; border: 1px solid #e5e7eb;">${item.quantity}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.orderUrl}" class="button" style="background: ${eventConfig.color};">Ver Pedido</a>
        </div>
      </div>

      <div class="footer">
        <p>Esta é uma notificação automática do sistema ${data.companyName}.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail}${data.supportPhone ? ` | 📱 ${data.supportPhone}` : ''}</p>
      </div>
    </body>
    </html>
  `;
}

// =====================
// Stock Notification Template
// =====================

interface StockNotificationTemplateData extends BaseTemplateData {
  eventType: 'low' | 'out' | 'restock';
  itemName: string;
  itemCode?: string;
  currentQuantity: number;
  minimumQuantity?: number;
  suggestedReorderQuantity?: number;
  itemUrl: string;
}

const stockEventLabels: Record<string, { title: string; description: string; color: string; icon: string }> = {
  low: { title: 'Estoque Baixo', description: 'Um item está abaixo do nível mínimo', color: '#f59e0b', icon: '⚠️' },
  out: { title: 'Estoque Esgotado', description: 'Um item está sem estoque', color: '#ef4444', icon: '🚨' },
  restock: { title: 'Reabastecimento Necessário', description: 'É necessário reabastecer o estoque', color: '#3b82f6', icon: '📦' },
};

export function generateStockNotificationTemplate(data: StockNotificationTemplateData): string {
  const eventConfig = stockEventLabels[data.eventType] || stockEventLabels.low;

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${eventConfig.title} - ${data.companyName}</title>
      <style>${baseEmailStyle}</style>
    </head>
    <body>
      <div class="header" style="background: ${eventConfig.color};">
        <h1>${eventConfig.icon} ${eventConfig.title}</h1>
        <p>${eventConfig.description}</p>
      </div>

      <div class="content">
        <h2>Olá${data.userName ? `, ${data.userName}` : ''}!</h2>

        <div style="background: ${data.eventType === 'out' ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${eventConfig.color}; border-radius: 4px; padding: 15px; margin: 20px 0;">
          <h3 style="margin: 0 0 5px 0; color: ${data.eventType === 'out' ? '#991b1b' : '#92400e'};">${data.itemName}</h3>
          ${data.itemCode ? `<p style="margin: 0; color: #6b7280; font-size: 14px;">Código: ${data.itemCode}</p>` : ''}
        </div>

        <div style="margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 500;">Quantidade Atual</td>
              <td style="padding: 12px; background: #fff; border: 1px solid #e5e7eb; text-align: right;">
                <span style="font-size: 18px; font-weight: bold; color: ${data.currentQuantity === 0 ? '#ef4444' : '#f59e0b'};">
                  ${data.currentQuantity}
                </span>
              </td>
            </tr>
            ${data.minimumQuantity !== undefined ? `
            <tr>
              <td style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 500;">Quantidade Mínima</td>
              <td style="padding: 12px; background: #fff; border: 1px solid #e5e7eb; text-align: right;">${data.minimumQuantity}</td>
            </tr>
            ` : ''}
            ${data.suggestedReorderQuantity ? `
            <tr>
              <td style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 500;">Sugestão de Reposição</td>
              <td style="padding: 12px; background: #fff; border: 1px solid #e5e7eb; text-align: right;">
                <span style="color: #16802B; font-weight: 500;">${data.suggestedReorderQuantity} unidades</span>
              </td>
            </tr>
            ` : ''}
          </table>
        </div>

        ${data.eventType === 'out' ? `
        <div class="warning">
          <strong>🚨 Atenção:</strong> Este item está completamente esgotado. Providencie o reabastecimento o mais rápido possível.
        </div>
        ` : ''}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.itemUrl}" class="button" style="background: ${eventConfig.color};">Ver Item</a>
        </div>
      </div>

      <div class="footer">
        <p>Esta é uma notificação automática do sistema ${data.companyName}.</p>
        <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
        <p>📧 ${data.supportEmail}${data.supportPhone ? ` | 📱 ${data.supportPhone}` : ''}</p>
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
