// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { ForceScaleControl, scaleToSlider, sliderToScale } from "./ForceScaleControl.js";

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

it("keeps force scale unchanged for an empty draft", async () => {
  const change = vi.fn();
  render(<ForceScaleControl value={250} onChange={change} />);

  await userEvent.setup().clear(screen.getByLabelText("Force vector scale number"));

  expect(change).not.toHaveBeenCalled();
});

it("clamps a submitted force scale to the maximum", async () => {
  const change = vi.fn();
  render(<ForceScaleControl value={250} onChange={change} />);

  const number = screen.getByLabelText("Force vector scale number");
  await userEvent.setup().clear(number);
  await userEvent.setup().type(number, "5000{Enter}");

  expect(change).toHaveBeenLastCalledWith(1000);
  expect(number).toHaveValue(1000);
});
