import { Check, Ellipsis, LayoutGrid, FileSearch, Globe, HardDrive, Link, ListFilter, LockKeyhole } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";
import { LocalDocumentsDialog } from "@/components/settings/LocalDocumentsDialog";
import { Button } from "@/components/ui/button";
import type { AttachmentDraft } from "@/hooks/chat/use-attachment-draft";
import { englishConversationCopy as copy } from "@/messages";

type ToolAction = { open: () => void; disabled: boolean };

type Props = {
  attachments: AttachmentDraft;
  disabled: boolean;
  webpage?: ToolAction;
  context?: ToolAction;
  webSearch?: { enabled: boolean; disabled: boolean; toggle: () => void; budgetLabel?: string };
  localOnly?: { enabled: boolean; disabled: boolean; toggle: (enabled: boolean) => void };
  onApps?: () => void;
  onManage?: () => void;
};

const itemStyle = "flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium outline-none data-highlighted:bg-muted data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export function QuickPanelTools({ attachments, disabled, webpage, context, webSearch, localOnly, onManage, onApps }: Props) {
  const [documentSearchOpen, setDocumentSearchOpen] = useState(false);
  const afterClose = useRef<(() => void) | undefined>(undefined);

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg text-muted-foreground"
            disabled={disabled}
            aria-label="Tools"
            title="Tools"
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-[110] max-h-(--radix-dropdown-menu-content-available-height) w-56 overflow-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover"
            onCloseAutoFocus={() => {
              const open = afterClose.current;
              afterClose.current = undefined;
              // The menu restores its trigger before a dialog records focus.
              if (open) queueMicrotask(open);
            }}
          >
            {webpage && <DropdownMenu.Item className={itemStyle} disabled={webpage.disabled} onSelect={() => { afterClose.current = webpage.open; }}>
              <Link aria-hidden="true" />{copy.readWebpage}
            </DropdownMenu.Item>}
            {webSearch && <DropdownMenu.CheckboxItem
              className={itemStyle}
              checked={webSearch.enabled}
              disabled={webSearch.disabled}
              title={webSearch.enabled ? webSearch.budgetLabel : undefined}
              onCheckedChange={webSearch.toggle}
            >
              <Globe aria-hidden="true" />Web search
              <DropdownMenu.ItemIndicator className="ml-auto"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>}
            {context && <DropdownMenu.Item className={itemStyle} disabled={context.disabled} onSelect={() => { afterClose.current = context.open; }}>
              <ListFilter aria-hidden="true" />{copy.reviewContext}
            </DropdownMenu.Item>}
            {(webpage || webSearch || context) && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
            <DropdownMenu.Item className={itemStyle} onSelect={() => { afterClose.current = () => setDocumentSearchOpen(true); }}>
              <FileSearch aria-hidden="true" />Search local documents
            </DropdownMenu.Item>
            {localOnly && <DropdownMenu.CheckboxItem
              className={itemStyle}
              checked={localOnly.enabled}
              disabled={localOnly.disabled}
              onCheckedChange={localOnly.toggle}
            >
              <LockKeyhole aria-hidden="true" />Only on this Mac
              <DropdownMenu.ItemIndicator className="ml-auto"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>}
            {onApps && <DropdownMenu.Item className={itemStyle} onSelect={() => { afterClose.current = onApps; }}>
              <LayoutGrid aria-hidden="true" />Mini Apps
            </DropdownMenu.Item>}
            {onManage && <DropdownMenu.Item className={itemStyle} onSelect={() => { afterClose.current = onManage; }}>
              <HardDrive aria-hidden="true" />Manage local capabilities
            </DropdownMenu.Item>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {documentSearchOpen && <LocalDocumentsDialog
        onClose={() => setDocumentSearchOpen(false)}
        onUseSources={attachments.addRetrievedSources}
      />}
    </>
  );
}
