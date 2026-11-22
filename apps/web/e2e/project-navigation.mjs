export function projectNavigation({ click, until, evaluate, button, api }) {
  async function openProjects() {
    await click('button[aria-label="Projects"]');
    await until(
      "document.querySelector('[aria-label=\"Project workspace\"] h1')?.textContent==='Projects'",
    );
  }
  async function openProject(name) {
    await openProjects();
    const selector = `button[aria-label=${JSON.stringify(`Open project ${name}`)}]`;
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await click(selector);
    await until(
      "!!document.querySelector('[aria-label=\"Project background and materials\"]')",
    );
  }
  async function manageProject(name) {
    await openProject(name);
    await click('button[aria-label="Manage project context"]');
    await until(
      "!!document.querySelector('input[aria-label=\"Project name\"]')",
    );
  }
  async function returnToChat() {
    await button("Back to chat", '[aria-label="Project workspace"] button');
    await until(
      "!document.querySelector('[aria-label=\"Project workspace\"]')",
    );
  }
  async function openConversation(title) {
    const selector = `.conversation-list button[title=${JSON.stringify(title)}]`;
    if (
      await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
    ) {
      await click(selector);
    } else {
      const conversation = (await api("/api/conversations")).find(
        (c) => c.title === title,
      );
      if (!conversation?.project_id)
        throw new Error(`Missing conversation: ${title}`);
      const project = await api(`/api/projects/${conversation.project_id}`);
      await openProject(project.name);
      const projectChat = `[aria-label="Project chats"] button[title=${JSON.stringify(title)}]`;
      await until(`!!document.querySelector(${JSON.stringify(projectChat)})`);
      await click(projectChat);
    }
    await until(
      `document.querySelector('.masthead__title')?.getAttribute('title') === ${JSON.stringify(title)} && !!document.querySelector('#generation-input')`,
    );
  }
  async function moveConversation(name) {
    const title = await evaluate(
      "document.querySelector('.masthead__title')?.getAttribute('title')",
    );
    await click(
      `button[aria-label=${JSON.stringify(`Conversation actions: ${title}`)}]`,
    );
    await button("Move to project", '[role="menu"] button');
    await click(
      '[role="dialog"] [role="combobox"][aria-label="Move conversation to project"]',
    );
    await button(name, '[role="option"]');
    await button("Move conversation", '[role="dialog"] button');
    await until("!document.querySelector('[role=dialog]')");
  }
  return {
    openProjects,
    openProject,
    openConversation,
    manageProject,
    returnToChat,
    moveConversation,
  };
}
