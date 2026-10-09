import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "OE Plan Creator",
  description: "Local visualizer / editor / runner for LotusFlare OE plans",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("dark", sans.variable, mono.variable)}>
      <body className="h-full overflow-hidden font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
