/**
 * @deprecated Import from `./domain-dispatch.js` (#330).
 * Re-exports kept so relative imports during cutover still resolve.
 */
export {
  createDomainWireDispatcher,
  createDomainWireRequestHandler,
  DOMAIN_DISPATCH_REGISTRY,
} from "./domain-dispatch.js";
