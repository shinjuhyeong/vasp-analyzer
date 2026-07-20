// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { IonicStepControl } from "./IonicStepControl.js";

it("dispatches the array position rather than the parser step index", async () => {
  const select = vi.fn();
  render(<IonicStepControl steps={[{ index: 7 }, { index: 99 }]} selectedIndex={0} onSelect={select} />);
  await userEvent.setup().selectOptions(screen.getByLabelText("Ionic step"), "1");
  expect(select).toHaveBeenCalledWith(1);
  expect(screen.getByRole("option", { name: "2 / 2" })).toHaveValue("1");
});
