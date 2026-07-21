// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { IonicStepControl } from "./IonicStepControl.js";

it("shows the selected ionic step as a one-based slider and number", () => {
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={vi.fn()} />);

  expect(screen.getByLabelText("Ionic step slider")).toHaveValue("2");
  expect(screen.getByLabelText("Ionic step number")).toHaveValue(2);
  expect(screen.getByText("/ 120")).toBeInTheDocument();
});

it("converts a typed one-based ionic step to a zero-based index", async () => {
  const select = vi.fn();
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);

  const number = screen.getByLabelText("Ionic step number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "42");

  expect(select).toHaveBeenLastCalledWith(41);
});

it("keeps selection unchanged for an empty ionic step draft", async () => {
  const select = vi.fn();
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);

  await userEvent.setup().clear(screen.getByLabelText("Ionic step number"));

  expect(select).not.toHaveBeenCalled();
});

it("clamps a submitted ionic step to the final index", async () => {
  const select = vi.fn();
  render(<IonicStepControl total={120} selectedIndex={1} onSelect={select} />);

  const number = screen.getByLabelText("Ionic step number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "999{Enter}");

  expect(select).toHaveBeenLastCalledWith(119);
  expect(number).toHaveValue(120);
});
