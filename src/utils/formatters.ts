// packages/utils/src/formatters.ts

export const formatCPF = (cpf: string): string => {
  const cleaned = cpf.replace(/\D/g, '');

  // Handle partial inputs
  if (cleaned.length <= 3) {
    return cleaned;
  } else if (cleaned.length <= 6) {
    return cleaned.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  } else if (cleaned.length <= 9) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  } else if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  }

  // Limit to 11 digits
  return cleaned.substring(0, 11).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

export const formatCNPJ = (cnpj: string): string => {
  const cleaned = cnpj.replace(/\D/g, '');

  // Handle partial inputs
  if (cleaned.length <= 2) {
    return cleaned;
  } else if (cleaned.length <= 5) {
    return cleaned.replace(/(\d{2})(\d{1,3})/, '$1.$2');
  } else if (cleaned.length <= 8) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{1,3})/, '$1.$2.$3');
  } else if (cleaned.length <= 12) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4');
  } else if (cleaned.length <= 14) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5');
  }

  // Limit to 14 digits
  return cleaned.substring(0, 14).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
};

export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 13) {
    // +55 11 91234-5678
    return cleaned.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 $2 $3-$4');
  } else if (cleaned.length === 12) {
    // +55 11 1234-5678
    return cleaned.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, '+$1 $2 $3-$4');
  }
  return phone;
};

export const formatBrazilianPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');

  // Remove country code if present
  let phoneNumber = cleaned;
  if (cleaned.startsWith('55') && cleaned.length >= 12) {
    phoneNumber = cleaned.substring(2);
  }

  // Handle partial inputs
  if (phoneNumber.length === 0) {
    return '';
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
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('55') && cleaned.length === 13) {
    // +55 (11) 99999-9999
    return cleaned.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 ($2) $3-$4');
  } else if (cleaned.startsWith('55') && cleaned.length === 12) {
    // +55 (11) 9999-9999
    return cleaned.replace(/(\d{2})(\d{2})(\d{4})(\d{4})/, '+$1 ($2) $3-$4');
  }

  return phone;
};

export const formatPIS = (pis: string): string => {
  const cleaned = pis.replace(/\D/g, '');

  // Handle partial inputs
  if (cleaned.length <= 3) {
    return cleaned;
  } else if (cleaned.length <= 8) {
    return cleaned.replace(/(\d{3})(\d{1,5})/, '$1.$2');
  } else if (cleaned.length <= 10) {
    return cleaned.replace(/(\d{3})(\d{5})(\d{1,2})/, '$1.$2.$3');
  } else if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{5})(\d{2})(\d{0,1})/, '$1.$2.$3-$4');
  }

  // Limit to 11 digits
  return cleaned.substring(0, 11).replace(/(\d{3})(\d{5})(\d{2})(\d{1})/, '$1.$2.$3-$4');
};

export const formatCEP = (cep: string): string => {
  const cleaned = cep.replace(/\D/g, '');

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
  return truncated.replace(/(\d{5})(\d{3})/, '$1-$2');
};

export const formatZipCode = (zipCode: string): string => {
  if (!zipCode || typeof zipCode !== 'string') {
    return '';
  }
  const cleaned = zipCode.replace(/\D/g, '');
  if (cleaned.length <= 5) {
    return cleaned;
  }
  if (cleaned.length <= 8) {
    return cleaned.replace(/(\d{5})(\d{3})/, '$1-$2');
  }
  return zipCode;
};

/**
 * Normalizes a Brazilian phone number to a consistent format for database storage/lookup.
 * Handles various input formats and normalizes to 11 digits (DDD + 9-digit mobile).
 *
 * @param phone - Phone number in any format (with or without country code, DDD, etc.)
 * @param defaultDDD - Default DDD to use if not provided (defaults to '43')
 * @param defaultCountryCode - Default country code (defaults to '55')
 * @returns Normalized phone number as 11 digits (e.g., '43991402403') or empty string if invalid
 *
 * @example
 * normalizeBrazilianPhone('43991402403')     // '43991402403'
 * normalizeBrazilianPhone('5543991402403')   // '43991402403'
 * normalizeBrazilianPhone('991402403')       // '43991402403' (adds default DDD 43)
 * normalizeBrazilianPhone('4391402403')      // '43991402403' (adds missing 9)
 * normalizeBrazilianPhone('(43) 99140-2403') // '43991402403'
 * normalizeBrazilianPhone('+55 43 99140-2403') // '43991402403'
 */
export const normalizeBrazilianPhone = (
  phone: string,
  defaultDDD: string = '43',
  defaultCountryCode: string = '55',
): string => {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');

  if (digits.length === 0) {
    return '';
  }

  // Remove country code if present (55)
  if (digits.startsWith(defaultCountryCode) && digits.length >= 12) {
    digits = digits.substring(2);
  }

  // Now we should have 9, 10, or 11 digits
  // 9 digits = number only (missing DDD)
  // 10 digits = DDD + 8-digit landline OR DDD + 8-digit mobile missing the leading 9
  // 11 digits = DDD + 9-digit mobile (correct format)

  if (digits.length === 9) {
    // Just the number without DDD, add default DDD
    // Check if it already starts with 9 (mobile)
    if (digits.startsWith('9')) {
      digits = defaultDDD + digits;
    } else {
      // Might be missing the 9 prefix, add DDD and 9
      digits = defaultDDD + '9' + digits;
    }
  } else if (digits.length === 10) {
    // Could be DDD + 8-digit number (missing the 9 for mobile)
    // Or could be a landline (DDD + 8 digits starting with 2-5)
    const possibleDDD = digits.substring(0, 2);
    const possibleDDDNum = parseInt(possibleDDD, 10);
    const thirdDigit = digits.charAt(2);

    // Valid Brazilian DDDs are 11-99
    if (possibleDDDNum >= 11 && possibleDDDNum <= 99) {
      // Check if it's a landline (3rd digit is 2-5)
      if (/^[2-5]$/.test(thirdDigit)) {
        // It's a landline, return as-is (10 digits)
        return digits;
      } else {
        // It's a mobile missing the 9, add it
        digits = possibleDDD + '9' + digits.substring(2);
      }
    } else {
      // First 2 digits don't look like a valid DDD
      // Assume it's a 10-digit number without DDD, starting with the area code pattern
      // This is unlikely but handle it by adding default DDD
      digits = defaultDDD + digits;
    }
  } else if (digits.length === 8) {
    // Just 8 digits - needs DDD and possibly the 9
    // If it starts with 9, it's probably already a mobile just missing DDD
    if (digits.startsWith('9')) {
      digits = defaultDDD + digits;
    } else {
      // Add DDD and the 9 prefix for mobile
      digits = defaultDDD + '9' + digits;
    }
  } else if (digits.length === 11) {
    // Already in correct format (DDD + 9-digit mobile)
    return digits;
  } else if (digits.length > 11) {
    // Too many digits, might have extra leading zeros or errors
    // Try to extract the last 11 digits
    digits = digits.substring(digits.length - 11);
  } else if (digits.length < 8) {
    // Too few digits to be a valid phone
    return '';
  }

  // Final validation - should be 10 or 11 digits now
  if (digits.length !== 10 && digits.length !== 11) {
    return '';
  }

  return digits;
};

/**
 * Generates all possible phone number formats for database lookup.
 * This is useful when searching for a user by phone as we don't know how it was stored.
 *
 * @param phone - Phone number in any format
 * @param defaultDDD - Default DDD to use if not provided (defaults to '43')
 * @returns Array of possible phone formats to search for
 */
export const getPhoneLookupVariants = (phone: string, defaultDDD: string = '43'): string[] => {
  if (!phone || typeof phone !== 'string') {
    return [];
  }

  const variants: Set<string> = new Set();
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 0) {
    return [];
  }

  // Add original input
  variants.add(phone);
  variants.add(digits);

  // Normalize and add
  const normalized = normalizeBrazilianPhone(phone, defaultDDD);
  if (normalized) {
    variants.add(normalized);

    // Add with country code
    variants.add('55' + normalized);

    // Add formatted versions
    if (normalized.length === 11) {
      // (43) 99140-2403
      variants.add(
        `(${normalized.substring(0, 2)}) ${normalized.substring(2, 7)}-${normalized.substring(7)}`,
      );
      // +55 43 99140-2403
      variants.add(
        `+55 ${normalized.substring(0, 2)} ${normalized.substring(2, 7)}-${normalized.substring(7)}`,
      );
    }
  }

  // Handle case where country code might be present
  if (digits.startsWith('55') && digits.length >= 12) {
    const withoutCountry = digits.substring(2);
    variants.add(withoutCountry);

    // Normalize without country code
    const normalizedWithoutCountry = normalizeBrazilianPhone(withoutCountry, defaultDDD);
    if (normalizedWithoutCountry) {
      variants.add(normalizedWithoutCountry);
    }
  }

  // Handle 10-digit inputs (might be missing the 9)
  if (digits.length === 10) {
    // Try with 9 inserted after DDD
    const with9 = digits.substring(0, 2) + '9' + digits.substring(2);
    variants.add(with9);
    variants.add('55' + with9);
  }

  // Handle 9-digit inputs (might be missing DDD)
  if (digits.length === 9) {
    variants.add(defaultDDD + digits);
    variants.add('55' + defaultDDD + digits);

    // If it doesn't start with 9, try adding it
    if (!digits.startsWith('9')) {
      variants.add(defaultDDD + '9' + digits);
      variants.add('55' + defaultDDD + '9' + digits);
    }
  }

  // Handle 8-digit inputs
  if (digits.length === 8) {
    // Add DDD
    variants.add(defaultDDD + digits);
    variants.add('55' + defaultDDD + digits);
    // Add DDD + 9
    variants.add(defaultDDD + '9' + digits);
    variants.add('55' + defaultDDD + '9' + digits);
  }

  return Array.from(variants).filter(v => v.length > 0);
};

/**
 * Formats a phone number to E.164 format for Twilio/SMS sending.
 *
 * @param phone - Phone number in any format
 * @param defaultDDD - Default DDD to use if not provided (defaults to '43')
 * @returns Phone in E.164 format (e.g., '+5543991402403')
 */
export const formatPhoneForSms = (phone: string, defaultDDD: string = '43'): string => {
  const normalized = normalizeBrazilianPhone(phone, defaultDDD);
  if (!normalized) {
    return '';
  }
  return `+55${normalized}`;
};

/**
 * Portuguese prepositions and articles that should remain lowercase in Title Case
 * These are common connecting words in Brazilian Portuguese
 */
const PORTUGUESE_LOWERCASE_WORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos', // of, from
  'e', // and
  'em',
  'na',
  'no',
  'nas',
  'nos', // in, on, at
  'para',
  'pra', // for, to
  'por',
  'pela',
  'pelo', // by, through
  'com', // with
  'sem', // without
  'a',
  'o',
  'as',
  'os', // the (articles)
  'um',
  'uma',
  'uns',
  'umas', // a/an (articles)
  'ao',
  'aos',
  'à',
  'às', // contractions
]);

/**
 * Brazilian company suffixes that should remain uppercase
 */
const COMPANY_SUFFIXES = new Set([
  'ltda',
  'ltda.', // Limitada
  'eireli', // Empresa Individual de Responsabilidade Limitada
  's/a',
  's.a.',
  's.a', // Sociedade Anônima
  'cia',
  'cia.', // Companhia
  'mei', // Microempreendedor Individual
  'ss', // Sociedade Simples
]);

/**
 * Convert a string to Title Case (capitalize first letter of each word)
 * Keeps Portuguese prepositions and articles lowercase (except at the start)
 * Words with 2-3 characters become entirely uppercase (except prepositions)
 * Company suffixes (LTDA, EIRELI, S/A, etc.) remain uppercase
 * Example: "pintura de cabine" -> "Pintura de Cabine"
 * Example: "TROCA DA LONA DO CAMINHAO" -> "Troca da Lona do Caminhão"
 * Example: "AZUL FIRENZE" -> "Azul Firenze"
 * Example: "Tp Transportes" -> "TP Transportes"
 * Example: "Tmr Transportes" -> "TMR Transportes"
 * Example: "TRF Logistic" -> "TRF Logistic"
 * Example: "empresa abc ltda" -> "Empresa Abc LTDA"
 * Example: "comercio eireli" -> "Comercio EIRELI"
 */
export const toTitleCase = (str: string): string => {
  if (!str) return '';
  return str
    .split(' ')
    .map((word, index) => {
      if (word.length === 0) return word;

      const lowerWord = word.toLowerCase();

      // Keep Portuguese prepositions/articles lowercase (except first word)
      if (index > 0 && PORTUGUESE_LOWERCASE_WORDS.has(lowerWord)) {
        return lowerWord;
      }

      // Keep company suffixes uppercase
      if (COMPANY_SUFFIXES.has(lowerWord)) {
        return word.toUpperCase();
      }

      // Words with 2-3 characters become entirely uppercase (likely acronyms/abbreviations)
      if (word.length >= 2 && word.length <= 3) {
        return word.toUpperCase();
      }

      // Capitalize first letter, lowercase the rest
      return lowerWord.charAt(0).toUpperCase() + lowerWord.slice(1);
    })
    .join(' ');
};
