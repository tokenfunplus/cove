import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSpeechConfiguration } from "@/api/speech";
import { speechKey } from "@/api/queryKeys";
import { useLocalModels } from "./useLocalModels";

export function useSpeechConfiguration() {
  const query = useQuery({queryKey:speechKey,queryFn:({signal})=>getSpeechConfiguration(signal),retry:false,refetchOnWindowFocus:false});
  const status = useLocalModels();
  // A download can finish while this panel is open. Share installation polling
  // rather than leaving the voice selector with a stale installed flag.
  const data = useMemo(()=>query.data ? {...query.data,models:query.data.models.map(model=>{
    const current=status.data?.find(item=>item.id===model.id);
    return current ? {...model,installed:current.state==="installed",runtime_ready:current.runtime_ready} : model;
  })} : undefined,[query.data,status.data]);
  return {...query,data};
}
