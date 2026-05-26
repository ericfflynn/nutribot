import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NutriBot Macros",
  description: "Quick verbal macro tracker"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
