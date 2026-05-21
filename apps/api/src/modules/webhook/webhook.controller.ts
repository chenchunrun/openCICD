import { Controller, Post, Body, Headers } from '@nestjs/common';
import { WebhookDispatcherService } from './webhook-dispatcher.service.js';
import { GithubWebhookService } from './github-webhook.service.js';

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly dispatcher: WebhookDispatcherService,
    private readonly githubWebhook: GithubWebhookService,
  ) {}

  @Post('github')
  async handleGitHub(
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') _signature: string,
    @Body() payload: Record<string, unknown>,
  ) {
    const parsed = this.githubWebhook.parseEvent(event, payload);
    return this.dispatcher.dispatch(parsed);
  }
}
