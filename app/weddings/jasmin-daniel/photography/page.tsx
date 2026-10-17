import type { Metadata } from "next";
import PhotographyStory from "../../../components/PhotographyStory";
import { storyBySlug } from "../../../stories";

const story = storyBySlug("jasmin-daniel")!;
export const metadata: Metadata = { title: "Jasmin & Daniel Photography | RZ Gallery", description: "Jasmin and Daniel's wedding photographs." };
export default function Page() { return <PhotographyStory story={story} />; }
