-- Primeiro acesso ganha um tipo de verificação próprio.
--
-- O RH cadastra o colaborador sem senha (password NULL, verified false); ele
-- mesmo ativa a conta com um código de 6 dígitos e escolhe a senha. Reaproveitar
-- PASSWORD_RESET aqui deixaria um código emitido para uma cerimônia concluir a
-- outra — e só a de primeiro acesso é que marca a conta como verificada.
ALTER TYPE "VerificationType" ADD VALUE IF NOT EXISTS 'FIRST_ACCESS';
