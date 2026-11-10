import type { Principal } from '../modules/auth/principal';

declare global {
  namespace Express {
    interface Request {
      /** Set by authenticateUser. */
      auth?: { principal: Principal; sessionId: string };
      /** Set by requireAgencyMembership — resolved from the DB, never from client input. */
      agency?: { id: string; role: Principal['roles'][number] };
      /** Set by requireTransporter — the caller's own transporter (tenant isolation). */
      transporter?: { id: string; status: import('@prisma/client').VerificationStatus; role: Principal['roles'][number] };
      /** Set by requireDriver — the caller's own driver record and employer. */
      driver?: { id: string; transporterId: string };
      /** Set by requireCompany — the caller's own company (tenant isolation). */
      company?: { id: string; code: string; status: import('@prisma/client').CompanyStatus; role: Principal['roles'][number] };
    }
  }
}

export {};
