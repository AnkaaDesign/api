// packages/utils/src/customer.ts

import type { Customer } from '@types';
import { formatCNPJ } from './formatters';

// =====================
// Display Formatters
// =====================

export const formatCustomerDisplay = (customer: Customer): string => {
  return customer.fantasyName;
};

export const formatCustomerFullDisplay = (customer: Customer): string => {
  const parts = [customer.fantasyName];

  if (customer.corporateName && customer.corporateName !== customer.fantasyName) {
    parts.push(`(${customer.corporateName})`);
  }

  if (customer.cnpj) {
    parts.push(`CNPJ: ${formatCNPJ(customer.cnpj)}`);
  }

  return parts.join(' - ');
};

export const formatCustomerContact = (customer: Customer): string => {
  const contacts: string[] = [];

  if (customer.email) {
    contacts.push(`Email: ${customer.email}`);
  }

  if (customer.phones && customer.phones.length > 0) {
    contacts.push(`Tel: ${customer.phones[0]}`);
  }

  return contacts.join(' | ') || 'Sem contato';
};

export const formatCustomerAddress = (customer: Customer): string => {
  const parts: Array<string> = [];

  if (customer.address) parts.push(customer.address);
  if (customer.city) parts.push(customer.city);
  if (customer.state) parts.push(customer.state);

  return parts.join(', ') || 'Endereço não informado';
};

export const getCustomerInitials = (customer: Customer): string => {
  return customer.fantasyName
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
};

export const validateBrazilianState = (state: string): boolean => {
  const validStates = [
    'AC',
    'AL',
    'AP',
    'AM',
    'BA',
    'CE',
    'DF',
    'ES',
    'GO',
    'MA',
    'MT',
    'MS',
    'MG',
    'PA',
    'PB',
    'PR',
    'PE',
    'PI',
    'RJ',
    'RN',
    'RS',
    'RO',
    'RR',
    'SC',
    'SP',
    'SE',
    'TO',
  ];
  return validStates.includes(state.toUpperCase());
};

export const hasRequiredContactInfo = (customer: Customer): boolean => {
  return !!(customer.email || (customer.phones && customer.phones.length > 0));
};

export const hasCompleteAddress = (customer: Customer): boolean => {
  return !!(customer.address && customer.city && customer.state);
};

// =====================
// Export all utilities
// =====================

export const customerUtils = {
  // Display
  formatCustomerDisplay,
  formatCustomerFullDisplay,
  formatCustomerContact,
  formatCustomerAddress,
  getCustomerInitials,

  // Validation
  hasRequiredContactInfo,
  hasCompleteAddress,
};
