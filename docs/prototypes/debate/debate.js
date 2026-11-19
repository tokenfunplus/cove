/* Local design study. All responses, usage, and prices are synthetic. */
(() => {
  "use strict";
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const escape = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const icons = {
    wave:'<path d="M2 9c3-5 6-5 10 0s7 5 10 0M2 15c3-5 6-5 10 0s7 5 10 0"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    chat:'<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/>',
    debate:'<path d="M4 4h12v9H8l-4 3ZM8 17h8l4 3V9"/>',
    book:'<path d="M12 5c-4-3-9-1-9-1v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Zm0 0v15"/>',
    settings:'<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
    pause:'<path d="M8 5v14M16 5v14"/>',
    play:'<path d="m8 5 11 7-11 7Z"/>',
    stop:'<rect x="6" y="6" width="12" height="12" rx="1"/>',
    step:'<path d="m5 5 10 7-10 7ZM19 5v14"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
    layers:'<path d="m12 3 10 5-10 5L2 8ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
    quote:'<path d="M10 5H4v8h6V5ZM20 5h-6v8h6V5ZM10 13c0 4-2 6-5 6M20 13c0 4-2 6-5 6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    map:'<circle cx="5" cy="5" r="2"/><circle cx="19" cy="8" r="2"/><circle cx="8" cy="19" r="2"/><path d="m7 5 10 3M6 7l2 10M17 10l-8 8"/>',
    minus:'<path d="M5 12h14"/>',
    reset:'<path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
  const models = [
    {id:"claude",name:"Claude",provider:"Anthropic profile",symbol:"C",role:"Advocate"},
    {id:"gpt",name:"GPT",provider:"OpenAI profile",symbol:"G",role:"Challenger"},
    {id:"gemini",name:"Gemini",provider:"Google profile",symbol:"✦",role:"Evidence analyst"},
    {id:"deepseek",name:"DeepSeek",provider:"DeepSeek profile",symbol:"D",role:"Synthesizer"}
  ];
  const roles = ["Advocate","Challenger","Evidence analyst","Synthesizer","First principles","Risk analyst"];
  const view = document.body.dataset.view;
  const phaseNames = ["Independent opening","Cross-examination","Evidence check","Explore a new angle"];
  const state = {
    status:"ready", round:3, turn:0, epoch:0, timer:null, streamTimer:null, stepOnly:false,
    participants:models.map(m => ({...m})), topic:"Should startups stay small in the age of AI?",
    template:"Open inquiry", rules:"Challenge a specific claim, not the speaker.\nSeparate evidence from assumptions.\nAcknowledge what would change your position.\nKeep each turn concise and add a new angle.",
    blind:true, rotate:true, length:180, checkpointEvery:3, ruleVersion:1, pendingRules:null,
    pendingNotes:[], interventions:[], messages:[], events:[], checkpoint:null,
    selectedClaim:"ceiling", filter:"all", zoom:1, inspectorTab:"brief", cost:0.037,
    calls:8, totalTurns:8, activeMessage:null, focusedModel:null, lastArchive:0, setupKind:"new"
  };
  const claims = [
    {id:"question",kind:"Question",title:"Can a small team build something big?",status:"open",round:"Topic",description:"The debate asks whether AI changes the minimum effective team size, and where human judgment still sets a limit.",support:"A smaller team can capture more value with stronger tools.",challenge:"The right team size depends on the business and its risk.",x:28,y:17},
    {id:"speed",kind:"Claim",title:"AI gives small teams more operating leverage.",status:"open",round:"Round 01",description:"Automation may increase output per person. The unresolved question is whether that output becomes durable business value.",support:"A compact team can test more ideas before adding coordination overhead.",challenge:"Generating more work does not establish demand or quality.",x:73,y:35},
    {id:"ceiling",kind:"Open disagreement",title:"Does speed create a new coordination ceiling?",status:"open",round:"Round 02",description:"The panel disagrees on whether a small team can absorb the review, ownership, and customer work created by faster AI output.",support:"Less handoff means faster decisions and clearer ownership.",challenge:"More output still needs review. A small team may simply move the bottleneck.",x:27,y:54},
    {id:"evidence",kind:"Evidence gap",title:"What would a six-week pilot need to measure?",status:"open",round:"Round 03",description:"No external source has been checked. The panel proposes a test that separates apparent speed from reliable outcomes.",support:"Track cycle time, defects, customer response, and review effort.",challenge:"Compare against a baseline and account for the cost of rework.",x:73,y:78},
    {id:"shared",kind:"Shared ground",title:"Team size should follow the bottleneck.",status:"agreed",round:"Round 02",description:"The participants share a provisional principle: hire around a demonstrated constraint instead of a headcount target. This is agreement, not verified truth.",support:"Keep the team compact while monitoring delivery and customer outcomes.",challenge:"Define the hiring trigger before the team becomes overloaded.",x:27,y:89}
  ];
  const scripts = {
    claude:[
      "The strongest case for staying small is not cheaper output. It is a shorter distance between a customer signal and a decision. AI helps a compact team test that signal without adding a handoff at every step.",
      "I accept the review bottleneck. But adding people is only one response. Before hiring, narrow the work in progress and give one person ownership of the result. The question is which constraint actually survives that change.",
      "A six-week pilot would make this concrete: hold team size constant, reduce work in progress, and track customer outcomes alongside review effort. I would change my position if rework erased the speed improvement.",
      "Consider the customer-facing work that cannot be automated. A small team can still win if it limits its promises. The next useful question is whether a narrower product changes the staffing trade-off."
    ],
    gpt:[
      "I want to challenge the jump from faster production to a smaller company. More output creates more review, support, and operational responsibility. A team can remove a coding bottleneck and discover a judgment bottleneck instead.",
      "That argument assumes ownership scales with output. What happens when one person is simultaneously reviewing changes, handling an incident, and talking to a customer? We need a failure case, not only an efficiency case.",
      "The pilot also needs a baseline. If delivery is faster but defects rise, apparent leverage may be borrowed from future maintenance. I would measure escaped defects and recovery time before recommending a hiring freeze.",
      "Let us test the exception: a regulated product with on-call obligations. The minimum viable team may be determined by coverage and independent review, even when AI can do most of the production work."
    ],
    gemini:[
      "We should separate three claims: AI increases individual output; a smaller team ships faster; and a smaller company serves customers better. None follows automatically from the previous one. We have not checked external evidence here.",
      "The disagreement is testable. Track cycle time, review hours, escaped defects, and customer response time. A raw count of shipped changes could reward exactly the behavior the challenger is worried about.",
      "An evidence gap remains around sustained operation. A short pilot can show throughput, but it may miss maintenance and staff absence. Record those limitations rather than treating an encouraging result as a general rule.",
      "For the next round, compare two scenarios: a low-risk internal tool and a customer-critical service. The same AI productivity improvement may lead to very different staffing decisions."
    ],
    deepseek:[
      "There is a useful distinction emerging: stay small as a default, or stay small as a fixed rule. The panel shares the first instinct but has not justified the second. We should preserve that difference as the discussion continues.",
      "The live dispute is now about bottlenecks rather than headcount. One side expects focused ownership to absorb the extra work. The other expects review and operational coverage to set a floor. Both need observable triggers.",
      "Provisional shared ground: hire around a demonstrated constraint. Still unresolved: how much evidence is enough to show that the constraint is structural? The next round should challenge the proposed measurement window.",
      "We are repeating the productivity question. A fresh angle is reversibility: which staffing decision is easier to undo? Explore contractors, narrower scope, and coverage before turning either a hiring freeze or expansion into a principle."
    ]
  };
  const seed = [
    ...models.map(model=>({model:model.id,round:1,text:scripts[model.id][0],tag:model.id==="gemini"?"Evidence needed":"Independent opening"})),
    ...[models[1],models[2],models[3],models[0]].map((model,i,all)=>({model:model.id,round:2,text:scripts[model.id][1],tag:model.id==="gemini"?"Evidence needed":"Challenges a claim",ref:i?all[i-1].id:"claude"}))
  ];
  state.messages = seed.map((message,i) => ({...message,id:`seed-${i}`,complete:true,role:models.find(m=>m.id===message.model).role}));
  const avatar = (m, large = false) => `<span class="avatar ${m.id}${large ? " large" : ""}" aria-hidden="true">${m.symbol}</span>`;
  function toast(message) {
    $("#toast").textContent = message;
    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(() => { $("#toast").textContent = ""; },4500);
  }
  function phase() { return phaseNames[Math.min(state.round-1,3)]; }
  function claimData() {
    if(state.topic === "Should startups stay small in the age of AI?") return claims;
    return claims.map((claim,i)=>({...claim,
      title:[state.topic,"Which assumption carries the conclusion?","What is the strongest counterexample?","What evidence would change a position?","Separate shared assumptions from verified facts."][i],
      description:"This is a scripted interaction sample for your topic. These nodes demonstrate how claims, challenges, and evidence gaps could be organized; they are not model analysis.",
      support:"State one testable claim and the assumptions it depends on.",challenge:"Ask what evidence or counterexample would overturn that claim."
    }));
  }
  function rootMarkup() {
    return `<div class="prototype-bar"><div class="label">${icon("layers")}<b>Cove design exploration</b><span>Scripted demo · No model calls</span></div><a href="index.html">All concepts</a></div>
    <div class="app"><aside class="sidebar"><a class="logo" href="index.html" aria-label="Prototype gallery">${icon("wave")}cove</a>
      <button class="btn new" data-action="setup">${icon("plus")}New debate</button>
      <nav aria-label="Workspace"><p class="nav-label">Workspace</p><button class="nav-item" data-action="setup" title="Set up a conversation">${icon("chat")}<span>New conversation</span></button><button class="nav-item active" data-action="overview" title="Debate overview">${icon("debate")}<span>Debate mode</span></button><button class="nav-item" data-action="summary" title="Current checkpoint">${icon("book")}<span>Checkpoints</span></button></nav>
      <div><p class="nav-label">This discussion</p><button class="nav-item active" data-action="transcript" title="Read transcript">${icon("chat")}<span>AI & team size</span></button><button class="nav-item" data-action="rules" title="Edit ground rules">${icon("settings")}<span>Ground rules</span></button></div>
      <div class="sidebar-help"><strong>Room to disagree.</strong>A shared position is a checkpoint. The conversation keeps going until you stop it.</div><div class="bottom small muted"><span class="dot"></span> Local prototype<br><span style="font-size:11px">No credentials required</span></div></aside>
      <main class="workspace"><header class="topbar"><div class="breadcrumbs">Workspace <span>/</span> <strong>Debate mode</strong></div><nav class="view-nav" aria-label="Prototype concepts">${[["workspace","Workspace"],["roundtable","Roundtable"],["argument-map","Argument map"]].map(([id,label])=>`<a href="${id}.html"${view===id?' class="active" aria-current="page"':""}>${label}</a>`).join("")}</nav><div class="top-actions"><button class="icon-btn" data-action="export" title="Export demo transcript" aria-label="Export demo transcript">${icon("download")}</button><button class="btn" data-action="setup">${icon("settings")}<span>Set up debate</span></button></div></header>
      ${view==="argument-map"?topicMarkup():""}<div id="liveTop">${view==="argument-map"?controlsMarkup():""}</div>
      <div class="main-grid">${view==="workspace"?workspaceMarkup():view==="roundtable"?roundtableMarkup():mapMarkup()}${inspectorMarkup()}</div></main></div>
      <dialog id="setupDialog" aria-labelledby="setupTitle"></dialog><dialog id="detailDialog" aria-labelledby="detailTitle"></dialog><div id="toast" class="toast" role="status" aria-live="polite"></div>`;
  }
  function topicMarkup() {
    return `<section class="topic-header"><div class="eyebrow">An open-ended conversation</div><h1 id="topicText">${escape(state.topic)}</h1><div class="tags"><span class="chip green">${icon("debate")}Continuous debate</span><span class="chip" id="modelCount">${state.participants.length} perspectives</span><button class="chip" data-action="rules" id="ruleTag">Ground rules · v${state.ruleVersion}</button></div></section>`;
  }
  function controlsMarkup() {
    const running = state.status === "running" || state.status === "pausing";
    const labels = {ready:"Ready when you are",running:`Round ${String(state.round).padStart(2,"0")} · ${phase()}`,pausing:"Finishing this turn…",paused:`Paused · Round ${String(state.round).padStart(2,"0")}`,stopped:"Debate stopped"};
    return `<div class="live-toolbar"><div class="stack" style="gap:4px"><div class="state-label"><span class="dot"></span>${labels[state.status]}</div><span class="small muted">${state.status==="stopped"?"Completed turns preserved. Start a new session to continue.":"No round limit · Agreement does not end the debate"}</span></div><div class="run-controls"><button class="icon-btn" data-action="step" title="Run one turn" aria-label="Run one turn" ${running||state.status==="stopped"?"disabled":""}>${icon("step")}</button><button class="btn soft" data-action="toggle" ${state.status==="pausing"?"disabled":""}>${icon(running?"pause":"play")}${running?"Pause":state.status==="ready"?"Start debate":state.status==="stopped"?"New debate":"Resume"}</button><button class="btn danger" data-action="stop" ${!running&&state.status!=="paused"?"disabled":""}>${icon("stop")}Stop</button></div></div>`;
  }
  function composerMarkup() {
    return `<div id="queuePreview" class="pending-preview"></div><form id="interventionForm" class="composer"><label class="sr-only" for="intervention">Your intervention</label><textarea id="intervention" maxlength="1200" rows="2" placeholder="Introduce a new perspective, ask a question, or challenge an assumption…"></textarea><div class="composer-footer"><span class="small muted" id="queueCount">${state.pendingNotes.length?`${state.pendingNotes.length} queued for next round`:"Your input joins at the next round boundary"}</span><button class="btn primary" type="submit">Add to debate</button></div></form><p class="composer-hint">Each model sees the same intervention. Existing turns keep their original rules.</p>`;
  }
  function workspaceMarkup() {
    return `<section class="conversation" aria-label="Debate transcript">${topicMarkup()}<div id="runControls">${controlsMarkup()}</div><div class="transcript" id="transcript" tabindex="0" aria-label="Debate messages">${transcriptMarkup()}</div><div class="composer-wrap">${composerMarkup()}</div></section>`;
  }
  function roundtableMarkup() {
    return `<section class="meeting" aria-label="Roundtable">${topicMarkup()}<div class="arena" id="arena">${arenaMarkup()}</div><div class="floor"><div class="floor-heading"><span>The floor is open</span><button data-action="transcript">Read full transcript</button></div><div class="speech-card" id="speech">${speechMarkup()}</div></div><div class="meeting-bottom"><div id="runControls">${controlsMarkup()}</div><div style="height:14px"></div>${composerMarkup()}</div></section>`;
  }
  function arenaMarkup() {
    const speaker = state.activeMessage?.model;
    return `<div class="orbit"><div class="orbit-center"><div class="eyebrow">${state.status==="running"?"In conversation":"A room for perspective"}</div><div class="round-no">Round ${String(state.round).padStart(2,"0")}</div><div class="round-phase">${phase()}</div></div></div>${state.participants.map((m,i)=>`<button class="seat seat-${i}${speaker===m.id?" speaking":""}" data-model="${m.id}" aria-label="Inspect ${m.name}'s perspective">${avatar(m)}<span><strong>${m.name}</strong><small>${escape(m.role)}</small></span></button>`).join("")}`;
  }
  function speechMarkup() {
    const message = state.activeMessage || [...state.messages].reverse().find(m=>m.model!=="user");
    return message?messageMarkup(message,true):'<p class="empty">Start the debate to hear an opening perspective.</p>';
  }
  function mapMarkup() {
    return `<aside class="issues" aria-label="Discussion threads"><p class="eyebrow">Discussion threads</p><div id="issueList">${issuesMarkup()}</div><div class="divider"></div><p class="eyebrow">Session</p><div id="mapMetrics">${metricsMarkup()}</div><p class="issue-hint">Click an argument to inspect both positions. Challenge it to steer the next round.</p><button class="btn" data-action="summary">${icon("book")}Checkpoint</button></aside><section class="map-workspace" aria-label="Argument map"><div class="map-tools"><div class="map-filter" role="group" aria-label="Filter arguments">${["all","open","agreed"].map(f=>`<button data-filter="${f}" class="${state.filter===f?"active":""}" aria-pressed="${state.filter===f}">${f==="all"?"All arguments":f==="open"?"Disputed":"Shared"}</button>`).join("")}</div><div class="row"><button class="icon-btn" data-action="zoom-out" aria-label="Zoom out">${icon("minus")}</button><button class="small muted" data-action="zoom-reset" title="Reset zoom" id="zoomLabel">100%</button><button class="icon-btn" data-action="zoom-in" aria-label="Zoom in">${icon("plus")}</button></div></div><div class="map-stage" id="mapStage"><div class="map-canvas" id="mapCanvas">${nodesMarkup()}</div></div><div class="map-legend"><div class="legend-items"><span><i class="legend-line"></i>Challenges</span><span><i class="legend-line support"></i>Supports</span></div><button data-action="transcript">Read transcript · <span id="turnCount">${state.totalTurns}</span> turns</button></div><div class="map-composer">${composerMarkup()}</div></section>`;
  }
  function issuesMarkup() {
    return claimData().slice(1).map((claim)=>`<button class="issue ${state.selectedClaim===claim.id?"active":""}" data-claim="${claim.id}" aria-pressed="${state.selectedClaim===claim.id}"><strong>${escape(claim.title)}</strong><span><i class="issue-dot"></i>${claim.status==="agreed"?"Provisional agreement":"Open thread"} · ${claim.round}</span></button>`).join("");
  }
  function nodesMarkup() {
    const visible = claimData().filter(c=>state.filter==="all"||state.filter==="open"&&c.status==="open"||state.filter==="agreed"&&c.status==="agreed");
    const ids = new Set(visible.map(c=>c.id));
    const edges = [["question","speed","M28 17C57 17 44 35 73 35",""],["speed","ceiling","M73 35C47 35 54 54 27 54",""],["ceiling","evidence","M27 54C55 54 45 78 73 78","dashed"],["ceiling","shared","M27 54V89","support"],["evidence","shared","M73 78C49 78 55 89 27 89","support dashed"]];
    return `<svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${edges.filter(([a,b])=>ids.has(a)&&ids.has(b)).map(([,,d,cls])=>`<path d="${d}" class="${cls}" vector-effect="non-scaling-stroke"/>`).join("")}</svg>${visible.map(c=>`<button class="map-node ${c.id==="question"?"root":""} ${c.status==="agreed"?"agreed":""} ${state.selectedClaim===c.id?"selected":""}" style="left:${c.x}%;top:${c.y}%" data-claim="${c.id}" aria-pressed="${state.selectedClaim===c.id}"><span class="node-kind">${c.status==="agreed"?"✓":"◦"} ${c.kind}</span><strong>${escape(c.title)}</strong><span class="node-meta"><span class="mini-avatar">${c.id==="evidence"?"✦":"C"}</span><span class="mini-avatar">${c.status==="agreed"?"D":"G"}</span>${c.round}</span></button>`).join("")}`;
  }
  function metricsMarkup() {
    return `<div class="metric-row"><div class="metric"><strong>${String(state.round).padStart(2,"0")}</strong><small>ROUND</small></div><div class="metric"><strong>${state.totalTurns}</strong><small>TURNS</small></div><div class="metric"><strong>$${state.cost.toFixed(2)}</strong><small>DEMO EST.</small></div></div>`;
  }
  function inspectorMarkup() {
    return `<aside class="inspector" aria-label="Live brief"><div class="panel-tabs"><button data-tab="brief" class="${state.inspectorTab==="brief"?"active":""}">${view==="argument-map"?"Argument detail":"Live brief"}</button><button data-tab="rules" class="${state.inspectorTab==="rules"?"active":""}">Ground rules</button></div><div id="inspectorBody">${inspectorBody()}</div></aside>`;
  }
  function inspectorBody() {
    if(state.inspectorTab==="rules") return rulesMarkup();
    if(view==="argument-map") return argumentDetailMarkup();
    return `<div class="panel-title"><h3>The discussion so far</h3><span>Not a verdict</span></div><p class="panel-copy">${state.topic==="Should startups stay small in the age of AI?"?"More leverage, fewer handoffs. But who owns the extra review work?":"A scripted study of assumptions, counterexamples, and evidence gaps for your question."}</p>${metricsMarkup()}<div class="panel-section"><div class="panel-title"><h3>At the table</h3><span>${state.participants.length} models</span></div>${participantsMarkup()}</div><div class="panel-section"><div class="panel-title"><h3>Where they disagree</h3><span>${claimData().filter(c=>c.status==="open"&&c.id!=="question").length} threads</span></div>${claimData().filter(c=>["ceiling","evidence"].includes(c.id)).map(c=>`<button class="claim-card" data-claim="${c.id}"><span class="claim-tag">${c.kind}</span><strong>${escape(c.title)}</strong><small>${c.round} · Inspect the positions</small></button>`).join("")}</div>${checkpointMarkup()}<p class="panel-copy" style="font-size:10px;margin-top:17px">Scripted claims and estimated usage. Agreement is not evidence of correctness.</p>`;
  }
  function participantsMarkup() {
    return state.participants.map(m=>`<button class="participant ${state.activeMessage?.model===m.id?"speaking":""}" data-model="${m.id}" style="width:100%;text-align:left">${avatar(m)}<span class="details"><strong>${m.name}</strong><span>${escape(m.role)}</span></span><span class="speaker-status">${state.activeMessage?.model===m.id?"Speaking":"Listening"}</span></button>`).join("");
  }
  function checkpointMarkup() {
    return `<div class="checkpoint"><div class="row">${icon("layers")}A checkpoint, not an ending</div><p>${state.checkpoint?`Round ${state.checkpoint.round} checkpoint is ready.`:`A fresh brief every ${state.checkpointEvery} rounds.`} Shared ground and unresolved questions stay side by side.</p><button data-action="summary">${state.checkpoint?"Read checkpoint":"Capture a checkpoint"}</button></div>`;
  }
  function rulesMarkup() {
    return `<div class="panel-title"><h3>Ground rules</h3><span>Version ${state.ruleVersion}</span></div><p class="panel-copy">One shared protocol. Each completed turn keeps its original rule version.</p><div class="rule-item"><span>Format</span><strong>${escape(state.template)}</strong></div><div class="rule-item"><span>Duration</span><strong>Until you stop</strong></div><div class="rule-item"><span>Opening</span><strong>${state.blind?"Independent / blind":"Visible to everyone"}</strong></div><div class="rule-item"><span>Turn order</span><strong>${state.rotate?"Rotates each round":"Fixed order"}</strong></div><div class="rule-item"><span>Turn budget</span><strong>${state.length} words</strong></div><div class="rule-item"><span>Checkpoint</span><strong>Every ${state.checkpointEvery} rounds</strong></div><div class="rule-text">${escape(state.rules)}</div>${state.pendingRules?'<div class="banner">A new rule version is queued for the next round.</div>':""}<button class="btn" data-action="rules">${icon("settings")}Edit for next round</button><div class="divider"></div><p class="panel-copy">Continuous scheduling does not mean an unlimited prompt. A rolling brief, open claims, recent turns, and original quotations form each next context.</p>`;
  }
  function argumentDetailMarkup() {
    const c = claimData().find(c=>c.id===state.selectedClaim) || claimData()[2];
    return `<section class="argument-detail"><p class="eyebrow">${c.kind}</p><h2>${escape(c.title)}</h2><div class="row"><span class="chip ${c.status==="agreed"?"green":"purple"}">${c.status==="agreed"?"Provisional agreement":"Still unresolved"}</span><span class="small muted">${c.round}</span></div><p style="margin:17px 0">${escape(c.description)}</p><div class="panel-title"><h3>The positions</h3><span>Scripted sample</span></div><div class="stance"><div class="row">${avatar(models[0])}<strong>Claude · Supports</strong></div><p>${escape(c.support)}</p></div><div class="stance"><div class="row">${avatar(models[1])}<strong>GPT · Challenges</strong></div><p>${escape(c.challenge)}</p></div><button class="btn primary" style="width:100%;margin:9px 0 22px" data-action="challenge">${icon("debate")}Challenge this argument</button><div class="panel-title"><h3>Trace the discussion</h3></div><p>Every claim should link to an exact completed turn. This study uses scripted positions to demonstrate the interaction.</p><button class="btn ghost" data-action="transcript" style="padding-left:0;margin:8px 0 23px">${icon("quote")}Inspect the transcript</button></section>${checkpointMarkup()}`;
  }
  function messageMarkup(message,compact=false) {
    if(message.model==="user") return `<article class="message user" id="msg-${message.id}"><div class="message-head"><strong>You · ${message.round>state.round?"Queued intervention":"Intervention"}</strong></div><p class="message-body">${escape(message.text)}</p></article>`;
    const m = state.participants.find(m=>m.id===message.model)||models.find(m=>m.id===message.model);
    return `<article class="${compact?"":"message"}" id="${compact?"floor-":"msg-"}${message.id}"><div class="message-head">${avatar(m)}<div class="identity"><strong>${m.name}</strong><div class="role-label">${escape(message.role||m.role)} · ${escape(m.provider)}</div></div><time>Round ${String(message.round).padStart(2,"0")} · v${message.version||1}</time></div><div class="message-body" id="body-${compact?"floor-":""}${message.id}">${message.ref?`<span class="ref">Responding to ${escape(models.find(m=>m.id===message.ref)?.name||message.ref)}</span>\n`:""}${escape(message.text)}${message.complete?"":'<span class="typing" aria-label="Generating"></span>'}</div>${message.complete?`<div class="message-foot"><span class="chip ${message.tag==="Evidence needed"?"orange":"purple"}">${escape(message.tag||"A new angle")}</span><button data-quote="${message.id}" title="Use this turn in an intervention">${icon("quote")}Challenge</button></div>`:""}</article>`;
  }
  function transcriptMarkup() {
    let lastRound = null;
    return `${state.lastArchive?'<div class="system-event">Earlier turns have been folded into the rolling demo brief. The most recent 96 turns stay in this window.</div>':""}${state.messages.map(message=>{
      const divider = message.round!==lastRound?`<div class="round-divider">Round ${String(message.round).padStart(2,"0")} · ${phaseNames[Math.min(message.round-1,3)]}</div>`:"";
      lastRound=message.round;
      return divider+messageMarkup(message);
    }).join("")}`;
  }
  function refreshControls() {
    const target = view==="argument-map"?$("#liveTop"):$("#runControls");
    target.innerHTML=controlsMarkup();
    const input = $("#intervention");
    input.disabled=state.status==="stopped";
    $("#interventionForm button").disabled=state.status==="stopped";
    $("#queueCount").textContent=state.status==="stopped"?"Session ended":state.pendingNotes.length?`${state.pendingNotes.length} queued for next round`:"Your input joins at the next round boundary";
    $("#queuePreview").innerHTML=state.pendingNotes.map(note=>`<div class="pending-note"><span><b>${state.status==="stopped"?"Not applied":"Next round"}</b> ${escape(note.text)}</span>${state.status!=="stopped"?`<button data-remove-note="${note.id}" aria-label="Remove queued intervention">${icon("close")}</button>`:""}</div>`).join("");
  }
  function refreshSide() {
    $("#inspectorBody").innerHTML=inspectorBody();
    if(view==="argument-map") {
      $("#issueList").innerHTML=issuesMarkup();
      $("#mapMetrics").innerHTML=metricsMarkup();
      $("#turnCount").textContent=state.totalTurns;
    }
    if(view==="roundtable") $("#arena").innerHTML=arenaMarkup();
  }
  function refreshMessages(forceScroll=false) {
    if(view==="workspace") {
      const transcript=$("#transcript");
      const follow=forceScroll||transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<100;
      transcript.innerHTML=transcriptMarkup();
      if(follow) transcript.scrollTop=transcript.scrollHeight;
    } else if(view==="roundtable") $("#speech").innerHTML=speechMarkup();
  }
  function refreshTopic() {
    $("#topicText").textContent=state.topic;
    $("#modelCount").textContent=`${state.participants.length} perspectives`;
    $("#ruleTag").textContent=`Ground rules · v${state.ruleVersion}`;
    if(view==="argument-map") $("#mapCanvas").innerHTML=nodesMarkup();
  }
  function setupDialog(kind="new") {
    state.setupKind=kind;
    const editing=kind==="rules";
    const d=$("#setupDialog");
    d.innerHTML=`<form id="setupForm"><header class="dialog-head"><div><h2 id="setupTitle">${editing?"Shape the next round":"Make room for a debate"}</h2><p>${editing?"Changes apply together at the next round boundary.":"A question, a few perspectives, and room to keep going."}</p></div><button class="icon-btn" data-close type="button" aria-label="Close setup">${icon("close")}</button></header><div class="dialog-body"><div class="form-grid"><div class="field full"><label for="topic">The question</label><textarea id="topic" name="topic" rows="2" maxlength="500" required ${editing?"readonly":""}>${escape(state.topic)}</textarea><span class="help">${editing?"The topic and participants are fixed for this session. Start a new debate to change them.":"Use your own topic. Non-default topics use generic scripted responses in this demo."}</span></div><div class="field full"><span class="field-label">Discussion format</span><div class="template-grid" role="group" aria-label="Discussion format">${[["Open inquiry","Explore competing perspectives"],["For & against","A proposition, opposition, and scrutiny"],["Stress test","Rotate the challenger each round"]].map(([name,desc])=>`<button type="button" class="template ${name===state.template?"active":""}" data-template="${name}" aria-pressed="${name===state.template}"><strong>${name}</strong><span>${desc}</span></button>`).join("")}</div><input type="hidden" name="template" value="${escape(state.template)}"></div>
      ${editing?"":`<div class="field full"><span class="field-label">Choose 2–4 model seats</span><div class="model-grid">${models.map(m=>`<div class="model-option"><input type="checkbox" name="model" value="${m.id}" id="model-${m.id}" ${state.participants.some(p=>p.id===m.id)?"checked":""}><label for="model-${m.id}" class="model-info"><strong>${m.name}</strong><small>${m.provider}</small></label>${avatar(m)}<label class="sr-only" for="role-${m.id}">${m.name} role</label><select name="role-${m.id}" id="role-${m.id}">${roles.map(role=>`<option ${role===(state.participants.find(p=>p.id===m.id)?.role||m.role)?"selected":""}>${role}</option>`).join("")}</select></div>`).join("")}</div><span class="help">Illustrative model families; availability and exact model IDs would come from Cove's catalog.</span></div>`}
      <div class="field full"><label for="rules">Your ground rules</label><textarea id="rules" name="rules" rows="4" required maxlength="3000">${escape(state.rules)}</textarea></div><div class="field"><label for="length">Turn budget</label><select id="length" name="length">${[100,180,300].map(n=>`<option value="${n}" ${state.length===n?"selected":""}>Up to ${n} words</option>`).join("")}</select></div><div class="field"><label for="checkpoint">Checkpoint cadence</label><select id="checkpoint" name="checkpoint">${[2,3,5].map(n=>`<option value="${n}" ${state.checkpointEvery===n?"selected":""}>Every ${n} rounds</option>`).join("")}</select></div><label class="toggle-row"><input type="checkbox" name="blind" ${state.blind?"checked":""} ${editing?"disabled":""}>Blind independent opening</label><label class="toggle-row"><input type="checkbox" name="rotate" ${state.rotate?"checked":""}>Rotate first speaker each round</label></div><div class="banner">Continuous means no automatic round or consensus limit. Each turn remains bounded. Pause finishes the active turn; Stop cancels immediately. Model text, prices, and protocol execution are simulated here.</div><p class="error-text" id="setupError" role="alert"></p></div><footer class="dialog-foot"><span class="small muted">${editing?`Currently on rule version ${state.ruleVersion}`:"No API keys. No real inference costs."}</span><div class="row"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${editing?"Apply next round":"Start this debate"}</button></div></footer></form>`;
    d.showModal();
  }
  function submitSetup(form) {
    const data=new FormData(form);
    const ids=data.getAll("model");
    if(state.setupKind!=="rules"&&(ids.length<2||ids.length>4)) {$("#setupError").textContent="Choose between two and four model seats.";return;}
    if(!String(data.get("topic")).trim()||!String(data.get("rules")).trim()) {$("#setupError").textContent="Add a question and at least one ground rule.";return;}
    const settings={rules:String(data.get("rules")).trim(),template:String(data.get("template")),length:Number(data.get("length")),checkpointEvery:Number(data.get("checkpoint")),rotate:data.has("rotate")};
    if(state.setupKind==="rules") {
      if(state.status==="stopped") {toast("Start a new session to use different rules.");$("#setupDialog").close();return;}
      if(state.pendingRules) settings.version=state.pendingRules.version;
      else settings.version=state.ruleVersion+1;
      state.pendingRules=settings;
      toast(`Rules v${settings.version} queued for round ${state.round+1}.`);
    } else {
      cancelTimers();
      Object.assign(state,settings,{topic:String(data.get("topic")).trim(),participants:models.filter(m=>ids.includes(m.id)).map(m=>({...m,role:String(data.get(`role-${m.id}`))})),round:1,turn:0,ruleVersion:1,pendingRules:null,pendingNotes:[],interventions:[],messages:[],events:[],checkpoint:null,cost:0,calls:0,totalTurns:0,lastArchive:0,activeMessage:null,status:"ready",blind:data.has("blind"),stepOnly:false});
      refreshTopic();refreshMessages();
    }
    $("#setupDialog").close();refreshSide();refreshControls();
    if(state.setupKind!=="rules") start();
  }
  function detailDialog(title,body,footer="") {
    const d=$("#detailDialog");
    if(d.open) d.close();
    d.innerHTML=`<header class="dialog-head"><div><h2 id="detailTitle">${escape(title)}</h2><p>A local, scripted interaction study</p></div><button class="icon-btn" data-close aria-label="Close detail">${icon("close")}</button></header><div class="dialog-body">${body}</div>${footer?`<footer class="dialog-foot">${footer}</footer>`:""}`;
    d.showModal();
  }
  function showSummary(stopped=false) {
    state.checkpoint={round:state.round,turns:state.totalTurns,cost:state.cost};
    const custom=state.topic!=="Should startups stay small in the age of AI?";
    detailDialog(stopped?"A stopping point. Not a final verdict.":`Checkpoint · Round ${String(state.round).padStart(2,"0")}`,`<span class="chip green">${stopped?"Stopped by you":"Debate keeps its current state"}</span><h2 style="margin:16px 0;line-height:1.5">${escape(state.topic)}</h2><div class="summary-grid"><div class="summary-box"><h3>Shared ground</h3><p>${custom?"Keep assumptions explicit and define what evidence would change a position.":"Hire around a demonstrated bottleneck. AI output alone does not establish customer value."}</p></div><div class="summary-box"><h3>Still unresolved</h3><p>${custom?"The sample does not resolve your topic. Real model responses and source-linked claims are a future implementation.":"Can focused ownership absorb the review work? What minimum coverage does the business need?"}</p></div></div><h3 style="margin:10px 0">A useful next question</h3><p class="panel-copy">${custom?"Which assumption has not been challenged, and what concrete counterexample would test it?":"What would a six-week pilot need to show before you hire, stay small, or narrow the product?"}</p><div class="summary-grid"><div class="summary-box"><span class="big">${state.totalTurns}</span><p>Completed demo turns · ${state.calls} simulated calls</p></div><div class="summary-box"><span class="big">$${state.cost.toFixed(3)}</span><p>Synthetic cost · not a provider bill</p></div></div>${state.pendingNotes.length?`<div class="banner">${state.pendingNotes.length} queued intervention(s) ${stopped?"were not applied before stopping":"will join at the next round boundary"}.${stopped?state.pendingNotes.map(n=>`<p style="margin-top:9px">${escape(n.text)}</p>`).join(""):""}</div>`:""}<p class="panel-copy">No truth score or automatic winner. A checkpoint preserves shared positions, minority views, and unanswered questions.</p>`,`<button class="btn" data-action="export">${icon("download")}Export transcript</button><button class="btn primary" data-close>${stopped?"Done":"Back to debate"}</button>`);
    refreshSide();
  }
  function inspectClaim(id) {
    state.selectedClaim=id;
    if(view==="argument-map") {
      state.inspectorTab="brief";refreshSide();$("#mapCanvas").innerHTML=nodesMarkup();
      $$("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab==="brief"));
      if(innerWidth>760) return;
    }
    const c=claimData().find(c=>c.id===id);
    detailDialog(c.title,`<span class="chip purple">${escape(c.kind)}</span><p class="panel-copy" style="margin-top:20px">${escape(c.description)}</p><div class="summary-grid"><div class="summary-box"><h3>Supports</h3><p>${escape(c.support)}</p></div><div class="summary-box"><h3>Challenges</h3><p>${escape(c.challenge)}</p></div></div><p class="panel-copy">These positions are scripted to demonstrate the interface. Real claim extraction must cite exact completed turns.</p>`,`<button class="btn" data-action="transcript">${icon("quote")}Read transcript</button><button class="btn primary" data-action="challenge">Challenge this</button>`);
  }
  function inspectModel(id) {
    const m=state.participants.find(p=>p.id===id);
    const messages=state.messages.filter(message=>message.model===id);
    detailDialog(`${m.name} · ${m.role}`,`<div class="row">${avatar(m,true)}<div><strong>${escape(m.provider)}</strong><p class="small muted">Illustrative model family · Role is distinct from model identity</p></div></div><div class="divider"></div><h3>Latest completed perspective</h3>${messages.filter(t=>t.complete).slice(-1).map(t=>`<blockquote class="quote">${escape(t.text)}</blockquote>`).join("")||'<p class="empty">No completed turn yet.</p>'}<p class="panel-copy" style="margin-top:20px">Each generation would retain its Provider Snapshot, model ID, rule version, and context references. Model changes require a new debate session.</p>`,`<button class="btn primary" data-close>Back to the table</button>`);
  }
  function showTranscript() {
    if(view==="workspace") {$("#transcript").focus();$("#transcript").scrollTop=$("#transcript").scrollHeight;return;}
    detailDialog("The discussion, turn by turn",transcriptMarkup(),'<button class="btn primary" data-close>Back to debate</button>');
  }
  function cancelTimers() {
    state.epoch++;
    clearTimeout(state.timer);clearInterval(state.streamTimer);
    state.timer=null;state.streamTimer=null;
  }
  function order() {
    const offset=state.rotate?(state.round-1)%state.participants.length:0;
    return [...state.participants.slice(offset),...state.participants.slice(0,offset)];
  }
  function start(oneTurn=false) {
    if(state.status==="stopped") {setupDialog();return;}
    state.status="running";state.stepOnly=oneTurn;
    refreshControls();runTurn();
  }
  function pause() {
    if(state.activeMessage) {state.status="pausing";toast("The active turn will finish. No next turn will start.");}
    else {clearTimeout(state.timer);state.status="paused";toast("Paused. Resume when you are ready.");}
    refreshControls();
  }
  function applyBoundary() {
    if(state.pendingRules) {
      const next=state.pendingRules;Object.assign(state,next);state.ruleVersion=next.version;state.pendingRules=null;
      state.events.push({round:state.round,type:"rules",version:state.ruleVersion,text:state.rules});
      toast(`Round ${state.round} now uses rules v${state.ruleVersion}.`);refreshTopic();
    }
    if(state.pendingNotes.length) {
      state.pendingNotes.forEach(note=>{
        const applied={...note,round:state.round,applied:true};state.messages.push(applied);state.interventions.push(applied);
      });
      state.pendingNotes=[];refreshMessages();
    }
    // Keep demo memory bounded while scheduling an unlimited number of rounds.
    if(state.messages.length>96) {state.lastArchive+=state.messages.length-96;state.messages=state.messages.slice(-96);}
    state.interventions=state.interventions.slice(-12);state.events=state.events.slice(-48);
  }
  function responseFor(model) {
    const lastNote=state.interventions.at(-1);
    let text;
    if(state.topic==="Should startups stay small in the age of AI?") text=scripts[model.id][(state.round-1)%4];
    else {
      const roleText={Advocate:"I will state the strongest supporting case, name its central assumption, and say what would change my view.",Challenger:"I will test the strongest claim with a counterexample and separate a plausible story from a supported conclusion.","Evidence analyst":"I will ask which claims are observable, what sources are missing, and how a fair test would be designed.",Synthesizer:"I will preserve the minority view, distinguish agreement from evidence, and identify the next unresolved question.","First principles":"I will define the terms, work back to constraints, and check which assumptions are actually required.","Risk analyst":"I will identify a concrete failure scenario, who bears the cost, and which decision is hardest to reverse."};
      text=`On “${state.topic.slice(0,160)}”: ${roleText[model.role]} This is a scripted role sample, not an answer generated for your question.`;
    }
    if(lastNote&&lastNote.round===state.round) text=`Your intervention is now in this round's shared context: “${lastNote.text.slice(0,140)}”. ${text}`;
    if(state.ruleVersion>1) text=`Using ground rules v${state.ruleVersion}. ${text}`;
    if(state.template==="Stress test") text=`${state.turn===0?"Attacker":"Defender"} this round. ${text}`;
    const words=text.split(/\s+/);
    return words.slice(0,state.length).join(" ");
  }
  function runTurn() {
    if(state.status!=="running"||state.activeMessage) return;
    if(state.turn>=state.participants.length) {
      if(state.round%state.checkpointEvery===0) {state.checkpoint={round:state.round,turns:state.totalTurns,cost:state.cost};toast(`Checkpoint for round ${state.round} captured. The debate continues.`);}
      state.round++;state.turn=0;applyBoundary();
    }
    const current=order()[state.turn];
    const prior=[...state.messages].reverse().find(m=>m.model!=="user"&&m.complete);
    const full=responseFor(current);
    const blind=state.round===1&&state.blind;
    const message={id:`turn-${state.epoch}-${state.totalTurns+1}`,model:current.id,role:current.role,round:state.round,version:state.ruleVersion,text:"",complete:false,ref:!blind?prior?.model:null,tag:current.role.includes("Evidence")?"Evidence needed":current.role.includes("Challenger")?"Challenges a claim":current.role.includes("Synthesizer")?"Connects the positions":"A new angle"};
    state.messages.push(message);state.activeMessage=message;
    if(state.messages.length>96) {state.lastArchive+=state.messages.length-96;state.messages=state.messages.slice(-96);}
    const epoch=state.epoch;let cursor=0;
    refreshMessages();refreshSide();refreshControls();
    state.streamTimer=setInterval(()=>{
      if(epoch!==state.epoch) return;
      cursor=Math.min(full.length,cursor+14);message.text=full.slice(0,cursor);
      const body=$(view==="roundtable"?`#body-floor-${message.id}`:`#body-${message.id}`);
      if(body) {
        const pane=$("#transcript");const follow=pane&&pane.scrollHeight-pane.scrollTop-pane.clientHeight<100;
        body.innerHTML=`${message.ref?`<span class="ref">Responding to ${escape(models.find(m=>m.id===message.ref)?.name||message.ref)}</span>\n`:""}${escape(message.text)}<span class="typing" aria-label="Generating"></span>`;
        if(follow) pane.scrollTop=pane.scrollHeight;
      }
      if(cursor>=full.length) completeTurn(message,epoch);
    },45);
  }
  function completeTurn(message,epoch) {
    clearInterval(state.streamTimer);state.streamTimer=null;
    if(epoch!==state.epoch) return;
    message.complete=true;state.activeMessage=null;state.calls++;state.totalTurns++;state.cost+=.003+message.text.length*.000001;state.turn++;
    if(state.status==="pausing"||state.stepOnly) {state.status="paused";state.stepOnly=false;}
    refreshMessages();refreshControls();refreshSide();
    if(state.status==="running") state.timer=setTimeout(()=>runTurn(),1400);
  }
  function stop() {
    if(!["running","pausing","paused"].includes(state.status)) return;
    cancelTimers();
    if(state.activeMessage) state.messages=state.messages.filter(m=>m!==state.activeMessage);
    state.activeMessage=null;state.status="stopped";
    refreshMessages();refreshControls();refreshSide();showSummary(true);
  }
  function addIntervention(text) {
    if(!text.trim()) {toast("Add a question or a perspective first.");return;}
    if(state.status==="stopped") {toast("Start a new debate to add an intervention.");return;}
    if(state.pendingNotes.length>=8) {toast("Eight interventions are already queued. Let the next round begin first.");return;}
    const note={id:`note-${state.epoch}-${Date.now()}-${state.pendingNotes.length}`,model:"user",text:text.trim().slice(0,1200),round:state.round+1,complete:true};
    state.pendingNotes.push(note);$("#intervention").value="";refreshControls();
    toast(`Your intervention is queued for round ${state.round+1}.`);
  }
  function exportTranscript() {
    const text=["# Cove Debate - scripted prototype",`Topic: ${state.topic}`,`State: ${state.status}; round: ${state.round}`,"All responses and costs are synthetic. No model calls were made.","This export includes the most recent 96 turns, not an unbounded archive.","",`## Current ground rules (v${state.ruleVersion})`,state.rules,"",...state.messages.filter(m=>m.complete).map(m=>`## Round ${m.round} - ${m.model==="user"?"You":models.find(p=>p.id===m.model).name} (rules v${m.version||1})\n\n${m.text}\n`),...(state.pendingNotes.length?["## Unapplied interventions",...state.pendingNotes.map(n=>n.text)]:[])].join("\n");
    const url=URL.createObjectURL(new Blob([text],{type:"text/markdown;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="cove-debate-demo.md";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast("Demo transcript exported.");
  }
  function challenge() {
    const claim=claimData().find(c=>c.id===state.selectedClaim);
    if($("#detailDialog").open) $("#detailDialog").close();
    $("#intervention").value=`Challenge this claim: "${claim.title}" What evidence would overturn it?`;
    $("#intervention").focus();
  }
  const actions={
    setup:()=>setupDialog(),rules:()=>setupDialog("rules"),overview:()=>detailDialog("An ongoing debate, on your terms",'<p class="panel-copy">Choose two to four model seats and a role for each. Open with independent perspectives, then rotate through claims, counterarguments, evidence, and new angles. The discussion continues until you stop it.</p><div class="divider"></div><p class="panel-copy">This prototype serializes visual playback. A real blind opening would run concurrently with no cross-visibility, then publish the complete opening set together. Pause finishes one active turn. Stop discards an incomplete turn. All text and prices here are synthetic.</p>'),
    summary:()=>showSummary(),transcript:showTranscript,export:exportTranscript,challenge,
    toggle:()=>state.status==="running"?pause():start(),step:()=>start(true),stop,
    "zoom-in":()=>zoom(.15),"zoom-out":()=>zoom(-.15),"zoom-reset":()=>zoom(0,true)
  };
  function zoom(delta,reset=false) {
    state.zoom=reset?1:Math.min(1.3,Math.max(.7,state.zoom+delta));
    $("#mapCanvas").style.transform=`scale(${state.zoom})`;$("#zoomLabel").textContent=`${Math.round(state.zoom*100)}%`;
  }
  $("#app").innerHTML=rootMarkup();
  document.addEventListener("click",event=>{
    const close=event.target.closest("[data-close]");
    if(close) {event.preventDefault();close.closest("dialog").close();return;}
    const removeNote=event.target.closest("[data-remove-note]");
    if(removeNote) {state.pendingNotes=state.pendingNotes.filter(n=>n.id!==removeNote.dataset.removeNote);refreshControls();toast("Queued intervention removed.");return;}
    const action=event.target.closest("[data-action]");
    if(action) {event.preventDefault();actions[action.dataset.action]?.();return;}
    const tab=event.target.closest("[data-tab]");
    if(tab) {state.inspectorTab=tab.dataset.tab;$$("[data-tab]").forEach(b=>b.classList.toggle("active",b===tab));refreshSide();return;}
    const claim=event.target.closest("[data-claim]");
    if(claim) {inspectClaim(claim.dataset.claim);return;}
    const model=event.target.closest("[data-model]");
    if(model) {inspectModel(model.dataset.model);return;}
    const filter=event.target.closest("[data-filter]");
    if(filter) {state.filter=filter.dataset.filter;$$("[data-filter]").forEach(b=>{b.classList.toggle("active",b===filter);b.setAttribute("aria-pressed",b===filter);});$("#mapCanvas").innerHTML=nodesMarkup();return;}
    const template=event.target.closest("[data-template]");
    if(template) {$("[name=template]",$("#setupDialog")).value=template.dataset.template;$$("[data-template]").forEach(b=>{b.classList.toggle("active",b===template);b.setAttribute("aria-pressed",b===template);});return;}
    const quote=event.target.closest("[data-quote]");
    if(quote) {const message=state.messages.find(m=>m.id===quote.dataset.quote);if($("#detailDialog").open) $("#detailDialog").close();$("#intervention").value=`On ${models.find(m=>m.id===message.model).name}'s point: "${message.text.slice(0,220)}"\nMy challenge: `;$("#intervention").focus();}
  });
  document.addEventListener("submit",event=>{
    event.preventDefault();
    if(event.target.id==="setupForm") submitSetup(event.target);
    else if(event.target.id==="interventionForm") addIntervention($("#intervention").value);
  });
  document.addEventListener("keydown",event=>{
    if(event.target.id==="intervention"&&event.key==="Enter"&&(event.metaKey||event.ctrlKey)&&!event.isComposing) {event.preventDefault();addIntervention(event.target.value);}
  });
  window.addEventListener("pagehide",cancelTimers);
  refreshMessages(true);
})();
