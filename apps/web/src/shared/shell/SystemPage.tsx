import type { ReactNode } from "react";
import styles from "./SystemPage.module.css";
import { Wordmark } from "./Wordmark";

/**
 * The layout S53, S54 and S56 share: the wordmark, a message in the middle of the screen, and
 * links at the foot. Inside the app shell on desktop, the top bar already shows the wordmark.
 */
export function SystemPage({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Wordmark />
      </div>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}
