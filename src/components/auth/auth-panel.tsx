import { SignIn, SignUp } from "@clerk/tanstack-react-start";

/**
 * Clerk's path-based flows navigate to sub-paths such as `/sign-in/factor-one`,
 * so each flow is mounted twice: once at the exact path and once under a splat.
 * Both render this panel.
 */
function AuthFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-svh items-center justify-center p-6">
			{children}
		</div>
	);
}

export function SignInPanel() {
	return (
		<AuthFrame>
			<SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
		</AuthFrame>
	);
}

export function SignUpPanel() {
	return (
		<AuthFrame>
			<SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
		</AuthFrame>
	);
}
