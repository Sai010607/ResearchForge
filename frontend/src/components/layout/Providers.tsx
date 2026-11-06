"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { ProjectsProvider } from "@/hooks/useProjects";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <ProjectsProvider>{children}</ProjectsProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
