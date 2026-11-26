import { FrontSelect } from "@/components/ui/front-select";
import { Disclosure, DisclosureTrigger, DisclosureContent } from "@/components/ui/disclosure";
import { useEffect, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import type { PreparedWebSource } from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterLocalModels, localModelCatalog, localModelCatalogMaxWeightMB, localModelCatalogReviewed, localModelPurposes, type LocalModelAvailability, type LocalModelLanguage, type LocalModelPurpose } from "@/lib/local-model-catalog";
import { localModelsCopy as copy } from "@/messages/local-models";
import { localModelsStyles as styles } from "@/styles/local-models";
import { LocalDocumentsDialog } from "./LocalDocumentsDialog";
import { LocalModelDiscoveryCard } from "./LocalModelDiscoveryCard";

const languages = ["all", "zh", "en", "multilingual", "independent"] as const;
const availabilities = ["all", "ready", "explore"] as const;
const sizes = [[10, copy.sizes.tiny], [50, copy.sizes.small], [100, copy.sizes.medium], [250, copy.sizes.large], [500, copy.sizes.compact], [1000, copy.sizes.larger], [localModelCatalogMaxWeightMB, copy.sizes.all]] as const;
const initialFilters = { query: "", purpose: "all" as LocalModelPurpose | "all", language: "all" as LocalModelLanguage | "all", availability: "all" as LocalModelAvailability | "all", maxWeightMB: localModelCatalogMaxWeightMB };
const pageSize = 6;

export function LocalModelDiscovery({ manage = false, onUseSources, onUseChat, onUseSpeech, request }: {
  manage?: boolean;
  onUseSources?: (sources: PreparedWebSource[]) => boolean;
  onUseChat?: (modelId: string) => Promise<boolean | undefined>;
  onUseSpeech?: (modelId:string)=>void;
  request?: {purpose?:LocalModelPurpose};
}) {
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  useEffect(()=>{if(request?.purpose){setFilters({...initialFilters,purpose:request.purpose});setExploreLimit(pageSize);}},[request]);
  const [sort, setSort] = useState("featured");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exploreLimit, setExploreLimit] = useState(pageSize);
  const filteredModels = filterLocalModels(filters);
  const models = sort === "size" ? [...filteredModels].sort((a, b) => a.weightMB - b.weightMB || a.name.localeCompare(b.name)) : filteredModels;
  const ready = models.filter(model => model.availability === "ready");
  const explore = models.filter(model => model.availability === "explore");
  const activeFilters = Boolean(filters.query || filters.purpose !== "all" || filters.language !== "all" || filters.availability !== "all" || filters.maxWeightMB !== initialFilters.maxWeightMB || sort !== "featured");
  const additionalFilters = Number(filters.language !== "all") + Number(filters.maxWeightMB !== initialFilters.maxWeightMB) + Number(sort !== "featured");

  function updateFilters(patch: Partial<typeof initialFilters>) {
    setFilters(current => ({ ...current, ...patch }));
    setExploreLimit(pageSize);
  }

  function reset(availability: LocalModelAvailability | "all" = "all") {
    setFilters({ ...initialFilters, availability });
    setSort("featured");
    setExploreLimit(pageSize);
  }

  return (
    <section className={styles.surface} aria-label="Discover local capabilities">
      <header className={styles.hero}>
        {!manage && <h3 className={styles.title}>{copy.title}</h3>}
        <p className={styles.description}>{copy.catalogSummary(localModelCatalog.length, localModelPurposes.length)}</p>
      </header>
      <div className={styles.controls}>
        <div className={styles.searchRow}>
        <div className={styles.search}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <Input type="search" aria-label={copy.search} placeholder={copy.searchPlaceholder} value={filters.query} onChange={event => updateFilters({ query: event.target.value })} />
          {filters.query && <Button variant="ghost" size="icon-sm" className={styles.clearSearch} aria-label="Clear search" onClick={() => updateFilters({ query: "" })}><X className="size-3.5" aria-hidden="true" /></Button>}
        </div>
          <FrontSelect ariaLabel={copy.purpose} value={filters.purpose} onValueChange={value => updateFilters({ purpose: value as typeof filters.purpose })} options={["all", ...localModelPurposes].map(value => ({value, label:copy.purposes[value as keyof typeof copy.purposes]}))} className={styles.selectTrigger} />
          <Button size="sm" variant="outline" className="h-10" aria-label="Filters" aria-expanded={filtersOpen} aria-controls="local-model-filters" onClick={() => setFiltersOpen(current => !current)}><SlidersHorizontal className="size-3.5" aria-hidden="true" /><span className="max-[440px]:sr-only">Filters</span>{additionalFilters > 0 && <span className={styles.filterCount}>{additionalFilters}</span>}</Button>
        </div>
        <div id="local-model-filters" hidden={!filtersOpen}>
        <div className={styles.filters}>
          <FrontSelect label={copy.language} ariaLabel={copy.language} value={filters.language} onValueChange={value => updateFilters({language:value as typeof filters.language})} options={languages.map(value=>({value,label:copy.languages[value]}))} className={styles.selectTrigger} />
          <FrontSelect label={copy.size} ariaLabel={copy.size} value={String(filters.maxWeightMB)} onValueChange={value=>updateFilters({maxWeightMB:Number(value)})} options={sizes.map(([value,label])=>({value:String(value),label}))} className={styles.selectTrigger} />
          <FrontSelect label="Sort" ariaLabel="Sort models" value={sort} onValueChange={value=>{setSort(value);setExploreLimit(pageSize);}} options={[{value:"featured",label:"Catalog order"},{value:"size",label:"Smallest files first"}]} className={styles.selectTrigger} />
        </div>
        </div>
        <div className={styles.integrationRow}>
          <div className={styles.integrationTabs} role="group" aria-label={copy.availability}>
            {availabilities.map(value => <Button key={value} size="sm" variant={filters.availability === value ? "secondary" : "ghost"} aria-label={copy.availabilities[value]} aria-pressed={filters.availability === value} onClick={() => updateFilters({ availability: value })}>
              {copy.availabilities[value]}<span className={styles.filterCount} aria-hidden="true">{filterLocalModels({ ...filters, availability: value }).length}</span>
            </Button>)}
          </div>
          {activeFilters && <Button size="sm" variant="ghost" onClick={() => reset()}>{copy.reset}</Button>}
        </div>
      </div>
      <div className={styles.results}>
        <p role="status">{models.length} of {localModelCatalog.length} models</p>
        {additionalFilters > 0 && !filtersOpen && <span>{[filters.language !== "all" && copy.languages[filters.language], filters.maxWeightMB !== initialFilters.maxWeightMB && sizes.find(([value]) => value === filters.maxWeightMB)?.[1], sort === "size" && "Smallest files first"].filter(Boolean).join(" · ")}</span>}
      </div>
      {ready.length > 0 && <section aria-labelledby="local-ready-title" className={styles.collection}>
        <div className={styles.collectionHeader}><h4 id="local-ready-title">{copy.readyTitle}<span>{ready.length}</span></h4><p>{copy.readyDescription}</p></div>
        <div className={styles.grid}>{ready.map(model => <LocalModelDiscoveryCard key={model.id} model={model} manage={manage} onUseChat={onUseChat} onUseSpeech={onUseSpeech} onUseSearch={() => setDocumentsOpen(true)} />)}</div>
      </section>}
      {explore.length > 0 && <section aria-labelledby="local-explore-title" className={styles.collection}>
        <div className={styles.collectionHeader}><h4 id="local-explore-title">{copy.exploreTitle}<span>{explore.length}</span></h4><p>{copy.discoveryNotice}</p></div>
        {!ready.length && filters.availability !== "explore" && <div className={styles.notice}><p>{copy.noReady}</p><Button size="sm" variant="outline" onClick={() => reset("ready")}>{copy.seeReady}</Button></div>}
        <div className={styles.exploreList}>{explore.slice(0, exploreLimit).map(model => <LocalModelDiscoveryCard key={model.id} model={model} manage={false} />)}</div>
        {explore.length > exploreLimit && <div className={styles.loadMore}><p>Showing {Math.min(exploreLimit, explore.length)} of {explore.length} explore-only models</p><Button variant="outline" size="sm" onClick={() => setExploreLimit(current => current + pageSize)}>Show {Math.min(pageSize, explore.length - exploreLimit)} more models<ChevronDown className="size-3.5" aria-hidden="true" /></Button></div>}
      </section>}
      {!models.length && <div className={styles.empty}><Search className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><h4>{copy.empty}</h4><p>{copy.emptyHint}</p><Button variant="outline" onClick={() => reset()}>{copy.reset}</Button></div>}
      <Disclosure className={styles.sources}>
        <DisclosureTrigger>{copy.sourcesTitle}</DisclosureTrigger><DisclosureContent>
        <p>{copy.sourcesDescription}</p><p>{copy.alternativeSource} <a href="https://modelscope.cn/models" target="_blank" rel="noopener noreferrer">{copy.sourceLink}</a></p>
        <p>{copy.sizeNotice}</p><p>{copy.privacyNotice}</p>
        <p>{copy.reviewed}: <time dateTime={localModelCatalogReviewed}>{localModelCatalogReviewed}</time>. Performance varies by task, context, and hardware. Explore-only entries have not been tested in Cove.</p>
      </DisclosureContent></Disclosure>
      {documentsOpen && <LocalDocumentsDialog onClose={() => setDocumentsOpen(false)} onUseSources={onUseSources} />}
    </section>
  );
}
