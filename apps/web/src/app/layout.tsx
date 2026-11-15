import type { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Curio",
  description:
    "Find and join small, in-person activities near you, hosted by other travellers and by hostels.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders on request, so each gets the fresh nonce its CSP names: Next can stamp a
  // nonce only on a page it renders then (src/proxy.ts, WEB-ACT-12).
  await connection();
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
