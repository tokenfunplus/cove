import {expect,test} from "vitest";
import type {MiniAppPackage} from "@cove/api-contract";
import {canUpgrade} from "./presentation";

test("catalog updates preserve the independent publisher of a bundled app and isolate local packages",()=>{
  const before:MiniAppPackage={format:1,publisher:"bookshelf",app:"reading-inbox",name:"Inbox",version:"1.0.0",schema_version:1,capabilities:[],collections:{},pages:[],actions:{}};
  const after={...before,version:"1.1.0"};
  expect(canUpgrade(before,after,"builtin","catalog")).toBe(true);
  expect(canUpgrade(before,after,"builtin","local")).toBe(false);
  expect(canUpgrade(before,after,"local","catalog")).toBe(false);
  expect(canUpgrade(before,{...after,publisher:"another"},"builtin","catalog")).toBe(false);
});
