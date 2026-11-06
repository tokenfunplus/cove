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
  Moon,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
} from "lucide-react";

export function WorkspaceHeader({
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
  onVerifyPrivateConnection,
  onOpenPrivateVerification,
  onOpenPrivacyStatus,
  onOpenSidebar,
  connection,
  disabled = false,
  copy = englishConversationCopy,
}: {
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
  return (
    <header
      className={cn(
        workspaceStyles.workspace_header,
        "workspace__header--nearai masthead",
      )}
      data-workspace-region="workspace-header"
    >
      {onOpenSidebar ? (
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
      <div className={workspaceStyles.workspace_headerIdentity}>
        <div className={workspaceStyles.masthead_eyebrow}>
          <span>{copy.conversationSection}</span>
        </div>
        <div className={workspaceStyles.masthead_title} title={title}>
          {title ?? copy.chatSurface}
        </div>
      </div>
      <div
        className={workspaceStyles.workspace_headerModel}
        data-workspace-model-controls="compact"
      >
        <ModelSelector
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
          disabled={disabled}
          copy={copy}
        />
      </div>
      <div className={workspaceStyles.workspace_headerUtilities}>
        {onToggleTheme ? (
          <Button
            variant="outline"
            aria-label={copy.toggleTheme}
            className={workspaceStyles.themeBtn}
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
            workspaceStyles.masthead_connection,
            `status status--${connection} masthead__connection`,
          )}
        >
          <span
            aria-hidden="true"
            className={primitivesStyles.workspace_securityIcon}
          />
          <span className="workspace__status-label">{copy[connection]}</span>
        </div>
        {onVerifyPrivateConnection || onOpenPrivateVerification ? (
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
        {onOpenPrivacyStatus ? (
          <Button
            variant="outline"
            aria-label={copy.privacyStatus}
            className={cn(workspaceStyles.workspace_privacyStatus, "pill")}
            data-privacy-tone={privacyTone}
            onClick={onOpenPrivacyStatus}
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{privacyLabel ?? copy.privacyStatus}</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
