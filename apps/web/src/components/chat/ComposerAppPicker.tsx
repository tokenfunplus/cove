import {useCallback,useLayoutEffect,useRef} from "react";
import AppPicker from "@/components/miniapps/AppPicker";

interface Props {
  draft:string;
  surface:"chat"|"panel";
  localRequired?:boolean;
  busy:boolean;
  change:(value:string)=>void;
  close:()=>void;
}

// ChatComposer keys this picker by conversation. A late snapshot can only be
// appended to the mounted picker and the current contents of that draft.
export default function ComposerAppPicker(props:Props) {
  const latest=useRef<Props|null>(null);
  useLayoutEffect(()=>{
    latest.current=props;
    return ()=>{latest.current=null;};
  },[props]);
  const attach=useCallback((snapshot:string)=>{
    const target=latest.current;
    if(!target || target.busy) throw new Error("The destination changed. Reopen the picker to attach these records.");
    target.change(target.draft ? target.draft+"\n\n"+snapshot : snapshot);
    target.close();
  },[]);
  return <AppPicker draft={props.draft} surface={props.surface} localRequired={props.localRequired} close={props.close} attach={attach}/>;
}
