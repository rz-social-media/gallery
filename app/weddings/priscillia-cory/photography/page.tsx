import type { Metadata } from "next";
import PhotographyStory from "../../../components/PhotographyStory";
import { storyBySlug } from "../../../stories";

const story = storyBySlug("priscillia-cory")!;
export const metadata: Metadata = { title: "Priscillia & Cory Photography | RZ Gallery", description: "Priscillia and Cory's wedding photographs." };
export default function Page() { return <PhotographyStory story={story} />; }
