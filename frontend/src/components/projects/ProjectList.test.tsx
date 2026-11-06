import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { USER, authMock, project } from "@/test/helpers";
import { ProjectList } from "./ProjectList";

const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
const store = vi.hoisted(() => ({
  state: {
    projects: [] as unknown[],
    loading: false,
    error: "",
    refresh: vi.fn(),
    removeProject: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => store.state }));

beforeEach(() => {
  auth.current = authMock();
  store.state.projects = [project];
  store.state.loading = false;
  store.state.error = "";
});

describe("ProjectList", () => {
  it("members can edit and delete their projects", async () => {
    auth.current = authMock({ status: "user", user: USER });
    const user = userEvent.setup();
    render(<ProjectList />);
    expect(screen.getByRole("button", { name: "Edit project 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete project 1" }));
    await user.click(screen.getByRole("button", { name: "Delete project" }));
    expect(store.state.removeProject).toHaveBeenCalledWith(1);
  });

  it("editing opens a pre-filled dialog and saves through the API layer", async () => {
    auth.current = authMock({ status: "user", user: USER });
    const user = userEvent.setup();
    render(<ProjectList />);
    await user.click(screen.getByRole("button", { name: "Edit project 1" }));
    const box = screen.getByRole("dialog").querySelector("textarea")!;
    expect(box).toHaveValue(project.research_question);
    await user.clear(box);
    await user.type(box, "Does fMRI connectivity separate autism subtypes in adolescents?");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(store.state.updateProject).toHaveBeenCalledWith(1, expect.objectContaining({ research_question: "Does fMRI connectivity separate autism subtypes in adolescents?" }));
  });

  it("guests see their project but cannot edit or delete it", () => {
    auth.current = authMock({ status: "guest" });
    render(<ProjectList />);
    expect(screen.getByText(project.research_question)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit project/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete project/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register to unlock full access" })).toHaveAttribute("href", "/register");
  });
});
