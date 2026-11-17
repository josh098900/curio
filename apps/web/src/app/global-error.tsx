"use client";

import { plexSans, plexSansCondensed } from "@/shared/theme/fonts";
import "@/shared/theme/tokens.css";
import "@/shared/theme/base.css";
import type { ComponentProps } from "react";
import SomethingWentWrong from "./error";

/** S54 when the root layout itself fails, so it brings its own page, theme and fonts. */
export default function GlobalError(
  props: ComponentProps<typeof SomethingWentWrong>,
) {
  return (
    <html
      lang="en-GB"
      className={`${plexSans.variable} ${plexSansCondensed.variable}`}
    >
      <body>
        <SomethingWentWrong {...props} />
      </body>
    </html>
  );
}
