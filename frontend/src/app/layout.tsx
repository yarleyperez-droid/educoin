import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Inter,
  Plus_Jakarta_Sans,
} from "next/font/google";
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

/** Titulares del panel admin (mockup M3). */
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

/** Cuerpo y etiquetas del panel admin (mockup M3). */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jakarta.variable} ${inter.variable} antialiased`}
      >
        {/* Proveedor del toast accesible (H5.2 / PRO-283): una sola montura
            para toda la app, de modo que cualquier vista pueda usar useToast. */}
        <ProveedorToast>{children}</ProveedorToast>
      </body>
    </html>
  );
}
