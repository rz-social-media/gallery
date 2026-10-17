import type { Metadata } from "next";
import StoryIndex from "../components/StoryIndex";

export const metadata: Metadata = { title: "Wedding Photography | RZ Gallery", description: "Selected wedding stories in photographs." };

export default function PhotographyPage() {
  return <StoryIndex mode="photography" />;
}
