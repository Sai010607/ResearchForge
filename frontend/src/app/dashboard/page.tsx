import type { Metadata } from "next";
import { IdentityGate } from "@/components/auth/IdentityGate";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const metadata: Metadata = { title: "Dashboard — ResearchForge" };

export default function DashboardPage() {
  return (
    <IdentityGate next="/dashboard">
      <DashboardView />
    </IdentityGate>
  );
}
