import { Representative as PrismaRepresentative, RepresentativeRole, Customer, Task } from '@prisma/client';

export interface Representative extends PrismaRepresentative {
  customer?: Customer;
  tasks?: Task[];
}

export type RepresentativeResponse = Representative;

export interface RepresentativeCreateFormData {
  email?: string; // Optional - can be added later
  phone: string;
  name: string;
  password?: string; // Optional - only required for system access
  customerId?: string; // Optional - representative can exist without customer
  role: RepresentativeRole;
  isActive?: boolean;
}

export interface RepresentativeUpdateFormData {
  email?: string;
  phone?: string;
  name?: string;
  role?: RepresentativeRole;
  isActive?: boolean;
  customerId?: string;
}

export interface RepresentativeLoginFormData {
  contact: string; // email or phone
  password: string;
}

export interface RepresentativeRegisterFormData extends RepresentativeCreateFormData {
  passwordConfirmation: string;
}

export interface RepresentativeInclude {
  customer?: boolean | {
    include?: {
      logo?: boolean;
    };
  };
  tasks?: boolean | {
    include?: {
      customer?: boolean;
      sector?: boolean;
    };
  };
}

export interface RepresentativeOrderBy {
  name?: 'asc' | 'desc';
  role?: 'asc' | 'desc';
  createdAt?: 'asc' | 'desc';
  email?: 'asc' | 'desc';
}

export interface RepresentativeWhere {
  id?: string;
  email?: string | { contains?: string; mode?: 'insensitive' | 'default' };
  phone?: string | { contains?: string };
  name?: { contains?: string; mode?: 'insensitive' | 'default' };
  customerId?: string;
  role?: RepresentativeRole;
  isActive?: boolean;
  verified?: boolean;
  customer?: {
    fantasyName?: { contains?: string; mode?: 'insensitive' | 'default' };
  };
  OR?: RepresentativeWhere[];
  AND?: RepresentativeWhere[];
}