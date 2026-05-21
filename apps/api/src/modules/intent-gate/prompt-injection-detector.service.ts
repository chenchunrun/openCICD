import { Injectable } from '@nestjs/common';
import { detectPromptInjection } from '@aicp/shared';

@Injectable()
export class PromptInjectionDetectorService {
  detect(input: string): { detected: boolean; matchedPatterns: string[] } {
    return detectPromptInjection(input);
  }
}
