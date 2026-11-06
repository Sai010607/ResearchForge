import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyCallback } from "@/components/auth/VerifyCallback";

export const metadata: Metadata = { title: "Verify email — ResearchForge" };

export default function Page() {
  return (
    <Suspense>
      <VerifyCallback />
    </Suspense>
  );
}
