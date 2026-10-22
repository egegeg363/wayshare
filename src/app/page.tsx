import type { Metadata } from "next";
import { FindRideView } from "@/components/find/find-view";

export const metadata: Metadata = { title: { absolute: "Find a ride · WayShare" } };

export default function FindRidePage() {
  return <FindRideView />;
}
