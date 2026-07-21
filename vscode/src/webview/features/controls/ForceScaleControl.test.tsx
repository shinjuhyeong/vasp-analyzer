// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { ForceScaleControl, scaleToSlider, sliderPositionToScale, sliderToScale } from "./ForceScaleControl.js";

it("maps force scale logarithmically to the slider", () => {
  expect(scaleToSlider(1)).toBe(0);
  expect(scaleToSlider(10)).toBeCloseTo(1 / 3);
  expect(scaleToSlider(1000)).toBe(1);
  expect(sliderToScale(scaleToSlider(250))).toBeCloseTo(250);
});

it("shows the force scale in paired slider and number controls", () => {
  render(<ForceScaleControl value={250} onChange={vi.fn()} />);

  expect(screen.getByLabelText("Force vector scale slider")).toHaveValue(String(scaleToSlider(250)));
  expect(screen.getByLabelText("Force vector scale number")).toHaveValue(250);
  expect(screen.getByText("250×")).toBeInTheDocument();
});

it("emits a finite force scale typed into the number control", async () => {
  const change = vi.fn();
  render(<ForceScaleControl value={250} onChange={change} />);

  const number = screen.getByLabelText("Force vector scale number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "500");

  expect(change).toHaveBeenLastCalledWith(500);
});

it("rounds slider-generated scales to stable readable precision", () => {
  const emitted = sliderPositionToScale(scaleToSlider(10.023052));
  expect(emitted).toBe(10.02);
});

it("formats an externally supplied high-precision scale without an unwieldy readout", () => {
  render(<ForceScaleControl value={10.023052} onChange={vi.fn()} />);

  expect(screen.getByText("10.02×")).toBeInTheDocument();
  expect(screen.getByLabelText("Force vector scale number")).toHaveValue(10.023052);
});

it("preserves a valid direct decimal scale", async () => {
  const change = vi.fn();
  render(<ForceScaleControl value={10} onChange={change} />);

  const number = screen.getByLabelText("Force vector scale number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "10.023052");

  expect(change).toHaveBeenLastCalledWith(10.023052);
});

it("keeps force scale unchanged for an empty draft", async () => {
  const change = vi.fn();
  render(<ForceScaleControl value={250} onChange={change} />);

  await userEvent.setup().clear(screen.getByLabelText("Force vector scale number"));

  expect(change).not.toHaveBeenCalled();
});

it.each(["blur", "Enter"] as const)(
  "restores the controlled force scale without dispatch when an empty draft commits on %s",
  async (commit) => {
    const change = vi.fn();
    render(<ForceScaleControl value={250} onChange={change} />);

    const user = userEvent.setup();
    const number = screen.getByLabelText("Force vector scale number");
    await user.clear(number);
    if (commit === "blur") {
      await user.tab();
    } else {
      await user.keyboard("{Enter}");
    }

    expect(number).toHaveValue(250);
    expect(change).not.toHaveBeenCalled();
  },
);

it("clamps a submitted force scale to the maximum", async () => {
  const change = vi.fn();
  render(<ForceScaleControl value={250} onChange={change} />);

  const number = screen.getByLabelText("Force vector scale number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "5000{Enter}");

  expect(change).toHaveBeenLastCalledWith(1000);
  expect(number).toHaveValue(1000);
});
