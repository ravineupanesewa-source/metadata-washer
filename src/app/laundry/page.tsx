import type { Metadata } from "next";
import { LaundryDemo } from "@/features/laundry/laundry-demo";

export const metadata: Metadata = {
  title: "Suds laundromat: background wash",
  description: "Drop a picture into the washing machine and get it back with the background removed.",
  // Animation prototype: its background remover is a placeholder. Keep it out of search results.
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function LaundryPage() {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <LaundryDemo />
    </main>
  );
}
