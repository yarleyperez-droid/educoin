import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ProveedorToast } from "@/components/ui";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EduCoins",
  description: "Plataforma educativa gamificada",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Proveedor del toast accesible (H5.2 / PRO-283): una sola montura
            para toda la app, de modo que cualquier vista pueda usar useToast. */}
        <ProveedorToast>{children}</ProveedorToast>
      </body>
    </html>
  );
}
