"use client";

import * as React from "react";

/**
 * Closes a dialog the instant a useActionState result flips to `success`.
 * Written as the React-docs "adjust state while rendering" recipe (compare
 * against the previous render's value, setState immediately if it changed)
 * rather than a useEffect — an effect here would only run after paint for
 * no benefit, which is exactly what the react-hooks/set-state-in-effect
 * lint rule flags. Shared by every dialog that follows this same
 * save-then-close pattern.
 */
export function useCloseOnSuccess(
  state: { success?: boolean },
  setOpen: (open: boolean) => void,
): void {
  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) setOpen(false);
  }
}
