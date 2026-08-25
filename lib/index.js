/**
 * dsh-token-bubbles — host half (intentionally a no-op).
 *
 * The token visualizer is client-only: it reads the live `tokenUsage`
 * session projection that the shipped token-meter already publishes.
 * This entry exists so the composition row activates, which is what
 * dsh-client-modules requires before it serves the package's client
 * bundle at /plugins/dsh-token-bubbles/client.js.
 */
export const name = "token-bubbles";

export function apply() {}
