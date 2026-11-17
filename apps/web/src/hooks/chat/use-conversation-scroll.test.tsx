// @vitest-environment jsdom

import { useConversationScroll } from "./use-conversation-scroll";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { createLiveTurn, liveTurnFromBatch } from "@/lib/chat/live-turn";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const originalScrollTo = HTMLElement.prototype.scrollTo;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); HTMLElement.prototype.scrollTo = originalScrollTo; });

test.each(["loading", "cached"])("a later answer reaches its own turn after %s detail is refreshed", (initial) => {
  const resized: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized.push(callback); }
    observe() {} disconnect() {}
  });
  const scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
  });
  HTMLElement.prototype.scrollTo = scrollTo;
  const fixture = createWorkspaceFixture(2);
  const first = fixture.completedBatch;
  const later = {
    ...first, id: "later-batch", user_message_id: "later-user",
    targets: first.targets.map((target, index) => ({ ...target, generation: {
      ...target.generation, assistant_message_id: "later-answer-" + index,
    } })),
  };
  const messages = [...fixture.completedView.messages,
    { ...fixture.completedView.messages[0]!, id: later.user_message_id },
    { ...fixture.completedView.messages[1]!, id: "later-answer-1" },
  ];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this.dataset.top ? Number(this.dataset.top) - (this.parentElement?.scrollTop ?? 0) : 0, height: 30 } as DOMRect;
  });
  function Surface({ ready, extra = false }: { ready: boolean; extra?: boolean }) {
    const displayed = ready ? messages : messages.map((message) => message.id === "later-answer-1" ? { ...message, id: "stale-answer" } : message);
    const view = { ...fixture.completedView, generation_batches: [first, later], messages: extra ? [...displayed, { ...messages[0]!, id: "extra-user" }] : displayed };
    const scroll = useConversationScroll({
      view, isLoading: initial === "loading" && !ready,
      navigation: { conversationId: view.id, messageId: "later-answer-1", requestId: "search-selection" },
    });
    return <div ref={scroll.messageListRef} onScroll={scroll.handleMessageScroll}>
      <div data-timeline-anchor={first.user_message_id} data-top="120" />
      <div data-timeline-anchor={later.user_message_id} data-top="480" />
    </div>;
  }
  const { rerender, container } = render(<Surface ready={false} />);
  expect(scrollTo).not.toHaveBeenCalled();
  rerender(<Surface ready />);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 468, behavior: "instant" });
  const list = container.firstElementChild as HTMLDivElement;
  Object.defineProperty(list, "scrollHeight", { value: 500 });
  fireEvent.scroll(list);
  for (const callback of resized) callback();
  expect(list.scrollTop).toBe(468);
  // A real user scroll can resume following the latest answer.
  fireEvent.wheel(list);
  list.scrollTop = 490;
  fireEvent.scroll(list);
  for (const callback of resized) callback();
  expect(list.scrollTop).toBe(500);
  scrollTo.mockClear();
  rerender(<Surface ready extra />);
  expect(scrollTo).not.toHaveBeenCalled();
});

test("restoring active work preserves a search jump and a new send resumes following", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this.dataset.timelineAnchor ? 120 - (this.parentElement?.scrollTop ?? 0) : 0, height: 20 } as DOMRect;
  });
  const fixture = createWorkspaceFixture();
  function Surface({ activity }: { activity?: "restored" | "new" }) {
    const liveTurn = activity === "restored"
      ? { ...liveTurnFromBatch(fixture.conversation.id, "Restored activity", fixture.pendingBatch), restored: true }
      : activity === "new" ? createLiveTurn(fixture.conversation.id, "A new prompt", "new-send", []) : undefined;
    const scroll = useConversationScroll({
      view: fixture.completedView, liveTurn,
      navigation: { conversationId: fixture.conversation.id, messageId: fixture.completedView.messages[0]!.id, requestId: "earlier-search" },
    });
    return <div ref={scroll.messageListRef}><div data-timeline-anchor={fixture.completedBatch.user_message_id} /></div>;
  }
  const { rerender, container } = render(<Surface />);
  const list = container.firstElementChild as HTMLDivElement;
  Object.defineProperty(list, "scrollHeight", { value: 1000 });
  expect(list.scrollTop).toBe(108);
  rerender(<Surface activity="restored" />);
  expect(list.scrollTop).toBe(108);
  rerender(<Surface activity="new" />);
  expect(list.scrollTop).toBe(1000);
});

test("reading pauses streaming, counts updated answers, and compensates a collapsed block above the anchor",()=>{
 const resized:(()=>void)[]=[];
 vi.stubGlobal("ResizeObserver",class{constructor(callback:()=>void){resized.push(callback);}observe(){}disconnect(){}});
 let offset=480;
 vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){
  const top=this.dataset.reading!==undefined?offset-(this.parentElement?.scrollTop??0):0;
  return {top,bottom:top+30,height:30} as DOMRect;
 });
 HTMLElement.prototype.scrollTo=function(options?:ScrollToOptions|number,y?:number){this.scrollTop=typeof options==="number"?y??0:options?.top??0;};
 const fixture=createWorkspaceFixture();
 function Surface({body}:{body:string}) {
  const liveTurn={...liveTurnFromBatch(fixture.conversation.id,"Prompt",fixture.pendingBatch),restored:true};
  liveTurn.targets![0]!.assistantBody=body;
  const scroll=useConversationScroll({view:fixture.completedView,liveTurn});
  return <><div ref={scroll.messageListRef} onScroll={scroll.handleMessageScroll}><p data-reading>Reading</p></div><output>{scroll.updatedReplies}</output><button onClick={scroll.returnToLatest}>Latest</button></>;
 }
 const {container,rerender}=render(<Surface body="First"/>);
 const list=container.querySelector("div")!;
 Object.defineProperties(list,{scrollHeight:{value:1000},clientHeight:{value:200}});
 list.scrollTop=400;
 fireEvent.wheel(list,{deltaY:-200});fireEvent.scroll(list);
 rerender(<Surface body="First and more streamed content"/>);
 expect(list.scrollTop).toBe(400);expect(container.querySelector("output")!.textContent).toBe("1");
 offset=400;
 for(const callback of resized) callback();
 expect(list.scrollTop).toBe(320);
 fireEvent.click(container.querySelector("button")!);
 expect(container.querySelector("output")!.textContent).toBe("0");
});
