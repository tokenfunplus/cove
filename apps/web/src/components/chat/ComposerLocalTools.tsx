import { useState } from "react";
import { FileSearch, HardDrive, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LocalDocumentsDialog } from "@/components/settings/LocalDocumentsDialog";
import type { AttachmentDraft } from "@/hooks/chat/use-attachment-draft";

export function ComposerLocalTools({attachments,projectId,disabled,onManage}:{attachments:AttachmentDraft;projectId?:string;disabled:boolean;onManage?:()=>void}){
 const [open,setOpen]=useState(false);
 const [search,setSearch]=useState<{project?:string}>();
 function start(project?:string){setOpen(false);setSearch({project});}
 return <>
  <Popover open={open} onOpenChange={setOpen}>
   <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label="Tools"><Wrench className="size-4" aria-hidden="true"/>Tools</Button></PopoverTrigger>
   <PopoverContent align="start" className="grid w-72 gap-2" aria-label="Chat tools">
    <p className="px-2 text-xs font-medium text-muted-foreground">Runs on this Mac</p>
    <Button variant="ghost" className="justify-start" onClick={()=>start()}><FileSearch aria-hidden="true"/>Search local documents</Button>
    {projectId&&<Button variant="ghost" className="justify-start" onClick={()=>start(projectId)}><FileSearch aria-hidden="true"/>Search project materials</Button>}
    {onManage&&<Button variant="ghost" className="justify-start" onClick={()=>{setOpen(false);onManage();}}><HardDrive aria-hidden="true"/>Manage local capabilities</Button>}
   </PopoverContent>
  </Popover>
  {search&&<LocalDocumentsDialog key={search.project??"library"} projectId={search.project} onClose={()=>setSearch(undefined)} onUseSources={sources=>attachments.addRetrievedSources(sources)}/>}
 </>;
}
