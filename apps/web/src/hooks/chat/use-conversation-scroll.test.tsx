// @vitest-environment jsdom

import { useMemo } from "react";
import { useConversationScroll } from "./use-conversation-scroll";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { createLiveTurn, liveTurnFromBatch } from "@/lib/chat/live-turn";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
  const liveTurn=useMemo(() => {
    const turn={...liveTurnFromBatch(fixture.conversation.id,"Prompt",fixture.pendingBatch),restored:true};
    turn.targets![0]!.assistantBody=body;
    return turn;
  }, [body]);
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


test("Latest clears prior user intent before intermediate animation events and new chunks", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollTo = vi.fn();
  const fixture = createWorkspaceFixture();
  function Surface({ body }: { body: string }) {
    const liveTurn = useMemo(() => {
      const turn = { ...liveTurnFromBatch(fixture.conversation.id, "Prompt", fixture.pendingBatch), restored: true };
      turn.targets![0]!.assistantBody = body;
      return turn;
    }, [body]);
    const scroll = useConversationScroll({ view: fixture.completedView, liveTurn });
    return <><div ref={scroll.messageListRef} onScroll={scroll.handleMessageScroll}><p>Reply</p></div><button onClick={scroll.returnToLatest}>Latest</button></>;
  }
  const { container, rerender } = render(<Surface body="First" />);
  const list = container.querySelector("div")!;
  Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  list.scrollTop = 400;
  fireEvent.wheel(list, { deltaY: -200 });
  fireEvent.scroll(list);
  fireEvent.click(container.querySelector("button")!);
  list.scrollTop = 500;
  fireEvent.scroll(list);
  rerender(<Surface body="First plus a new chunk" />);
  expect(list.scrollTop).toBe(1000);
  fireEvent.wheel(list, { deltaY: -200 });
  list.scrollTop = 350;
  fireEvent.scroll(list);
  rerender(<Surface body="First plus another chunk" />);
  expect(list.scrollTop).toBe(350);
});


test("restoring a conversation keeps a reader more than 24 pixels above latest paused", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const fixture = createWorkspaceFixture();
  const second = { ...fixture.completedView, id: "second-view" };
  function Surface({ secondSelected }: { secondSelected: boolean }) {
    const scroll = useConversationScroll({ view: secondSelected ? second : fixture.completedView });
    return <><div ref={scroll.messageListRef} onScroll={scroll.handleMessageScroll}><p>Reply</p></div><output>{String(scroll.showReturnToLatest)}</output></>;
  }
  const { container, rerender } = render(<Surface secondSelected={false} />);
  const list = container.querySelector("div")!;
  Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  list.scrollTop = 740;
  fireEvent.wheel(list, { deltaY: -60 });
  fireEvent.scroll(list);
  rerender(<Surface secondSelected />);
  rerender(<Surface secondSelected={false} />);
  expect(list.scrollTop).toBe(740);
  expect(container.querySelector("output")?.textContent).toBe("true");
});

test("the Quick Panel keeps the question in view through expansion and lets the reader follow or pause the latest answer", () => {
  const resized: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.top ? Number(this.dataset.top) - (this.parentElement?.scrollTop ?? 0) : 0;
    return { top, bottom: top + 30, height: 30 } as DOMRect;
  });
  let height = 250;
  let viewport = 80;
  let top = 0;
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    this.scrollTop = Math.min(height - viewport, typeof options === "number" ? options : options?.top ?? 0);
  };
  const fixture = createWorkspaceFixture();
  function Surface({ settled = false, body }: { settled?: boolean; body: string }) {
    const userId = fixture.pendingBatch.user_message_id;
    const liveTurn = useMemo(() => {
      if (settled) return undefined;
      const turn = liveTurnFromBatch(fixture.conversation.id, "Current question", fixture.pendingBatch);
      turn.targets![0]!.assistantBody = body;
      return turn;
    }, [body, settled]);
    const scroll = useConversationScroll({ view: fixture.completedView, liveTurn, quickPanel: true });
    return <>
      <div ref={(node) => {
        scroll.messageListRef.current = node;
        if (node) Object.defineProperties(node, {
          scrollHeight: { get: () => height, configurable: true },
          clientHeight: { get: () => viewport, configurable: true },
          scrollTop: {
            get: () => Math.min(top, height - viewport),
            set: (value: number) => { top = Math.max(0, Math.min(value, height - viewport)); },
            configurable: true,
          },
        });
      }} onScroll={scroll.handleMessageScroll}>
        <article data-quick-panel-question data-timeline-anchor="earlier" data-top="16">Earlier question</article>
        <article key={String(settled)} data-quick-panel-question data-timeline-anchor={userId} data-top="120">Current question</article>
        <p data-top="158">{body}</p>
        {height > 850 && <p data-top="732">Tail of the streamed reply</p>}
      </div>
      {scroll.showReturnToLatest && <button onClick={scroll.returnToLatest}>Latest</button>}
    </>;
  }
  const { container, rerender, queryByRole, getByRole } = render(<Surface body="Short reply" />);
  const list = container.querySelector("div")!;
  expect(list.scrollTop).toBe(108);

  // The native window has room to show the entire short turn after expanding.
  viewport = 150;
  act(() => { for (const callback of resized) callback(); });
  expect(list.scrollTop).toBe(100);
  rerender(<Surface body="Short reply" settled />);
  expect(list.scrollTop).toBe(100);
  expect(queryByRole("button", { name: "Latest" })).toBeNull();

  height = 880;
  rerender(<Surface body="A much longer response" />);
  expect(list.scrollTop).toBe(108);
  fireEvent.click(getByRole("button", { name: "Latest" }));
  expect(list.scrollTop).toBe(730);

  // Even a small upward wheel movement suspends following the stream.
  fireEvent.wheel(list, { deltaY: -12 });
  list.scrollTop = 718;
  height = 960;
  rerender(<Surface body="A much longer response with new streamed text" />);
  expect(list.scrollTop).toBe(718);
  fireEvent.scroll(list);
  expect(getByRole("button", { name: "Latest" })).toBeTruthy();

  fireEvent.wheel(list, { deltaY: 110 });
  list.scrollTop = 810;
  fireEvent.scroll(list);
  height = 990;
  rerender(<Surface body="Another update after returning to the end" />);
  expect(list.scrollTop).toBe(840);
  expect(queryByRole("button", { name: "Latest" })).toBeNull();
});
