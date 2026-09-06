export type ErrorCode =
  | 'invalid_request' | 'permission_denied' | 'approval_required'
  | 'ambiguous_target' | 'conflict' | 'unsupported_operation'
  | 'timeout' | 'outcome_unknown' | 'service_unavailable' | 'protocol_error';

export class ConnectorError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export function publicError(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof ConnectorError) return { code: error.code, message: error.message };
  // Native errors can contain titles, bodies and script input. Never reflect them.
  return { code: 'service_unavailable', message: 'Operation failed; inspect local diagnostics.' };
}
