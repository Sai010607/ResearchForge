import { FinalCta } from "@/components/landing/FinalCta";
import { Hero } from "@/components/landing/Hero";
import { Modules } from "@/components/landing/Modules";
import { Pipeline } from "@/components/landing/Pipeline";

export default function Home() {
  return (
    <>
      <Hero />
      <Pipeline />
      <Modules />
      <FinalCta />
    </>
  );
}
