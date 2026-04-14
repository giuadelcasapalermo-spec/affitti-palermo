import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import RegisterSW from "@/components/RegisterSW";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GiuAdel casa Palermo",
  description: "GiuAdel casa Palermo - 5 camere",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GiuAdel",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className={`${geist.className} bg-gray-50 min-h-screen`}>
        <RegisterSW />
        <Navbar />
        <main className="max-w-5xl mx-auto px-4 py-6 pb-24 md:pb-6">{children}</main>
      </body>
    </html>
  );
}
