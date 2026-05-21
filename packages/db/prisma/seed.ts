import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const repo = await prisma.repository.upsert({
    where: { fullName: 'example/test-repo' },
    update: {},
    create: {
      platform: 'github',
      owner: 'example',
      name: 'test-repo',
      fullName: 'example/test-repo',
      url: 'https://github.com/example/test-repo',
      defaultBranch: 'main',
      languages: ['typescript'],
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
      lintCommand: 'pnpm lint',
      typecheckCommand: 'pnpm typecheck',
      buildCommand: 'pnpm build',
      highRiskPaths: ['auth/**', '.github/workflows/**'],
    },
  });

  console.log(`Seeded repository: ${repo.fullName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
