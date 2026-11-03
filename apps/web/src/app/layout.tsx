import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Curio",
  description:
    "Find and join small, in-person activities near you, hosted by other travellers and by hostels.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
