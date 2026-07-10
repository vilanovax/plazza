/** Layout breakpoints — keep in sync with `--bp-sm` in tokens.css. */
export const BP_SM = 520;

export const MQ_SM_MAX = `(max-width: ${BP_SM}px)` as const;
export const MQ_LANDSCAPE_SHORT = `(max-height: ${BP_SM}px) and (orientation: landscape)` as const;
