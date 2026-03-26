import "./globals.css";
import Nav from "./components/Nav";

export const metadata = {
  title: "fantasy-life",
  description: "Goal drafting game",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}