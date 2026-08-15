/**
 * Server-only environment access.
 *
 * Fails loudly at the point of use rather than letting an undefined value reach
 * a driver and surface later as an opaque connection or auth error.
 */
export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
		);
	}
	return value;
}
