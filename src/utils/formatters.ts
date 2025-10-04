// packages/utils/src/formatters.ts

export const formatCPF = (cpf: string): string => {
  const cleaned = cpf.replace(/\D/g, "");

  // Handle partial inputs
  if (cleaned.length <= 3) {
    return cleaned;
  } else if (cleaned.length <= 6) {
    return cleaned.replace(/(\d{3})(\d{1,3})/, "$1.$2");
  } else if (cleaned.length <= 9) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{1,3})/, "$1.$2.$3");
  } else if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, "$1.$2.$3-$4");
  }

  // Limit to 11 digits
  return cleaned.substring(0, 11).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
};

export const formatCNPJ = (cnpj: string): string => {
  const cleaned = cnpj.replace(/\D/g, "");

  // Handle partial inputs
  if (cleaned.length <= 2) {
    return cleaned;
  } else if (cleaned.length <= 5) {
    return cleaned.replace(/(\d{2})(\d{1,3})/, "$1.$2");
  } else if (cleaned.length <= 8) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{1,3})/, "$1.$2.$3");
  } else if (cleaned.length <= 12) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, "$1.$2.$3/$4");
  } else if (cleaned.length <= 14) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, "$1.$2.$3/$4-$5");
  }

  // Limit to 14 digits
  return cleaned.substring(0, 14).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
};

export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 13) {
    // +55 11 91234-5678
    return cleaned.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 $2 $3-$4");
  } else if (cleaned.length === 12) {
    // +55 11 1234-5678
    return cleaned.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, "+$1 $2 $3-$4");
  }
  return phone;
};

export const formatBrazilianPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, "");

  // Remove country code if present
  let phoneNumber = cleaned;
  if (cleaned.startsWith("55") && cleaned.length >= 12) {
    phoneNumber = cleaned.substring(2);
  }

  // Handle partial inputs
  if (phoneNumber.length === 0) {
    return "";
  } else if (phoneNumber.length <= 2) {
    // Just area code: "11"
    return `(${phoneNumber}`;
  } else if (phoneNumber.length <= 6) {
    // Partial number after area code: "(11) 9999"
    const areaCode = phoneNumber.substring(0, 2);
    const firstPart = phoneNumber.substring(2);
    return `(${areaCode}) ${firstPart}`;
  } else if (phoneNumber.length <= 10) {
    // Landline or partial mobile: "(11) 9999-9999" or "(11) 99999-999"
    const areaCode = phoneNumber.substring(0, 2);
    if (phoneNumber.length === 10) {
      // Complete landline
      const firstPart = phoneNumber.substring(2, 6);
      const secondPart = phoneNumber.substring(6);
      return `(${areaCode}) ${firstPart}-${secondPart}`;
    } else {
      // Partial mobile (7-9 digits)
      const firstPart = phoneNumber.substring(2, 7);
      const secondPart = phoneNumber.substring(7);
      if (secondPart) {
        return `(${areaCode}) ${firstPart}-${secondPart}`;
      }
      return `(${areaCode}) ${firstPart}`;
    }
  } else if (phoneNumber.length === 11) {
    // Complete mobile: "(11) 99999-9999"
    const areaCode = phoneNumber.substring(0, 2);
    const firstPart = phoneNumber.substring(2, 7);
    const secondPart = phoneNumber.substring(7);
    return `(${areaCode}) ${firstPart}-${secondPart}`;
  }

  // Limit to 11 digits for Brazilian phones
  const truncated = phoneNumber.substring(0, 11);
  if (truncated.length === 11) {
    const areaCode = truncated.substring(0, 2);
    const firstPart = truncated.substring(2, 7);
    const secondPart = truncated.substring(7);
    return `(${areaCode}) ${firstPart}-${secondPart}`;
  }

  return phone;
};

export const formatBrazilianPhoneWithCountryCode = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, "");

  if (cleaned.startsWith("55") && cleaned.length === 13) {
    // +55 (11) 99999-9999
    return cleaned.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4");
  } else if (cleaned.startsWith("55") && cleaned.length === 12) {
    // +55 (11) 9999-9999
    return cleaned.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, "+$1 ($2) $3-$4");
  }

  return phone;
};

export const formatPIS = (pis: string): string => {
  const cleaned = pis.replace(/\D/g, "");

  // Handle partial inputs
  if (cleaned.length <= 3) {
    return cleaned;
  } else if (cleaned.length <= 8) {
    return cleaned.replace(/(\d{3})(\d{1,5})/, "$1.$2");
  } else if (cleaned.length <= 10) {
    return cleaned.replace(/(\d{3})(\d{5})(\d{1,2})/, "$1.$2.$3");
  } else if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{5})(\d{2})(\d{0,1})/, "$1.$2.$3-$4");
  }

  // Limit to 11 digits
  return cleaned.substring(0, 11).replace(/(\d{3})(\d{5})(\d{2})(\d{1})/, "$1.$2.$3-$4");
};

export const formatCEP = (cep: string): string => {
  const cleaned = cep.replace(/\D/g, "");

  // Handle partial inputs
  if (cleaned.length <= 5) {
    return cleaned;
  } else if (cleaned.length <= 8) {
    const firstPart = cleaned.substring(0, 5);
    const secondPart = cleaned.substring(5);
    return `${firstPart}-${secondPart}`;
  }

  // Limit to 8 digits
  const truncated = cleaned.substring(0, 8);
  return truncated.replace(/(\d{5})(\d{3})/, "$1-$2");
};

export const formatZipCode = (zipCode: string): string => {
  if (!zipCode || typeof zipCode !== "string") {
    return "";
  }
  const cleaned = zipCode.replace(/\D/g, "");
  if (cleaned.length <= 5) {
    return cleaned;
  }
  if (cleaned.length <= 8) {
    return cleaned.replace(/(\d{5})(\d{3})/, "$1-$2");
  }
  return zipCode;
};
