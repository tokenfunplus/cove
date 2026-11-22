import { settingsStyles } from "@/styles/settings";
import { cn } from "@/lib/utils";
import { CoveMark } from "@/components/ui/CoveMark";
import { Button } from "@/components/ui/button";
import { type ApplicationCopy, englishConversationCopy } from "@/messages";
import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Cpu, Database, Globe, Settings2, SlidersHorizontal, X } from "lucide-react";
import { localModelsCopy } from "@/messages/local-models";
import { Portal } from "@headlessui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

type SettingsDialogSection = "general" | "provider" | "chat-data" | "web-search" | "local-models";

export function SettingsDialog({
  open,
  initialSection,
  onSectionChange,
  onClose,
  children,
  copy = englishConversationCopy,
}: {
  open: boolean;
  initialSection?: SettingsDialogSection;
  onSectionChange?: (section: SettingsDialogSection) => void;
  onClose: () => void;
  children: ReactNode;
  copy?: ApplicationCopy;
}) {
  const popoverTarget = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      className={cn(settingsStyles.settingsDialog, "settings-dialog--nearai")}
      open={open}
      onClose={onClose}
    >
      <DialogOverlay className={settingsStyles.settingsDialog_backdrop} />
      <div className={settingsStyles.settingsDialog_viewport}>
        <DialogContent
          ref={popoverTarget}
          className={settingsStyles.settingsDialog_layer}
          onEscapeKeyDown={(event) => {
            // Radix handles Escape before the nested Combobox receives it.
            const toggle = popoverTarget.current?.querySelector<HTMLButtonElement>(
              '.front-select__toggle[aria-expanded="true"]',
            );
            if (toggle) {
              event.preventDefault();
              toggle.click();
            }
          }}
        >
          {/* Keep popovers inside the modal's scroll lock, outside its clipped panel. */}
          <Portal.Group target={popoverTarget}>
            <div className={settingsStyles.settingsDialog_panel}>
              <SettingsDialogContent
                initialSection={initialSection}
                onSectionChange={onSectionChange}
                copy={copy}
                onClose={onClose}
                title={<DialogTitle as="h2">{copy.settings}</DialogTitle>}
              >
                {children}
              </SettingsDialogContent>
            </div>
          </Portal.Group>
        </DialogContent>
      </div>
    </Dialog>
  );
}

export function SettingsDialogContent({
  children,
  onClose = () => {},
  copy = englishConversationCopy,
  title,
  initialSection = "general",
  onSectionChange,
}: {
  children: ReactNode;
  onClose?: () => void;
  copy?: ApplicationCopy;
  title?: ReactNode;
  initialSection?: SettingsDialogSection;
  onSectionChange?: (section: SettingsDialogSection) => void;
}) {
  const heading = title ?? <h2>{copy.settings}</h2>;
  const [activeSection, setActiveSection] =
    useState<SettingsDialogSection>(initialSection);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(()=>setActiveSection(initialSection),[initialSection]);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSection]);
  const sections = [
    { id: "general" as const, icon: SlidersHorizontal, label: copy.general },
    { id: "provider" as const, icon: Settings2, label: copy.providerSettings },
    { id: "local-models" as const, icon: Cpu, label: localModelsCopy.navigation },
    { id: "web-search" as const, icon: Globe, label: "Web search" },
    { id: "chat-data" as const, icon: Database, label: copy.chatData },
  ];
  return (
    <>
      <header className={settingsStyles.settingsDialog_header}>
        <span aria-hidden="true" className={settingsStyles.settingsDialog_mark}>
          <CoveMark />
        </span>
        {heading}
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.closeSettings}
          className={settingsStyles.settingsDialog_close}
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </Button>
      </header>
      <div className={settingsStyles.settingsDialog_content}>
        <nav
          aria-label={copy.settingsSections}
          className={settingsStyles.settingsDialog_navigation}
          role="tablist"
        >
          {sections.map((section, index) => (
            <Button
              variant="ghost"
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              tabIndex={activeSection === section.id ? 0 : -1}
              onKeyDown={(event) => {
                const offset =
                  event.key === "ArrowDown" || event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowUp" || event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (!offset && event.key !== "Home" && event.key !== "End")
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? sections.length - 1
                      : (index + offset + sections.length) % sections.length;
                setActiveSection(sections[next].id);
                onSectionChange?.(sections[next].id);
                tabRefs.current[next]?.focus();
              }}
              id={`settings-tab-${section.id}`}
              aria-controls={`settings-${section.id}`}
              aria-selected={activeSection === section.id}
              key={section.id}
              onClick={() => { setActiveSection(section.id); onSectionChange?.(section.id); }}
              role="tab"
              aria-label={section.label}
              type="button"
            >
              <section.icon size={16} aria-hidden="true" />
              {section.id === "provider" ? (
                <>
                  <span className="hidden md:inline">{section.label}</span>
                  <span className="md:hidden">{copy.providers}</span>
                </>
              ) : (
                <span>{section.label}</span>
              )}
            </Button>
          ))}
        </nav>
        <div
          ref={contentRef}
          className={settingsStyles.settingsDialog_sections}
          data-active-settings-section={activeSection}
        >
          {children}
        </div>
      </div>
    </>
  );
}
