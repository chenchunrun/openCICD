export const FORBIDDEN_COMMANDS: readonly string[] = [
  'rm -rf',
  'rm -rf /',
  'chmod 777',
  'curl * | sh',
  'curl * | bash',
  'wget * -O - | sh',
  'kubectl apply',
  'kubectl delete',
  'terraform apply',
  'terraform destroy',
  'docker exec',
  'aws s3 sync',
  'gcloud deployments',
] as const;

export const FORBIDDEN_NETWORK_DOMAINS: readonly string[] = [
  'webhook.site',
  'ngrok.io',
  'pastebin.com',
  'hastebin.com',
] as const;

export const FORBIDDEN_NETWORK_METHODS: readonly string[] = [
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;
