import { SidebarToggle } from "@/components/layout/SidebarToggle";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("sidebar toggle exposes reversible labels and directions", () => {
  const expanded = renderToStaticMarkup(
    <SidebarToggle collapsed={false} onToggle={() => {}} />,
  );
  const collapsed = renderToStaticMarkup(
    <SidebarToggle collapsed={true} onToggle={() => {}} />,
  );

  expect(expanded).toContain('aria-controls="conversation-sidebar"');
  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain('aria-label="Collapse sidebar"');
  expect(expanded).toContain("lucide-panel-left-close");
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).toContain('aria-label="Expand sidebar"');
  expect(collapsed).toContain("lucide-panel-left-open");
});

test("workspace header keeps only compact model controls in the main content area", () => {
  const markup = renderToStaticMarkup(
    <WorkspaceHeader
      profiles={[]}
      activeProviderId=""
      activeModelId=""
      catalog={{ status: "idle", models: [] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      connection="ready"
    />,
  );

  expect(markup).toContain('data-workspace-region="workspace-header"');
  expect(markup).not.toContain("workspace__model-icon");
  expect(markup).not.toContain("workspace__new-chat");
  expect(markup).toContain('data-workspace-model-controls="compact"');
  expect(markup).toContain("model-selector--nearai");
  expect(markup).toContain("Local session ready");
});

test("workspace header offers a deliberate private connection verification action", () => {
  const markup = renderToStaticMarkup(
    <WorkspaceHeader
      profiles={[]}
      activeProviderId="nearai"
      activeModelId="private-model"
      activeModelSet={[{ providerId: "nearai", modelId: "private-model" }]}
      catalog={{ status: "ready", models: ["private-model"] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      onVerifyPrivateConnection={() => {}}
      onOpenPrivateVerification={() => {}}
      connection="ready"
    />,
  );

  expect(markup).toContain('aria-label="Model Verification"');
  expect(markup).toContain("Model Verification");
});

test("workspace header exposes Privacy Status for an empty or loaded conversation", () => {
  const markup = renderToStaticMarkup(
    <WorkspaceHeader
      profiles={[]}
      activeProviderId=""
      activeModelId=""
      catalog={{ status: "idle", models: [] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      onOpenPrivacyStatus={() => {}}
      connection="ready"
    />,
  );
  expect(markup).toContain("Privacy Status");
});
