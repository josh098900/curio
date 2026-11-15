"use client";

import { plexSans, plexSansCondensed } from "@/shared/theme/fonts";
import "@/shared/theme/tokens.css";
import "@/shared/theme/base.css";
import SomethingWentWrong from "./error";

/** S54 when the root layout itself fails, so it brings its own page, theme and fonts. */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html
      lang="en-GB"
      className={`${plexSans.variable} ${plexSansCondensed.variable}`}
    >
      <body>
        <SomethingWentWrong reset={reset} />
      </body>
    </html>
  );
}
