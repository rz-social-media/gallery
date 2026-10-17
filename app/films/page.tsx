import type { Metadata } from "next";
import StoryIndex from "../components/StoryIndex";

export const metadata: Metadata = { title: "Wedding Films | RZ Gallery", description: "Selected wedding stories in cinematic motion." };

export default function FilmsPage() {
  return <StoryIndex mode="films" />;
}
