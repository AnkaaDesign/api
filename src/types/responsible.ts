import {
  Responsible as PrismaResponsible,
  ResponsibleRole,
  Customer,
  Task,
} from '@prisma/client';

export interface Responsible extends PrismaResponsible {
  company?: Customer;
  tasks?: Task[];
}

export type ResponsibleResponse = Responsible;

export interface ResponsibleCreateFormData {
  email?: string | null; // Optional - can be added later
  phone: string;
  name: string;
  password?: string | null; // Optional - only required for system access
  companyId?: string | null; // Optional - responsible can exist without company
  role: ResponsibleRole;
  isActive?: boolean;
}

export interface ResponsibleUpdateFormData {
  email?: string | null;
  phone?: string;
  name?: string;
  role?: ResponsibleRole;
  isActive?: boolean;
  companyId?: string | null;
}

export interface ResponsibleLoginFormData {
  contact: string; // email or phone
  password: string;
}

export interface ResponsibleRegisterFormData extends ResponsibleCreateFormData {
  passwordConfirmation: string;
}

export interface ResponsibleInclude {
  company?:
    | boolean
    | {
        include?: {
          logo?: boolean;
        };
      };
  tasks?:
    | boolean
    | {
        include?: {
          customer?: boolean;
          sector?: boolean;
        };
      };
}

export interface ResponsibleOrderBy {
  name?: 'asc' | 'desc';
  role?: 'asc' | 'desc';
  createdAt?: 'asc' | 'desc';
  email?: 'asc' | 'desc';
}

export interface ResponsibleWhere {
  id?: string;
  email?: string | { contains?: string; mode?: 'insensitive' | 'default' };
  phone?: string | { contains?: string };
  name?: { contains?: string; mode?: 'insensitive' | 'default' };
  companyId?: string;
  role?: ResponsibleRole;
  isActive?: boolean;
  verified?: boolean;
  company?: {
    fantasyName?: { contains?: string; mode?: 'insensitive' | 'default' };
  };
  OR?: ResponsibleWhere[];
  AND?: ResponsibleWhere[];
}
