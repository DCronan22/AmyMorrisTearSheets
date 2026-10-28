// An error whose message we wrote ourselves and is safe to show the user.
// Anything else thrown on the server (Node network errors, upstream status
// text, DNS failures, …) must be replaced with a generic message before it
// reaches the client — raw messages leak which hosts/ports exist and whether
// an address was blocked or merely unreachable.
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
