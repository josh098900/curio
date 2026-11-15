import Link from "next/link";
import styles from "./Wordmark.module.css";

/** The placeholder logo: "curio" in Plex Sans 600, in the theme's text colour (brief §3). */
export function Wordmark() {
  return (
    <Link href="/" className={styles.wordmark}>
      curio
    </Link>
  );
}
