import type { Metadata } from "next";
import { TripsView } from "@/components/trips/trips-view";

export const metadata: Metadata = { title: "My trips & wallet" };

export default function TripsPage() {
  return <TripsView />;
}
