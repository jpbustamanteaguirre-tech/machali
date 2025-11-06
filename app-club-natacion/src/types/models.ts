export type UserRole = 'admin' | 'coach' | 'athlete' | 'guardian';

export type AppUser = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  role: UserRole;
  linkedAthletes?: string[]; // para apoderado
  createdAt?: number;
};
