import type { Metadata } from "next";
import { connection } from "next/server";
import { BrowserErrorReporter } from "@/shared/browser-errors";
import { plexSans, plexSansCondensed } from "@/shared/theme/fonts";
import { ToastProvider } from "@/shared/ui/Toast";
import "@/shared/theme/tokens.css";
import "@/shared/theme/base.css";

export const metadata: Metadata = {
  title: { default: "Curio", template: "%s · Curio" },
  description:
    "Find and join small, in-person activities near you, hosted by other travellers and by hostels.",
};

/**
 * Every page: the theme, the fonts, the skip link, the toasts and the error reporter. Whether a page
 * has the shell is up to its group: (app) has it for someone signed in, (plain) never does.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders on request, so each gets the fresh nonce its CSP names: Next can stamp a
  // nonce only on a page it renders then (src/proxy.ts, WEB-ACT-12).
  await connection();
  return (
    <html
      lang="en-GB"
      className={`${plexSans.variable} ${plexSansCondensed.variable}`}
    >
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
        <BrowserErrorReporter />
      </body>
    </html>
  );
}
