// packages/utils/src/supplier.ts

import type { Supplier } from '@types';
import { formatCNPJ } from "./formatters";

// =====================
// Display Formatters
// =====================

export const formatSupplierDisplay = (supplier: Supplier): string => {
  return supplier.fantasyName;
};

export const formatSupplierFullDisplay = (supplier: Supplier): string => {
  const parts = [supplier.fantasyName];

  if (supplier.corporateName && supplier.corporateName !== supplier.fantasyName) {
    parts.push(`(${supplier.corporateName})`);
  }

  if (supplier.cnpj) {
    parts.push(`CNPJ: ${formatCNPJ(supplier.cnpj)}`);
  }

  return parts.join(" - ");
};

export const formatSupplierContact = (supplier: Supplier): string => {
  const contacts: string[] = [];

  if (supplier.email) {
    contacts.push(`Email: ${supplier.email}`);
  }

  if (supplier.phones && supplier.phones.length > 0) {
    contacts.push(`Tel: ${supplier.phones[0]}`);
  }

  return contacts.join(" | ") || "Sem contato";
};

export const formatSupplierAddress = (supplier: Supplier): string => {
  const parts: Array<string> = [];

  if (supplier.address) parts.push(supplier.address);
  if (supplier.city) parts.push(supplier.city);
  if (supplier.state) parts.push(supplier.state);

  return parts.join(", ") || "Endereço não informado";
};

export const getSupplierInitials = (supplier: Supplier): string => {
  return supplier.fantasyName
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
};
// =====================
// Export all utilities
// =====================

export const supplierUtils = {
  // Display
  formatSupplierDisplay,
  formatSupplierFullDisplay,
  formatSupplierContact,
  formatSupplierAddress,
  getSupplierInitials,
};
