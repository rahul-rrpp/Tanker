import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from './logger';
import { prisma } from './prisma';

/**
 * Realtime events over Socket.IO. The browser's session cookie is first-party to the web origin, so it
 * cannot authenticate a direct socket. Instead an authenticated API call issues a 60-second ticket.
 * Rooms: user:<id>, transporter:<id>, trip:<id>. Trip rooms require an ownership check on every join.
 * With no server attached (tests, scripts) every emit is a no-op.
 */
const AUDIENCE = 'ttms-realtime';
let io: Server | null = null;

export function issueRealtimeTicket(userId: string): string {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, audience: AUDIENCE, expiresIn: 60 });
}

/** Can this user watch this trip? Owning company, owning transporter or the assigned driver only. */
export async function canWatchTrip(userId: string, tripId: string): Promise<boolean> {
  const n = await prisma.trip.count({
    where: {
      id: tripId,
      OR: [
        { booking: { company: { members: { some: { userId, isActive: true } } } } },
        { transporter: { members: { some: { userId, status: 'ACTIVE' } } } },
        { driver: { userId } },
      ],
    },
  });
  return n === 1;
}

export function attachRealtime(server: HttpServer) {
  io = new Server(server, { path: '/realtime', cors: { origin: env.corsOrigins, credentials: true } });
  io.use((socket, next) => {
    try {
      const claims = jwt.verify(String(socket.handshake.auth?.ticket ?? ''), env.JWT_ACCESS_SECRET, { audience: AUDIENCE }) as jwt.JwtPayload;
      socket.data.userId = claims.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', async (socket: Socket) => {
    const userId = String(socket.data.userId);
    await socket.join(`user:${userId}`);
    const member = await prisma.agencyMember.findFirst({ where: { userId, status: 'ACTIVE', role: { not: 'DRIVER' } }, select: { agencyId: true } });
    if (member) await socket.join(`transporter:${member.agencyId}`);
    socket.on('trip:watch', async (tripId: unknown) => {
      if (typeof tripId !== 'string' || !/^[0-9a-f-]{36}$/i.test(tripId)) return;
      if (await canWatchTrip(userId, tripId).catch(() => false)) await socket.join(`trip:${tripId}`);
    });
    socket.on('trip:unwatch', (tripId: unknown) => {
      if (typeof tripId === 'string') void socket.leave(`trip:${tripId}`);
    });
  });
  logger.info('Realtime gateway attached on /realtime');
}

export const emitToUser = (userId: string, event: string, payload: unknown) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToTransporter = (transporterId: string, event: string, payload: unknown) => io?.to(`transporter:${transporterId}`).emit(event, payload);
export const emitToTrip = (tripId: string, event: string, payload: unknown) => io?.to(`trip:${tripId}`).emit(event, payload);
