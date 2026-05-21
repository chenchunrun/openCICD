import { Controller, Get, Param, Post } from '@nestjs/common';
import { ReviewService } from './review.service.js';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get('run/:runId')
  async getRunReviews(@Param('runId') runId: string) {
    return this.reviewService.getReviewsForRun(runId);
  }

  @Get('run/:runId/draft')
  async getRunReviewDraft(@Param('runId') runId: string) {
    return this.reviewService.getPullRequestDraft(runId);
  }

  @Get('run/:runId/github/pull-request')
  async getGithubPullRequestPayload(@Param('runId') runId: string) {
    return this.reviewService.getGithubPullRequestPayload(runId);
  }

  @Get('run/:runId/github/review')
  async getGithubReviewPayload(@Param('runId') runId: string) {
    return this.reviewService.getGithubReviewPayload(runId);
  }

  @Post('run/:runId/github/pull-request')
  async createGithubPullRequest(@Param('runId') runId: string) {
    return this.reviewService.createGithubPullRequest(runId);
  }

  @Post('run/:runId/github/review')
  async submitGithubReview(@Param('runId') runId: string) {
    return this.reviewService.submitGithubReview(runId);
  }
}
