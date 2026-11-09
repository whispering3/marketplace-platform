import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SYSTEM OVERRIDE",
  description: "Moderation",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  }
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
