import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/local-models";
import { localDocumentsKey, localModelKey, providerKeys, speechKey } from "@/api/queryKeys";
import { useEffect } from "react";

export { localDocumentsKey, localModelKey } from "@/api/queryKeys";
export function useLocalModels() {
  const cache=useQueryClient();
  const result=useQuery({queryKey:localModelKey,queryFn:({signal})=>api.getLocalModels(signal),retry:false,refetchOnWindowFocus:false,
    refetchInterval:query=>query.state.data?.some(item=>item.state==="downloading") ? 750 : false});
  const installedChatIds=result.data?.filter(item=>item.role==="chat" && item.state==="installed").map(item=>item.id).sort().join(",");
  useEffect(()=>{if(installedChatIds!==undefined){void cache.invalidateQueries({queryKey:providerKeys.list});void cache.invalidateQueries({queryKey:providerKeys.catalog("cove-local")});}},[installedChatIds,cache]);
  return result;
}
export function useLocalModelAction() {
  const cache=useQueryClient();
  return useMutation({retry:false,mutationFn:async ({id,action}:{id:string;action:"install"|"cancel"|"remove"})=>{
    await (action==="install"?api.installLocalModel:action==="cancel"?api.cancelLocalModel:api.removeLocalModel)(id);
  },onSuccess:async()=>{await Promise.all([cache.invalidateQueries({queryKey:localModelKey}),cache.invalidateQueries({queryKey:speechKey}),cache.invalidateQueries({queryKey:localDocumentsKey}),cache.invalidateQueries({queryKey:providerKeys.list}),cache.invalidateQueries({queryKey:providerKeys.catalog("cove-local")})]);}});
}
export function useLocalDocuments(projectId?:string) { return useQuery({queryKey:projectId?[...localDocumentsKey,"project",projectId]:localDocumentsKey,queryFn:({signal})=>projectId?api.getProjectDocuments(projectId,signal):api.getLocalDocuments(signal),retry:false,refetchOnWindowFocus:false}); }
