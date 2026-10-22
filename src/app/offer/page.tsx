import type { Metadata } from "next";
import { OfferRideView } from "@/components/offer/offer-view";

export const metadata: Metadata = { title: "Offer a ride" };

export default function OfferRidePage() {
  return <OfferRideView />;
}
