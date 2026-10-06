import 'dotenv/config';
import { writeFileSync } from 'fs';
import { prisma } from './lib/database';
(async () => {
  const snap = {
    appointments: (await prisma.appointment.findMany({ select: { id: true } })).map((r) => r.id),
    conversations: (await prisma.conversation.findMany({ select: { id: true } })).map((r) => r.id),
  };
  writeFileSync(process.argv[2], JSON.stringify(snap));
  console.log('appointments', snap.appointments.length, 'conversations', snap.conversations.length);
  console.log(JSON.stringify(await prisma.appointment.findMany({ where: { date: { in: ['2026-10-06', '2026-10-07'] } }, select: { date: true, time: true, status: true } })));
  await prisma.$disconnect();
})();
