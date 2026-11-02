import type { Metadata } from "next";
import { LaundryDemo } from "@/features/laundry/laundry-demo";

export const metadata: Metadata = {
  title: "Suds laundromat: background wash",
  description: "Drop a picture into the washing machine and get it back with the background removed.",
};

export default function LaundryPage() {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <LaundryDemo />
    </main>
  );
}
