import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-Native CI/CD Control Plane",
  description: "Dashboard for managing AI-powered CI/CD pipelines",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
