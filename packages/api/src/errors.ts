/**
 * Transport-agnostic error shapes for the Collector service API (#144 sketch, #145 freeze).
 * No throw helpers here — types only.
 */

export type CollectorApiErrorLayer =
  | "transport"
  | "validation"
  | "domain"
  | "auth";

export interface CollectorApiErrorBase {
  layer: CollectorApiErrorLayer;
  /** Stable machine code when known; otherwise omit and use message. */
  code?: string;
  message: string;
}

export interface CollectorApiTransportError extends CollectorApiErrorBase {
  layer: "transport";
  code?:
    | "not_connected"
    | "disconnected"
    | "timeout"
    | "cancelled"
    | "framing"
    | "protocol_mismatch";
}

export interface CollectorApiValidationError extends CollectorApiErrorBase {
  layer: "validation";
  code?: "bad_request" | "unknown_method" | "schema_mismatch" | "unimplemented";
}

export interface CollectorApiDomainError extends CollectorApiErrorBase {
  layer: "domain";
  code?:
    | "not_found"
    | "vault_missing"
    | "db_not_initialized"
    | "index_unhealthy"
    | "conflict"
    | "failed";
}

/** Service host auth handshake failures (#336). */
export interface CollectorApiAuthError extends CollectorApiErrorBase {
  layer: "auth";
  code?: "auth_required" | "auth_failed" | "token_missing";
}

export type CollectorApiError =
  | CollectorApiTransportError
  | CollectorApiValidationError
  | CollectorApiDomainError
  | CollectorApiAuthError;
