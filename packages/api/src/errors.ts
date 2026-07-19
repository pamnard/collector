/**
 * Transport-agnostic error shapes for the Collector service API (#144 sketch, #145 freeze).
 * No throw helpers here — types only.
 */

export type CollectorApiErrorLayer = "transport" | "validation" | "domain";

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

export type CollectorApiError =
  | CollectorApiTransportError
  | CollectorApiValidationError
  | CollectorApiDomainError;
