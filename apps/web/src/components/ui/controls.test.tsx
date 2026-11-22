// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Checkbox } from "./checkbox";
import { Slider } from "./slider";
import { Progress } from "./progress";
import { Disclosure, DisclosureTrigger, DisclosureContent } from "./disclosure";
import { RadioGroup, RadioCard } from "./radio-group";
import { FrontSelect } from "./front-select";
import { Dialog, DialogContent } from "./dialog";
import { Button } from "./button";
import { Input } from "./input";
import { setupControlTests, chooseOption } from "@/test/control-helpers";

setupControlTests();
afterEach(cleanup);

test("checkbox labels and Space toggle once without submitting the form", async () => {
  const user = userEvent.setup(), submit = vi.fn();
  function Form() {
    const [checked, setChecked] = useState(false);
    return <form onSubmit={event => {event.preventDefault();submit();}}><label><Checkbox checked={checked} onCheckedChange={value=>setChecked(value===true)}/>Include code</label><label><Checkbox disabled/>Unavailable</label></form>;
  }
  render(<Form/>);
  const checkbox = screen.getByRole("checkbox", {name:"Include code"});
  await user.click(screen.getByText("Include code"));
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  await user.keyboard(" ");
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  await user.click(screen.getByText("Unavailable"));
  expect(screen.getByRole("checkbox", {name:"Unavailable"}).getAttribute("aria-checked")).toBe("false");
  expect(submit).not.toHaveBeenCalled();
});

test("slider keyboard steps preserve fractional speed and respect bounds", async () => {
  const user = userEvent.setup();
  function Fixture() {
    const [speed, setSpeed] = useState(1);
    return <Slider aria-label="Reading speed" min={.5} max={2} step={.05} value={speed} onValueChange={setSpeed}/>;
  }
  render(<Fixture/>);
  const slider=screen.getByRole("slider",{name:"Reading speed"});
  slider.focus();await user.keyboard("{ArrowRight}");
  expect(slider.getAttribute("aria-valuenow")).toBe("1.05");
  await user.keyboard("{Home}");expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
  await user.keyboard("{ArrowLeft}");expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
  await user.keyboard("{End}");expect(slider.getAttribute("aria-valuenow")).toBe("2");
});

test("nested disclosures keep edits mounted while hiding closed content from navigation", async () => {
  const user=userEvent.setup();
  render(<Disclosure><DisclosureTrigger>Advanced</DisclosureTrigger><DisclosureContent><Input aria-label="Saved draft" defaultValue="Keep this"/><Disclosure><DisclosureTrigger>More information</DisclosureTrigger><DisclosureContent>Nested content</DisclosureContent></Disclosure></DisclosureContent></Disclosure>);
  const trigger=screen.getByRole("button",{name:"Advanced"});
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("textbox")).toBeNull();
  trigger.focus();await user.keyboard("{Enter}");
  const draft=screen.getByRole<HTMLInputElement>("textbox",{name:"Saved draft"});await user.type(draft," draft");
  await user.click(screen.getByRole("button",{name:"More information"}));
  await user.click(trigger);expect(screen.queryByRole("button",{name:"More information"})).toBeNull();
  await user.click(trigger);expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("Keep this draft");
  expect(screen.getByRole("button",{name:"More information"}).getAttribute("aria-expanded")).toBe("true");
});

test("an empty select option round-trips and Escape closes the list before its dialog",async()=>{
  const user=userEvent.setup();
  function Fixture(){const[value,setValue]=useState("");const[open,setOpen]=useState(true);return <Dialog open={open} onClose={()=>setOpen(false)} label="Voice options"><DialogContent><FrontSelect ariaLabel="Default model" options={[{value:"",label:"Automatic"},{value:"local",label:"Local model"}]} value={value} onValueChange={setValue}/><Button onClick={()=>setOpen(false)}>Close</Button></DialogContent></Dialog>;}
  render(<Fixture/>);
  const field=screen.getByRole("combobox",{name:"Default model"});
  expect(field.textContent).toBe("Automatic");
  await chooseOption(user,field,"Local model");expect(field.textContent).toBe("Local model");
  await chooseOption(user,field,"Automatic");expect(field.textContent).toBe("Automatic");
  await user.click(field);await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();expect(screen.getByRole("dialog")).toBeTruthy();expect(document.activeElement).toBe(field);
  await user.keyboard("{Escape}");expect(screen.queryByRole("dialog")).toBeNull();
});

test("radio cards select with arrow keys and keep disabled choices unavailable",async()=>{
  const user=userEvent.setup();
  function Fixture(){const[value,setValue]=useState("paper");return <RadioGroup aria-label="Skin" value={value} onValueChange={setValue}><RadioCard value="paper">Paper</RadioCard><RadioCard value="ink">Ink</RadioCard><RadioCard value="disabled" disabled>Unavailable</RadioCard></RadioGroup>;}
  render(<Fixture/>);await user.click(screen.getByRole("radio",{name:"Paper"}));await user.keyboard("{ArrowRight>}");
  await waitFor(()=>expect(screen.getByRole("radio",{name:"Ink"}).getAttribute("aria-checked")).toBe("true"));
  await user.keyboard("{/ArrowRight}");
  await user.click(screen.getByRole("radio",{name:"Unavailable"}));expect(screen.getByRole("radio",{name:"Ink"}).getAttribute("aria-checked")).toBe("true");
});

test("progress exposes bounded byte counts and supports an unknown total",()=>{
  const {rerender}=render(<Progress aria-label="Download" max={50} value={60}/>);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
  rerender(<Progress aria-label="Download" value={null}/>);
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
});
