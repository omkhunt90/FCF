/**
 * Seed: creates default admin user + competition structure.
 * Run: npm run prisma:seed
 * Change admin password immediately after first login.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Admin user
  const adminExists = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!adminExists) {
    const passwordHash = await bcrypt.hash('admin123', 12);
    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        role: 'ADMIN',
      },
    });
    console.log('✅ Admin user created (username: admin, password: admin123)');
    console.log('⚠️  Change the admin password immediately!');
  } else {
    console.log('ℹ️  Admin user already exists');
  }

  // Default competition
  const competitionExists = await prisma.competition.findFirst();
  if (!competitionExists) {
    const competition = await prisma.competition.create({
      data: {
        name: 'SciClone Engineer\'s Day — Fastest Coder First',
        rounds: {
          create: [
            {
              name: 'Round 1',
              roundNumber: 1,
              durationMs: 30 * 60 * 1000,
              activities: {
                create: [
                  {
                    name: 'Dumb Charades',
                    type: 'DUMB_CHARADES',
                    durationMs: 15 * 60 * 1000,
                    config: { questionCount: 5, pointsPerQuestion: 10 },
                    tasks: {
                      create: [
                        {
                          title: 'Question 1',
                          description: 'Watch the clue carefully. Write a C program that prints your answer.',
                          correctAnswer: 'example answer one',
                          sampleOutput: null,
                          points: 10,
                          orderIndex: 0,
                          timeoutMs: 3000,
                        },
                        {
                          title: 'Question 2',
                          description: 'Watch the clue carefully. Write a C program that prints your answer.',
                          correctAnswer: 'example answer two',
                          points: 10,
                          orderIndex: 1,
                          timeoutMs: 3000,
                        },
                        {
                          title: 'Question 3',
                          description: 'Watch the clue carefully. Write a C program that prints your answer.',
                          correctAnswer: 'example answer three',
                          points: 10,
                          orderIndex: 2,
                          timeoutMs: 3000,
                        },
                        {
                          title: 'Question 4',
                          description: 'Watch the clue carefully. Write a C program that prints your answer.',
                          correctAnswer: 'example answer four',
                          points: 10,
                          orderIndex: 3,
                          timeoutMs: 3000,
                        },
                        {
                          title: 'Question 5',
                          description: 'Watch the clue carefully. Write a C program that prints your answer.',
                          correctAnswer: 'example answer five',
                          points: 10,
                          orderIndex: 4,
                          timeoutMs: 3000,
                        },
                      ],
                    },
                  },
                  {
                    name: 'Blind Coding',
                    type: 'BLIND_CODING',
                    config: { timeLimit: 900000 },
                  },
                ],
              },
            },
            {
              name: 'Round 2',
              roundNumber: 2,
              durationMs: 20 * 60 * 1000, // 20 minutes, admin-controlled
              activities: {
                create: [
                  {
                    name: 'Code Debugging',
                    type: 'CODE_DEBUGGING',
                    durationMs: 20 * 60 * 1000,
                    config: {
                      note: 'Admin must configure buggy code, correct code, and 10 error definitions via Task Management',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });
    console.log('✅ Competition created:', competition.name);
    console.log('✅ Round 1 (30 min) with Dumb Charades (5 questions) created');
    console.log('✅ Round 2 (15 min) architecture seeded');
  } else {
    console.log('ℹ️  Competition already exists');
  }

  console.log('Seed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
