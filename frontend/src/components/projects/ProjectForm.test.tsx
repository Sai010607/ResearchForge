import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { USER, authMock, project, trial } from "@/test/helpers";
import { ProjectForm } from "./ProjectForm";

const QUESTION = "Can T1-weighted MRI improve early Alzheimer's detection using interpretable biomarkers?";
const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
const apiMock = vi.hoisted(() => ({ createProject: vi.fn() }));
const projects = vi.hoisted(() => ({ addProject: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => projects }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: apiMock }));

beforeEach(() => {
  auth.current = authMock();
  apiMock.createProject.mockReset();
});

async function submitValid() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Research question"), QUESTION);
  await user.click(screen.getByRole("button", { name: "Early Detection" }));
  await user.click(screen.getByRole("button", { name: "Create research project" }));
  return user;
}

describe("ProjectForm trial gating (state comes from the server)", () => {
  it("anonymous visitors see the trial gate, not the form", () => {
    render(<ProjectForm />);
    expect(screen.getByText("Create your first research project — free")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start free trial" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Research question")).not.toBeInTheDocument();
  });

  it("guest with the trial available sees the form and the 1/1 badge", () => {
    auth.current = authMock({ status: "guest", trial: trial(false) });
    render(<ProjectForm />);
    expect(screen.getByLabelText("Research question")).toBeInTheDocument();
    expect(screen.getByText("Guest Trial: 1/1 remaining")).toBeInTheDocument();
  });

  it("guest whose trial is used cannot create: sees why, with Create Free Account / Sign In", () => {
    auth.current = authMock({ status: "guest", trial: trial(true) });
    render(<ProjectForm />);
    expect(screen.getByText("Your free trial project has been used")).toBeInTheDocument();
    expect(screen.getByText(/can’t create another without an account/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Free Account" })).toHaveAttribute("href", "/register");
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText("Research question")).not.toBeInTheDocument();
  });

  it("first successful guest project shows the celebration + upgrade copy and refreshes the trial", async () => {
    auth.current = authMock({ status: "guest", trial: trial(false) });
    apiMock.createProject.mockResolvedValue(project);
    render(<ProjectForm />);
    await submitValid();
    expect(await screen.findByText("Your first research project is ready!")).toBeInTheDocument();
    expect(screen.getByText("Enjoyed your ResearchForge experience? Create your free account to unlock your research workspace.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Free Account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign In" })).toBeInTheDocument();
    expect(projects.addProject).toHaveBeenCalledWith(project);
    expect(auth.current.reload).toHaveBeenCalled(); // pulls the consumed trial from the backend
  });

  it("client-side validation failure never calls the API (so the trial can't be consumed)", async () => {
    auth.current = authMock({ status: "guest", trial: trial(false) });
    const user = userEvent.setup();
    render(<ProjectForm />);
    await user.type(screen.getByLabelText("Research question"), "short");
    await user.click(screen.getByRole("button", { name: "Create research project" }));
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
    expect(screen.getByText("Select at least one research objective.")).toBeInTheDocument();
    expect(apiMock.createProject).not.toHaveBeenCalled();
    expect(auth.current.reload).not.toHaveBeenCalled();
  });

  it("a server-side failure keeps the form open and the trial untouched", async () => {
    auth.current = authMock({ status: "guest", trial: trial(false) });
    apiMock.createProject.mockRejectedValue(new ApiError("Cannot reach the backend", undefined));
    render(<ProjectForm />);
    await submitValid();
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the backend");
    expect(screen.getByLabelText("Research question")).toBeInTheDocument();
    expect(screen.queryByText("Your first research project is ready!")).not.toBeInTheDocument();
  });

  it("if another tab already used the trial, the server says so and the UI re-syncs", async () => {
    auth.current = authMock({ status: "guest", trial: trial(false) });
    apiMock.createProject.mockRejectedValue(new ApiError("Your free research project has been used.", 403, "trial_exhausted"));
    render(<ProjectForm />);
    await submitValid();
    await waitFor(() => expect(auth.current.reload).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("has been used");
  });

  it("members get the normal success panel (no upgrade prompt, no trial badge)", async () => {
    auth.current = authMock({ status: "user", user: USER });
    apiMock.createProject.mockResolvedValue(project);
    render(<ProjectForm />);
    expect(screen.queryByText(/Guest Trial/)).not.toBeInTheDocument();
    await submitValid();
    expect(await screen.findByText(/saved to your database/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Your first research project is ready!")).not.toBeInTheDocument();
  });
});
