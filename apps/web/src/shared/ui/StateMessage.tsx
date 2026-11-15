import type { ReactNode } from "react";
import styles from "./StateMessage.module.css";

type Message = {
  /** An outline icon, shown large in a circle. */
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  /** One button or link, such as "Back to Discover". */
  action?: ReactNode;
};

function StateMessage({
  icon,
  title,
  children,
  action,
  alert,
}: Message & { alert?: boolean }) {
  return (
    <section role={alert ? "alert" : undefined} className={styles.message}>
      <span
        className={`${styles.icon} ${alert ? styles.error : styles.tinted}`}
      >
        {icon}
      </span>
      <h1 className={styles.title}>{title}</h1>
      {children && <p className={styles.text}>{children}</p>}
      {action}
    </section>
  );
}

/** What a list or page shows when there's nothing in it, such as "Nothing on near you yet". */
export function EmptyState(message: Message) {
  return <StateMessage {...message} />;
}

/** What a page shows when something failed. It's an alert, so it's announced (WEB-UI-09). */
export function ErrorState(message: Message) {
  return <StateMessage {...message} alert />;
}
