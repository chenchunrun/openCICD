import { isRedirectError } from "next/dist/client/components/redirect-error";

export function rethrowIfRedirectError(error: unknown): void {
  if (isRedirectError(error)) {
    throw error;
  }
}
