import { useEffect, useRef } from "react";

// A single shared "what should back dismiss right now" slot. Any component
// showing something that owns back's meaning while it's open — an inline
// recipe/step editor swap, Home's open/search overlay — claims the slot for
// as long as it's open and releases it on close/unmount. Only one such thing
// is ever shown at a time in this app's screen model (an editor and an
// overlay never coexist), so a single slot is enough — this would need to
// become a stack if that ever stopped being true.
//
// Deliberately scoped to screen-level things only, matching how far RTW's
// own back guard reaches (its top-level settings/help panels, not every
// inline confirm row) — see build-plan §7 decision 3. A row-level confirm
// like StepEditor's "Delete this step?" is not wired here.
export const backDismissRef = { current: null };

export function useBackDismiss(active, onDismiss) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    backDismissRef.current = () => onDismissRef.current();
    return () => {
      backDismissRef.current = null;
    };
  }, [active]);
}
