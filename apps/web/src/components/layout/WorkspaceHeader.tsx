import { resolvedThemePreference } from "@/theme/theme";
import { workspaceStyles } from "@/styles/workspace";
import { primitivesStyles } from "@/styles/primitives";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  type ActiveModelSet,
  type ActiveSelection,
  type ModelCatalogs,
  type ModelCatalogState,
} from "@/components/providers/model-selection";
import { ModelSelector } from "@/components/providers/ModelSelector";
import { type ConnectionState } from "@/lib/workspace-types";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { type ProviderProfile, type ThemePreference } from "@cove/api-contract";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  BadgeCheck,
  ChevronDown,
  Maximize,
  Minimize,
  Moon,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useEffect, useRef } from "react";

export function WorkspaceHeader({
	debateMode = false,
  focusMode = false,
  onEnterFocus,
  onExitFocus,
  profiles,
  activeProviderId,
  activeModelId,
  activeModelSet = [],
  catalog,
  catalogs,
  title,
  theme = "system",
  appearance,
  onToggleTheme,
  privacyLabel,
  privacyTone = "empty",
  onProviderChange,
  onModelChange,
  onTargetModelChange,
  onAddModel,
  onRemoveModel,
  onApplyModelSet,
  onVerifyPrivateConnection,
  onOpenPrivateVerification,
  onOpenPrivacyStatus,
  onOpenSidebar,
  connection,
  disabled = false,
  copy = englishConversationCopy,
}: {
	debateMode?: boolean;
  focusMode?: boolean;
  onEnterFocus?: () => void;
  onExitFocus?: () => void;
  profiles: ProviderProfile[];
  activeProviderId: string;
  activeModelId: string;
  activeModelSet?: ActiveModelSet;
  catalog: ModelCatalogState;
  catalogs?: ModelCatalogs;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onTargetModelChange?: (targetIndex: number, modelId: string) => void;
  onAddModel?: (profile: ProviderProfile, modelId: string) => void;
  onRemoveModel?: (target: ActiveSelection) => void;
  onApplyModelSet?: (targets: ActiveModelSet) => void;
  onVerifyPrivateConnection?: () => void;
  onOpenPrivateVerification?: () => void;
  onOpenPrivacyStatus?: () => void;
  onOpenSidebar?: () => void;
  title?: string;
  theme?: ThemePreference;
  appearance?: "light" | "dark";
  onToggleTheme?: () => void;
  privacyLabel?: string;
  privacyTone?: string;
  connection: ConnectionState;
  disabled?: boolean;
  copy?: ApplicationCopy;
}) {
  const effectiveTheme = appearance ?? resolvedThemePreference(theme);
  const enterFocusRef = useRef<HTMLButtonElement>(null);
  const exitFocusRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(false);
  useEffect(() => {
    if (previousFocus.current === focusMode) return;
    previousFocus.current = focusMode;
    // Conversation search deliberately moves focus into the restored sidebar.
    if (!focusMode && document.activeElement?.closest("#conversation-sidebar")) return;
    (focusMode ? exitFocusRef : enterFocusRef).current?.focus({ preventScroll: true });
  }, [focusMode]);
  return (
    <header
      className={cn(
        focusMode ? workspaceStyles.focusHeader : workspaceStyles.workspace_header,
        "workspace__header--nearai masthead",
      )}
      data-workspace-region="workspace-header"
      data-focus-mode={focusMode ? "true" : undefined}
    >
      {onOpenSidebar && !focusMode ? (
        <Button
          variant="outline"
          aria-controls="conversation-sidebar"
          aria-expanded="false"
          aria-label={copy.expandSidebar}
          className={workspaceStyles.masthead_sidebarOpen}
          onClick={onOpenSidebar}
          type="button"
        >
          <PanelLeftOpen aria-hidden="true" size={17} strokeWidth={1.8} />
        </Button>
      ) : null}
      <div className={focusMode ? workspaceStyles.focusIdentity : workspaceStyles.workspace_headerIdentity}>
        {focusMode && <span className={workspaceStyles.focusBadge}>{copy.focusMode}</span>}
        <div className={cn(workspaceStyles.masthead_eyebrow, focusMode && "hidden")} hidden={focusMode}>
          <span>{debateMode ? "Debate workspace" : copy.conversationSection}</span>
        </div>
        <div className={focusMode ? workspaceStyles.focusTitle : workspaceStyles.masthead_title} title={title}>
          {title ?? copy.chatSurface}
        </div>
        {focusMode && !debateMode && activeModelSet.length > 0 && (
          <span className={workspaceStyles.focusModel} title={activeModelSet.map((target) => target.modelId).join(", ")}>
            {activeModelSet.length > 1 ? `${copy.modelComparison} · ${activeModelSet.length}` : activeModelId}
          </span>
        )}
      </div>
      <div
        className={focusMode || debateMode ? "hidden" : workspaceStyles.workspace_headerModel}
        hidden={focusMode || debateMode}
        data-workspace-model-controls="compact"
      >
        <ModelSelector
          trailingAction={onEnterFocus && !debateMode ? (
            <Button
              ref={enterFocusRef}
              type="button"
              variant="outline"
              className={workspaceStyles.focusEnter}
              aria-label={copy.enterFocus}
              title={copy.enterFocus}
              onClick={onEnterFocus}
            >
              <Maximize aria-hidden="true" size={17} strokeWidth={1.8} />
            </Button>
          ) : undefined}
          profiles={profiles}
          activeProviderId={activeProviderId}
          activeModelId={activeModelId}
          activeModelSet={activeModelSet}
          catalog={catalog}
          catalogs={catalogs}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onTargetModelChange={onTargetModelChange}
          onAddModel={onAddModel}
          onRemoveModel={onRemoveModel}
          onApplyModelSet={onApplyModelSet}
          disabled={disabled}
          copy={copy}
        />
      </div>
      <div className={focusMode ? workspaceStyles.focusUtilities : workspaceStyles.workspace_headerUtilities}>
        {debateMode && !focusMode && onEnterFocus && (
          <Button
            ref={enterFocusRef}
            type="button"
            variant="outline"
            className={workspaceStyles.focusExit}
            aria-label={copy.enterFocus}
            title={copy.enterFocus}
            onClick={onEnterFocus}
          >
            <Maximize aria-hidden="true" size={15} strokeWidth={1.8} />
            {copy.focusMode}
          </Button>
        )}
        {onToggleTheme ? (
          <Button
            variant="outline"
            aria-label={copy.toggleTheme}
            className={cn(workspaceStyles.themeBtn, focusMode && "size-8")}
            data-theme-preference={theme}
            onClick={onToggleTheme}
            title={copy.toggleTheme}
            type="button"
          >
            {effectiveTheme === "dark" ? (
              <Moon
                aria-hidden="true"
                className="ic-moon"
                size={15}
                strokeWidth={1.8}
              />
            ) : (
              <Sun
                aria-hidden="true"
                className="ic-sun"
                size={15}
                strokeWidth={1.8}
              />
            )}
          </Button>
        ) : null}
        <div
          className={cn(
            primitivesStyles.status,
            focusMode ? "p-1.5" : workspaceStyles.masthead_connection,
            `status status--${connection} masthead__connection`,
          )}
          title={copy[connection]}
          role="status"
        >
          <span
            aria-hidden="true"
            className={primitivesStyles.workspace_securityIcon}
          />
          <span className={cn("workspace__status-label", focusMode && "sr-only")}>{copy[connection]}</span>
        </div>
        {!debateMode && !focusMode && (onVerifyPrivateConnection || onOpenPrivateVerification) ? (
          <Menu
            as="div"
            className={primitivesStyles.workspace_verificationMenu}
          >
            <MenuButton
              as={Button}
              variant="outline"
              aria-label={copy.modelVerification}
              className={workspaceStyles.workspace_privateConnection}
              disabled={disabled}
              title={copy.modelVerification}
              type="button"
            >
              <BadgeCheck aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>{copy.modelVerification}</span>
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
            </MenuButton>
            <MenuItems
              className={primitivesStyles.workspace_verificationMenuItems}
              transition
            >
              {onVerifyPrivateConnection ? (
                <MenuItem>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={onVerifyPrivateConnection}
                    type="button"
                  >
                    {copy.verifyPrivateConnection}
                  </Button>
                </MenuItem>
              ) : null}
              {onOpenPrivateVerification ? (
                <MenuItem>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={onOpenPrivateVerification}
                    type="button"
                  >
                    {copy.modelVerification}
                  </Button>
                </MenuItem>
              ) : null}
            </MenuItems>
          </Menu>
        ) : null}
        {!debateMode && onOpenPrivacyStatus ? (
          <Button
            variant="outline"
            aria-label={copy.privacyStatus}
            className={cn(workspaceStyles.workspace_privacyStatus, "pill", focusMode && "size-8 p-0 [&>span]:sr-only")}
            title={privacyLabel ?? copy.privacyStatus}
            data-privacy-tone={privacyTone}
            onClick={onOpenPrivacyStatus}
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{privacyLabel ?? copy.privacyStatus}</span>
          </Button>
        ) : null}
        {focusMode && onExitFocus && (
          <Button
            ref={exitFocusRef}
            variant="outline"
            className={workspaceStyles.focusExit}
            type="button"
            onClick={onExitFocus}
            aria-keyshortcuts="Escape"
          >
            <Minimize aria-hidden="true" size={15} strokeWidth={1.8} />
            {copy.exitFocus}
            <kbd aria-hidden="true" className="hidden rounded border border-border px-1 text-[9px] font-normal text-muted-foreground min-[768px]:inline">Esc</kbd>
          </Button>
        )}
      </div>
    </header>
  );
}
