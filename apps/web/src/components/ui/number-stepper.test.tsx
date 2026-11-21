// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { NumberStepper } from "./number-stepper";

afterEach(cleanup);

function Fixture() {
  const [value, setValue] = useState(3);
  return <NumberStepper id="searches" label="Search requests" value={value} min={1} max={20} onValueChange={setValue} />;
}

test("numeric limits support keyboard stepping and clamp typed values on blur", async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  const field = screen.getByRole("spinbutton", { name: "Search requests" });
  await user.click(field);
  await user.keyboard("{ArrowUp}");
  expect(field.getAttribute("aria-valuenow")).toBe("4");
  await user.keyboard("{Home}");
  expect(field.getAttribute("aria-valuenow")).toBe("1");
  expect((screen.getByRole("button", { name: "Decrease search requests" }) as HTMLButtonElement).disabled).toBe(true);
  await user.clear(field);
  await user.type(field, "99");
  await user.tab();
  expect((field as HTMLInputElement).value).toBe("20");
  expect((screen.getByRole("button", { name: "Increase search requests" }) as HTMLButtonElement).disabled).toBe(true);
});

test("empty edits restore the saved value without creating a zero limit", async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  const field = screen.getByRole("spinbutton", { name: "Search requests" });
  await user.clear(field);
  await user.tab();
  expect((field as HTMLInputElement).value).toBe("3");
  await user.click(screen.getByRole("button", { name: "Increase search requests" }));
  expect((field as HTMLInputElement).value).toBe("4");
});

test("Enter commits a bounded value without implicitly submitting a stale form value", async () => {
  const user = userEvent.setup(), submit = vi.fn();
  function Form() {
    const [value, setValue] = useState(3);
    return <form onSubmit={event => { event.preventDefault(); submit(value); }}><NumberStepper id="searches" label="Search requests" value={value} min={1} max={20} onValueChange={setValue} /><button type="submit">Save</button></form>;
  }
  render(<Form />);
  const field = screen.getByRole("spinbutton", { name: "Search requests" });
  await user.clear(field);
  await user.type(field, "99{Enter}");
  expect((field as HTMLInputElement).value).toBe("20");
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(submit).toHaveBeenCalledWith(20);
});
