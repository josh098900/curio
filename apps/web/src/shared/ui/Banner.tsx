import {
  IconAlertCircle,
  IconAlertTriangle,
  IconInfoCircle,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import styles from "./Banner.module.css";

type Tone = "info" | "warning" | "error";

const icons = {
  info: IconInfoCircle,
  warning: IconAlertTriangle,
  error: IconAlertCircle,
};

/**
 * An info, warning or error banner. An error banner is an alert, so it's announced as it
 * appears (WEB-UI-09). A banner that appears for any other reason sits inside a live region
 * of its own, as the offline notice does, since a region added with its message isn't
 * reliably read.
 */
export function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: Tone;
  /** In place of the tone's own icon, as S55's wifi-off. */
  icon?: typeof IconAlertCircle;
  /** The first words, in bold, such as "You're offline." */
  title?: string;
  children: ReactNode;
}) {
  const Icon = icon ?? icons[tone];
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`${styles.banner} ${styles[tone]}`}
    >
      <Icon aria-hidden="true" className={styles.icon} />
      <p>
        {title && <strong>{title} </strong>}
        {children}
      </p>
    </div>
  );
}
