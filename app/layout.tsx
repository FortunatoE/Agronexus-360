import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgroNexus 360°",
  description: "Planejamento agrícola, execução operacional e gestão de insumos.",
  icons: {
    icon: "/agronexus-favicon.svg",
    shortcut: "/agronexus-favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
