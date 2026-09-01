import type { MunicipalEmitNfseInput } from './elotech-oxy-nfse.service';

/**
 * Customer → NFS-e tomador mapping, shared by every emission path.
 *
 * Contact data (telefone/e-mail) is NOT reliably on the Customer row: in practice it is
 * filled on the company's responsáveis (Representative), and the Customer row is left with
 * `email: null` / `phones: []`. Emitting straight off the Customer row therefore printed
 * blank "Fone/Fax" and "E-Mail" on the DANFSe even when the contact was in the system.
 * The tomador falls back to the responsáveis, financeiro first.
 */

/** Prisma select for every customer field the tomador needs, contacts included. */
export const NFSE_CUSTOMER_SELECT = {
  id: true,
  fantasyName: true,
  corporateName: true,
  cnpj: true,
  cpf: true,
  email: true,
  phones: true,
  municipalRegistration: true,
  stateRegistration: true,
  address: true,
  city: true,
  state: true,
  zipCode: true,
  neighborhood: true,
  addressNumber: true,
  addressComplement: true,
  responsibles: {
    where: { isActive: true },
    select: { email: true, phone: true, roles: true },
  },
} as const;

/**
 * Whose contact represents the company on a fiscal document, best first. A responsável
 * carrying none of these roles still counts — it just sorts last.
 */
const CONTACT_ROLE_PRIORITY = ['FINANCIAL', 'COMMERCIAL', 'REPRESENTATIVE', 'PURCHASING'];

interface ResponsibleContact {
  email: string | null;
  phone: string | null;
  roles: string[];
}

export interface NfseCustomerSource {
  fantasyName: string | null;
  corporateName: string | null;
  cnpj: string | null;
  cpf: string | null;
  email: string | null;
  phones: string[];
  municipalRegistration?: string | null;
  stateRegistration?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  neighborhood: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  responsibles?: ResponsibleContact[];
}

function rolePriority(roles: string[] | null | undefined): number {
  let best = CONTACT_ROLE_PRIORITY.length;
  for (const role of roles ?? []) {
    const index = CONTACT_ROLE_PRIORITY.indexOf(role);
    if (index >= 0 && index < best) best = index;
  }
  return best;
}

/**
 * Digits only, minus the +55 country code some records carry. Elotech stores the tomador
 * phone as a bare DDD+number string and the DANFSe formats it — a leading 55 would print
 * as a bogus area code.
 */
function normalizePhone(raw: string | null | undefined): string | undefined {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  const local = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
  return local.length >= 10 ? local : undefined;
}

/**
 * Build the tomador block of an emission input from a Customer loaded with
 * {@link NFSE_CUSTOMER_SELECT}.
 */
export function buildNfseCustomer(
  customer: NfseCustomerSource,
  /**
   * The responsável picked for THIS billing (TaskQuoteCustomerConfig.responsible), when there
   * is one. It outranks the role ordering below — somebody chose that person for this note.
   */
  preferredContact?: ResponsibleContact | null,
): MunicipalEmitNfseInput['customer'] {
  const contacts = [...(customer.responsibles ?? [])].sort(
    (a, b) => rolePriority(a.roles) - rolePriority(b.roles),
  );
  if (preferredContact) contacts.unshift(preferredContact);

  const email =
    customer.email?.trim() || contacts.find(c => c.email?.trim())?.email?.trim() || undefined;

  const phone =
    customer.phones?.map(normalizePhone).find(Boolean) ||
    contacts.map(c => normalizePhone(c.phone)).find(Boolean) ||
    undefined;

  return {
    cnpj: customer.cnpj || undefined,
    cpf: customer.cpf || undefined,
    name: customer.fantasyName || '',
    corporateName: customer.corporateName || undefined,
    email,
    phone,
    municipalRegistration: customer.municipalRegistration || undefined,
    stateRegistration: customer.stateRegistration || undefined,
    address: customer.address
      ? {
          cityName: customer.city || undefined,
          state: customer.state || undefined,
          zipCode: customer.zipCode || '',
          street: customer.address,
          number: customer.addressNumber || 'S/N',
          complement: customer.addressComplement || undefined,
          neighborhood: customer.neighborhood || '',
        }
      : undefined,
  };
}
