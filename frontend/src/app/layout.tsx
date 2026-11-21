import type { Metadata, Viewport } from "next";
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

/*
 * Iconografía y manifest de la identidad de marca (exports de
 * `brand-identity/educoin/brand/exports/`, servidos desde `public/`).
 */
export const metadata: Metadata = {
  title: "EduCoins",
  description: "Plataforma educativa gamificada",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

/** Color de la barra de navegación del navegador: Índigo Mérito `#4F46E5`. */
export const viewport: Viewport = {
  themeColor: "#4F46E5",
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
