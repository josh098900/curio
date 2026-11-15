"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./Toast.module.css";

export type Toast = {
  message: string;
  /** One action, such as Undo after joining (brief §5.9). */
  action?: { label: string; onClick: () => void };
};

/** How long a toast stays, unless someone is pointing at it or has focus in it. */
export const TOAST_MS = 5000;

const ShowToast = createContext<(toast: Toast) => void>(() => {});

/** Shows a toast: `const showToast = useToast(); showToast({ message: "Joined" })`. */
export function useToast() {
  return useContext(ShowToast);
}

/**
 * The one place toasts appear. Its live region is always on the page, so screen readers announce
 * each toast as it arrives (WEB-UI-09). A toast leaves after TOAST_MS, but waits while the pointer
 * or focus is on it, so its action stays usable for anyone who needs longer (WCAG 2.2.1).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);
  const [held, setHeld] = useState(false);
  const next = useRef(0);

  const show = useCallback(
    (shown: Toast) => setToast({ ...shown, id: ++next.current }),
    [],
  );

  useEffect(() => {
    if (!toast || held) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, held]);

  return (
    <ShowToast.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.region}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        {toast && (
          <div key={toast.id} className={styles.toast}>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ShowToast.Provider>
  );
}
