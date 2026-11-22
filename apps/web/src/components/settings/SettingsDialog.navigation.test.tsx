// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { SettingsDialogContent } from "./SettingsDialog";
afterEach(cleanup);
test("external local-model navigation works again after returning through the Provider tab",async()=>{
 function Settings(){const [section,setSection]=useState<"general"|"provider"|"local-models"|"web-search"|"chat-data">("provider");return <SettingsDialogContent initialSection={section} onSectionChange={setSection}><button onClick={()=>setSection("local-models")}>Manage fixture models</button></SettingsDialogContent>;}
 const user=userEvent.setup();render(<Settings/>);
 for(let i=0;i<2;i++){await user.click(screen.getByRole("button",{name:"Manage fixture models"}));expect(screen.getByRole("tab",{name:"On this Mac"}).getAttribute("aria-selected")).toBe("true");await user.click(screen.getByRole("tab",{name:"Provider settings"}));expect(screen.getByRole("tab",{name:"Provider settings"}).getAttribute("aria-selected")).toBe("true");}
});
