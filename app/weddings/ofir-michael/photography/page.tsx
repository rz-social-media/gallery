import type { Metadata } from "next";
import PhotographyStory from "../../../components/PhotographyStory";
import { storyBySlug } from "../../../stories";

const story = storyBySlug("ofir-michael")!;
export const metadata: Metadata = { title: "Ofir & Michael Photography | RZ Gallery", description: "Ofir and Michael's wedding photographs." };
export default function Page() { return <PhotographyStory story={story} />; }
