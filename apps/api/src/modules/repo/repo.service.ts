import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class RepoService {
  async findAll() {
    return prisma.repository.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    return prisma.repository.findUnique({ where: { id } });
  }

  async findByFullName(fullName: string) {
    return prisma.repository.findUnique({ where: { fullName } });
  }

  async update(id: string, data: {
    defaultBranch?: string;
    localPath?: string | null;
    languages?: string[];
    packageManager?: string | null;
    testCommand?: string | null;
    lintCommand?: string | null;
    typecheckCommand?: string | null;
    buildCommand?: string | null;
    codeownersPath?: string | null;
    highRiskPaths?: string[];
    hasAgentsMd?: boolean;
    hasClaudeMd?: boolean;
    hasAiCicdDir?: boolean;
  }) {
    return prisma.repository.update({
      where: { id },
      data,
    });
  }

  async create(data: {
    platform: string;
    owner: string;
    name: string;
    fullName: string;
    url: string;
    defaultBranch: string;
    localPath?: string;
    languages: string[];
    packageManager?: string;
    testCommand?: string;
    lintCommand?: string;
    typecheckCommand?: string;
    buildCommand?: string;
    codeownersPath?: string;
    highRiskPaths: string[];
    hasAgentsMd?: boolean;
    hasClaudeMd?: boolean;
    hasAiCicdDir?: boolean;
  }) {
    return prisma.repository.create({ data });
  }
}
