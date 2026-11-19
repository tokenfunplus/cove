/** Pass selectors and labels as CDP data, never interpolated JavaScript. */
export async function markVisibleAction(cdp, selector, label, attribute) {
  const context = await cdp("Runtime.evaluate", { expression: "globalThis" });
  try {
    const result = await cdp("Runtime.callFunctionOn", {
      functionDeclaration: `function(selector, label, attribute) {
      const element = [...document.querySelectorAll(selector)].find(element =>
        element.textContent.trim() === label && element.getBoundingClientRect().width > 0);
      if (!element) return false;
      element.setAttribute(attribute, "true");
      return true;
    }`,
      objectId: context.result.objectId,
      arguments: [selector, label, attribute].map(value => ({ value })),
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error("Visible action lookup failed");
    return result.result.value;
  } finally {
    await cdp("Runtime.releaseObject", { objectId: context.result.objectId });
  }
}
