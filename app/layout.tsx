import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { sr } from "@/lib/i18n/sr";
import "./globals.css";

/**
 * `latin-ext` je obavezan: č, ć, ž, š i đ nisu u osnovnom `latin` opsegu, pa
 * bi bez njega pola srpskog teksta palo na zamenski font.
 *
 * Mono varijante nema namerno — nijedna komponenta ne koristi `font-mono`, a
 * nosila je polovinu težine fontova na javnoj strani. Brojevi se poravnavaju
 * preko `tabular-nums`, što je svojstvo ovog istog fonta.
 */
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: sr.app.name,
  description: sr.app.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sr-Latn-RS">
      <body className={`${geistSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
