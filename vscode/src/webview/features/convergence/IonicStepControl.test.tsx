// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { IonicStepControl } from "./IonicStepControl.js";

it("represents Initial as frame zero and synchronizes both controls", async () => {
  const select = vi.fn();
  render(<IonicStepControl total={2} selectedIndex={-1} includeInitial onSelect={select} />);
  expect(screen.getByLabelText("Ionic step slider")).toHaveValue("0");
  expect(screen.getByLabelText("Ionic step number")).toHaveValue(0);
  expect(screen.getByText("Initial / 2")).toBeVisible();
  await userEvent.setup().click(screen.getByLabelText("Ionic step slider"));
});

it("shows the selected ionic step as a one-based slider and number", () => {
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={vi.fn()} />);

  expect(screen.getByLabelText("Ionic step slider")).toHaveValue("2");
  expect(screen.getByLabelText("Ionic step number")).toHaveValue(2);
  expect(screen.getByText("2 / 120")).toBeInTheDocument();
});

it("prefixes only accessible labels for a second synchronized control", () => {
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={vi.fn()} labelPrefix="Convergence " />);

  expect(screen.getByLabelText("Convergence ionic step slider")).toHaveValue("2");
  expect(screen.getByLabelText("Convergence ionic step number")).toHaveValue(2);
  expect(screen.getByText("Ionic step slider")).toBeVisible();
  expect(screen.getByText("Ionic step number")).toBeVisible();
});

it("keeps a typed ionic step local until Enter commits the zero-based index", async () => {
  const select = vi.fn();
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);

  const number = screen.getByLabelText("Ionic step number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "42");

  expect(select).not.toHaveBeenCalled();
  await userEvent.setup().keyboard("{Enter}");
  expect(select).toHaveBeenLastCalledWith(41);
});

it("keeps selection unchanged for an empty ionic step draft", async () => {
  const select = vi.fn();
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);

  await userEvent.setup().clear(screen.getByLabelText("Ionic step number"));

  expect(select).not.toHaveBeenCalled();
});

it.each(["blur", "Enter"] as const)(
  "restores the controlled ionic step without dispatch when an empty draft commits on %s",
  async (commit) => {
    const select = vi.fn();
    render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);

    const user = userEvent.setup();
    const number = screen.getByLabelText("Ionic step number");
    await user.clear(number);
    if (commit === "blur") {
      await user.tab();
    } else {
      await user.keyboard("{Enter}");
    }

    expect(number).toHaveValue(2);
    expect(select).not.toHaveBeenCalled();
  },
);

it("clamps a submitted ionic step to the final index", async () => {
  const select = vi.fn();
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);

  const number = screen.getByLabelText("Ionic step number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "999{Enter}");

  expect(select).toHaveBeenLastCalledWith(119);
  expect(number).toHaveValue(120);
});

it.each(["1.5", "not-a-number"])(
  "restores without dispatch when invalid draft %s commits",
  async (draft) => {
    const select = vi.fn();
    render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);
    const user = userEvent.setup();
    const number = screen.getByLabelText("Ionic step number");

    await user.clear(number);
    await user.type(number, draft);
    await user.keyboard("{Enter}");

    expect(number).toHaveValue(2);
    expect(select).not.toHaveBeenCalled();
  },
);
