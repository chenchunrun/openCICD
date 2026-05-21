import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class PolicyService {
  async findAll() {
    return prisma.repoPolicy.findMany({
      where: { active: true },
      orderBy: [{ repoId: 'asc' }, { priority: 'desc' }],
    });
  }

  async create(data: {
    repoId: string;
    layer: string;
    path?: string;
    priority: number;
    policy: Record<string, unknown>;
    sourceFile?: string;
  }) {
    return prisma.repoPolicy.create({ data: data as any });
  }

  async findByRepo(repoId: string) {
    return prisma.repoPolicy.findMany({
      where: { repoId, active: true },
      orderBy: { priority: 'desc' },
    });
  }

  async findByLayer(repoId: string, layer: string) {
    return prisma.repoPolicy.findMany({
      where: { repoId, layer, active: true },
      orderBy: { priority: 'desc' },
    });
  }

  async deactivate(id: string) {
    return prisma.repoPolicy.update({
      where: { id },
      data: { active: false },
    });
  }
}
