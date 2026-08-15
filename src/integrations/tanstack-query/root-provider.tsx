import { QueryClient } from "@tanstack/react-query";

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				retry: 1,
				// The DTR grid autosaves per row. Refetching because the user
				// alt-tabbed away would clobber cells they are still editing.
				refetchOnWindowFocus: false,
			},
		},
	});

	return { queryClient };
}
