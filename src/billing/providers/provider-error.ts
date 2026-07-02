import { BadRequestException, Logger } from '@nestjs/common';
import axios from 'axios';
import { safeErrorMessage } from '../../common/safe-metadata';

type ProviderErrorContext = {
  provider: string;
  endpoint: string;
  userId?: string | null;
  workspaceId?: string | null;
};

function providerMessage(data: unknown, fallback: unknown) {
  const payload = data && typeof data === 'object' ? (data as Record<string, any>) : {};
  return safeErrorMessage(
    payload.message ||
      payload.error ||
      payload.error_description ||
      payload.errors?.[0]?.message ||
      fallback ||
      'Provider request failed',
  );
}

function providerReference(data: unknown) {
  const payload = data && typeof data === 'object' ? (data as Record<string, any>) : {};
  const reference = payload.reference || payload.data?.reference || payload.id || payload.request_id || null;
  return reference == null ? null : safeErrorMessage(reference);
}

export function logAndThrowProviderError(logger: Logger, error: unknown, context: ProviderErrorContext): never {
  const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
  const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
  const message = providerMessage(responseData, error instanceof Error ? error.message : error);
  const reference = providerReference(responseData);

  logger.warn({
    message: 'Billing provider request failed',
    provider: context.provider,
    endpoint: context.endpoint,
    statusCode: statusCode ?? null,
    providerMessage: message,
    reference,
    workspaceId: context.workspaceId ?? null,
    userId: context.userId ?? null,
  });

  throw new BadRequestException({
    success: false,
    message: `${context.provider} checkout could not be initialized. Please try again.`,
    provider: context.provider,
    statusCode: statusCode ?? null,
    providerMessage: message,
    reference,
  });
}
