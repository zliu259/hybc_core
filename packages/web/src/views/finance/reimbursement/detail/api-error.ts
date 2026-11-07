export type ApiErrorShape = {
  message?: string;
  response?: {
    status?: number;
    data?: {
      message?: string;
      error?: string | { message?: string };
      data?: {
        require_force_submit?: boolean;
        duplicate_count?: number;
        duplicate_total?: number;
        duplicate_checks?: Array<{
          risk_level?: string;
          summary?: string;
        } | null>;
        wait_for_audit?: boolean;
        einvoice_in_physical?: boolean;
        duplicate_risk_unconfirmed?: boolean;
      };
    };
  };
};

export const resolveApiErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  const err = error as ApiErrorShape;
  const rawError = err.response?.data?.error;
  const backendMessage =
    err.response?.data?.message ||
    (typeof rawError === "string" ? rawError : rawError?.message) ||
    err.message;
  return typeof backendMessage === "string" && backendMessage.trim()
    ? backendMessage
    : fallback;
};
