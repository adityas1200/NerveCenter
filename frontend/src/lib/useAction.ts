import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQueryClient, type QueryKey, type UseMutationOptions } from "@tanstack/react-query";
import { useToast } from "@/components/ui";

/** A toast: just a title, or `[title, detail]`. */
export type ActionToast = string | readonly [title: string, detail?: string];

interface ActionOptions<TData, TVariables, TContext>
  extends Omit<UseMutationOptions<TData, Error, TVariables, TContext>, "onSuccess" | "onError"> {
  /** Query keys to invalidate once the call succeeds. They are started together and awaited before the toast. */
  invalidate?: readonly QueryKey[] | ((data: TData, variables: TVariables) => readonly QueryKey[]);
  /** Success toast. */
  success?: ActionToast | ((data: TData, variables: TVariables) => ActionToast | null | undefined);
  /** Title of the error toast; its detail is the error's message. */
  error?: string;
  /** What the error toast says when the thrown value is not an Error (default "Try again."). */
  errorDetail?: string | ((error: unknown) => string);
  /** Runs after the invalidation (and the toast); for closing a dialog, navigating, resetting state. */
  onSuccess?: (data: TData, variables: TVariables) => unknown;
}

/**
 * `useMutation` with the app's usual outcome handling: invalidate, then toast, then run `onSuccess`;
 * on failure a toast with the error's message. Anything bespoke (optimistic updates, work before the
 * invalidation, custom error handling) stays a plain `useMutation`.
 */
export function useAction<TData = unknown, TVariables = void, TContext = unknown>(options: ActionOptions<TData, TVariables, TContext>) {
  const { invalidate, success, error, errorDetail = "Try again.", onSuccess, ...rest } = options;
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation<TData, Error, TVariables, TContext>({
    ...rest,
    onSuccess: (data, variables) => {
      const finish = () => {
        const message = typeof success === "function" ? success(data, variables) : success;
        if (message) { const [title, detail] = typeof message === "string" ? [message] : message; toast.success(title, detail); }
        return onSuccess?.(data, variables);
      };
      const keys = typeof invalidate === "function" ? invalidate(data, variables) : invalidate;
      return keys?.length ? Promise.all(keys.map((queryKey) => refreshAfterWrite(queryClient, { queryKey }))).then(finish) : finish();
    },
    onError: error === undefined ? undefined : (thrown) => toast.error(error, thrown instanceof Error ? thrown.message : typeof errorDetail === "function" ? errorDetail(thrown) : errorDetail),
  });
}
