/**
 * src/server/repo/errors.js
 *
 * Shared error types for the repository layer.
 * Route handlers map these to HTTP status codes; the rest of the app
 * never needs to import from here directly.
 */

export class NotFoundError extends Error {
  /**
   * @param {string} message
   * @param {string} [resource] which resource was missing — e.g.
   *   'tree' | 'branch' | 'parent' | 'node'. Lets route handlers map the
   *   error to a status code (tree-not-found -> 404 vs a bad branch/parent
   *   id in the request body -> 400) without matching on message text.
   */
  constructor(message, resource) {
    super(message);
    this.name = "NotFoundError";
    this.resource = resource;
  }
}
