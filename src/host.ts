/**
 * Host half of the im-connector bundle.
 *
 * The bundle's value on the host side is the MCP connection inserted by the
 * bundle patch; this row exists so the package is a Loader entry, which is what
 * lets the client module system pick up the `dsh.client` declaration and serve
 * the browser toolview below. It intentionally does nothing at runtime.
 */

export const name = "im-connector-host";

/** Inert host plugin: the client half carries the UI. */
export function apply(): void {
  /* no host-side behavior */
}
