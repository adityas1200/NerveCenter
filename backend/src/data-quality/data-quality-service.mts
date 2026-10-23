import { createHash, randomUUID } from 'node:crypto';
import { databricksFromConnection } from '../connectors/databricks/databricks-service.mjs';
import { SnowflakeService } from '../connectors/snowflake/snowflake-service.mjs';
import { DdlMappingAgent } from './ddl-mapping-agent.mjs';
import { NO_PROJECT_KEY } from '../projects/project-api-keys.mjs';
import { analyzeDdl, DEFAULT_MAPPING, MAPPING_KEYS, REQUIRED_MAPPINGS, validateMapping } from './ddl-mapping.mjs';
import { clean, now, httpError } from '../lib/util.mjs';
import{assertScope,inScope,DEFAULT_PROJECT_ID}from '../projects/project-access.mjs';
import{STATE}from '../monitoring/monitor-store.mjs';

// The most rows one background fetch reads per result table.
export const FETCH_MAX_ROWS=10000;

type Provider = 'databricks' | 'snowflake';
type DdlColumn = { name: string; normalizedName: string; type: string; nullable: boolean; comment: string | null };
type DqTable = { id: string; name: string; provider: Provider; catalog: string; schema: string; resultTable: string; ruleTable?: string | null; warehouseId?: string | null; mapping: Record<string, string>; enabled?: boolean; ddl?: string; ddlHash?: string; discoveredColumns?: Array<DdlColumn | null>; updatedAt?: string };
type DqRow = { [key: string]: unknown; check_id?: unknown; check_name?: unknown; executed_at?: unknown; status?: unknown; severity?: unknown; dataset?: unknown; field_name?: unknown; rule_expression?: unknown; failed_rows?: unknown; message?: unknown; recommended_fix?: unknown };
type DqItem = { id: string; key?: string; checkId: string; name: string; status: string; severity: string; platform: string; table: string; tableId: string; executedAt: string; dataset: string; field: string; rule: string; failedRows: number; message: string; recommendedFix: string; alertId?: string; taskId?: string | null; routing?: { ticketId: string | null; sourceRef: string }; ticketAction?: string; ticket?: { ticketId: string; status: string | null; taskId: string | null } };
type DqStore = { getDataQualityConfig?(projectId: string | null): Promise<unknown>; setDataQualityConfig(config: unknown, projectId: string | null): Promise<unknown>; findTicketBySourceRef?(ref: string): Promise<{ projectId: string; ticketId: string; status?: string; taskId?: string } | null> };
type ResolvedConnection = { provider: string; config: Record<string, string>; credentials: Record<string, string> };
type QueryService = { queryRows(input: Record<string, unknown>): Promise<DqRow[]> };
type ConnectionApi = { providerStatuses?(): Promise<Array<{ id: string; name: string; state: string; ready: boolean; source: string; verified?: boolean; profileId?: string }>>; resolve(provider: string): Promise<ResolvedConnection | null> };
type MappingAgent = { suggest(input: {ddl: string;columns: DdlColumn[];mapping: Record<string,string>;candidates: Record<string,string[]>;sample: DqRow[];apiKey?: string | null}): Promise<{ used: boolean; reason?: string; mapping?: Record<string, string>; confidence?: number; issues?: string[] }> };
type DqInput = Partial<DqTable> & { allowDataSample?: boolean };
type DqSource = { tableId: string; table: string; status: 'ok' | 'unavailable'; count: number; reason?: string; truncated?: boolean };
type DqResponse = { configured: boolean; configuration: DqTable | null; tables: ReturnType<typeof tableSummary>[]; providers: Array<Record<string, unknown>>; range: string | null; from: string | null; to?: string | null; items: DqItem[]; total?: number; offset?: number; limit?: number; summary: ReturnType<typeof summarize>; source: { mode: string; platform: string; label: string; reason?: string }; sources: DqSource[]; fetchedAt: string; reconciliationErrors?: Record<string, unknown> };
type DqMonitorStore = { getState(projectId:string,key:string):Promise<{fetchedAt?:string;sources?:DqSource[];lastError?:string}|null>; listDqResults(projectId:string,filters:Record<string,unknown>):Promise<{items:DqItem[];total:number;summary:ReturnType<typeof summarize>}>; listAlerts(projectId:string,filters:Record<string,unknown>):Promise<{items:Array<{id:string;occurrences?:Array<{resultKey?:string}>;investigation?:{taskId?:string|null}}>}> };
type DqOptions = { store: DqStore; connectionService?: ConnectionApi; databricksFactory?: (resolved: ResolvedConnection) => QueryService; snowflakeFactory?: (resolved: ResolvedConnection) => QueryService; ddlMappingAgent?: MappingAgent; projectId?: string | null; monitorStore?: DqMonitorStore | null };
type MappingResult = { used: boolean; reason?: string; mapping?: Record<string, string>; confidence?: number; issues?: string[] };
type DdlParse = { columns: DdlColumn[]; mapping: Record<string,string>; candidates: Record<string,string[]>; issues: string[]; ddlHash: string };

const RANGE_MS={'Last hour':60*60*1000,'Last 6 hours':6*60*60*1000,'Last 12 hours':12*60*60*1000,'Last 24 hours':24*60*60*1000,'Last 7 days':7*24*60*60*1000,'Last 30 days':30*24*60*60*1000};
const parseIso=(value: unknown)=>{const at=Date.parse(String(value||''));return Number.isFinite(at)?new Date(at).toISOString():null;};
// An explicit from/to window wins over a range label so the UI can offer exact custom periods.
function resolveWindow({range,from,to}: {range?: string;from?: unknown;to?: unknown}={}){const explicitFrom=parseIso(from);const explicitTo=parseIso(to);if(explicitFrom||explicitTo)return{from:explicitFrom,to:explicitTo};if(String(range)==='Today'){const start=new Date();start.setHours(0,0,0,0);return{from:start.toISOString(),to:null};}const windowMs=RANGE_MS[String(range) as keyof typeof RANGE_MS]||0;return{from:windowMs?new Date(Date.now()-windowMs).toISOString():null,to:null};}
const PROVIDERS=new Set(['databricks','snowflake']);

function identifier(value: unknown,label: string){const text=clean(value);if(!text||text.length>255||!/^[A-Za-z0-9_$-]+$/.test(text))throw new Error(`${label} must contain only letters, numbers, _, -, or $`);return text;}
function sourceIdentifier(value: unknown,label: string){const text=clean(value);if(!text||text.length>255||/[\0\r\n]/.test(text))throw new Error(`${label} must be a valid column name`);return text;}
function quoted(value: unknown,provider: string){const safe=sourceIdentifier(value,'SQL identifier');return provider==='snowflake'?`"${safe.replaceAll('"','""')}"`:`\`${safe.replaceAll('`','``')}\``;}
function tableName(config: Pick<DqTable,'catalog'|'schema'|'provider'>,table: string){return[config.catalog,config.schema,table].map(value=>quoted(value,config.provider)).join('.');}
function normalizeStatus(value: unknown){const state=clean(value).toLowerCase();if(['pass','passed','success','succeeded','healthy','true'].includes(state))return'passed';if(['fail','failed','failure','error','false','violation','violated'].includes(state))return'failed';if(['warn','warning'].includes(state))return'warning';if(['running','pending','queued'].includes(state))return state;return'status_not_reported';}
function normalizeSeverity(value: unknown,status: string){const severity=clean(value).toLowerCase();if(['critical','warning','high','medium','low','info'].includes(severity))return severity;if(status==='failed')return'high';if(status==='warning')return'medium';return'low';}
function rowValue(row: DqRow,key: string): unknown {const value=row?.[key];return value===undefined||value===null?'':value;}
const canonicalAlias=(key: string): string=>({checkId:'check_id',checkName:'check_name',executedAt:'executed_at',failedRows:'failed_rows',field:'field_name',rule:'rule_expression',recommendedFix:'recommended_fix'} as Record<string,string>)[key]||key;
function summarize(items: DqItem[]){return{total:items.length,passed:items.filter(item=>item.status==='passed').length,failed:items.filter(item=>item.status==='failed').length,warning:items.filter(item=>item.status==='warning').length,unreported:items.filter(item=>item.status==='status_not_reported').length};}
/** The ledger key excludes status and message so an updated source row overwrites its earlier version (ADR-0006). */
export function dqResultKey({tableId,checkId,executedAt}: {tableId?:string;checkId?:string;executedAt?:string} = {}){return`dq-result:${createHash('sha256').update([tableId,checkId,executedAt].map(value=>String(value??'')).join('\u001f')).digest('hex').slice(0,40)}`;}
const fullName=(table: DqTable)=>`${table.catalog}.${table.schema}.${table.resultTable}`;
/** The short shape of a result table that monitor responses carry (no DDL or discovered columns). */
const tableSummary=(table: DqTable)=>({id:table.id,name:table.name,provider:table.provider,catalog:table.catalog,schema:table.schema,resultTable:table.resultTable,enabled:table.enabled!==false});
function emptyResponse({configuration=null,tables=[],providers=[],range,mode,reason,sources=[]}: {configuration?: DqTable|null;tables?: DqTable[];providers?: Array<Record<string,unknown>>;range: string | null;mode: string;reason?: string;sources?: DqSource[]}): DqResponse{return{configured:false,configuration,tables:tables.map(tableSummary),providers,range,from:null,items:[],summary:summarize([]),source:{mode,platform:configuration?.provider||'',label:mode==='unconfigured'?'No DQ source configured':'DQ source unavailable',reason},sources,fetchedAt:now()};}

/**
 * Result tables are stored as `{ tables: [...] }` under the operations store's data-quality setting.
 * Before several tables were supported the setting held one configuration object; that object is
 * read as a one-table list (id `dq-1`) and written back in the new shape on the next save.
 */
export function readTables(stored: unknown): DqTable[]{
  if(!stored||typeof stored!=='object')return[];
  const record=stored as Record<string,unknown>;const list=Array.isArray(record.tables)?record.tables:(record.provider||record.resultTable)?[{id:'dq-1',...record}]:[];
  return list.filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==='object').map((item,index)=>({...item,id:clean(item.id)||`dq-${index+1}`,name:clean(item.name)||clean(item.resultTable)||`Result table ${index+1}`,enabled:item.enabled!==false} as DqTable));
}
const firstTable=(tables: DqTable[])=>tables.find(table=>table.enabled!==false)||tables[0]||null;

export class DataQualityService{
  store: DqStore; connectionService: ConnectionApi; projectId: string | null; monitorStore: DqMonitorStore | null; ddlMappingAgent: MappingAgent; databricksFactory: (resolved: ResolvedConnection) => QueryService; snowflakeFactory: (resolved: ResolvedConnection) => QueryService;
  // `projectId` makes the result-table settings that project's own (SPEC-projects-01 FR-33); the connection is the project's view of the connection service.
  constructor({store,connectionService,databricksFactory,snowflakeFactory,ddlMappingAgent,projectId=null,monitorStore=null}: DqOptions){this.store=store;this.connectionService=connectionService!;this.projectId=projectId??null;this.monitorStore=monitorStore;this.ddlMappingAgent=ddlMappingAgent||new DdlMappingAgent() as unknown as MappingAgent;this.databricksFactory=databricksFactory||((resolved)=>databricksFromConnection(resolved) as QueryService);this.snowflakeFactory=snowflakeFactory||((resolved)=>new SnowflakeService({...resolved.config,...resolved.credentials}) as QueryService);}

  async providers(){const statuses=await this.connectionService?.providerStatuses?.()||[];return statuses.filter(item=>PROVIDERS.has(item.id)&&item.state==='available'&&item.ready&&(item.source==='deployment'||item.verified===true)).map(item=>({id:item.id,name:item.name,source:item.source,profileId:item.profileId||null}));}
  /** Every configured result table, enabled or not. */
  async listTables(){return readTables(await this.store.getDataQualityConfig?.(this.projectId));}
  /** The first enabled result table (or the first table when all are paused). Kept for callers that know one table. */
  async getConfig(){return firstTable(await this.listTables());}
  /** Create or update one result table. `id` names the table to update; without it a new table is added. */
  async saveConfig(patch: DqInput = {}): Promise<DqTable>{
    const tables=await this.listTables();const id=clean(patch.id);const index=id?tables.findIndex(table=>table.id===id):-1;
    // An update may send only the fields that change (for example `enabled`); the rest come from the stored table.
    const input=index>=0?{...tables[index],...patch}:patch;
    const provider=clean(input.provider).toLowerCase() as Provider;const enabled=input.enabled!==false;
    if(!PROVIDERS.has(provider))throw new Error('Select a connected Databricks or Snowflake provider');
    // Pausing a table must work even while its connection is down; turning one on needs a verified connection.
    if(enabled){const available=await this.providers();if(!available.some(item=>item.id===provider))throw new Error('Select a connected Databricks or Snowflake provider');}
    const ddl=clean(input.ddl);let mapping: Record<string,string>={};let discoveredColumns=input.discoveredColumns;let ddlHash: string | undefined;
    if(ddl){const parsed=analyzeDdl(ddl,{catalog:input.catalog,schema:input.schema,resultTable:input.resultTable}) as unknown as DdlParse;if(parsed.issues.some(issue=>/does not match|duplicate column/i.test(issue)))throw new Error(`DDL is invalid for this table: ${parsed.issues.join('; ')}`);discoveredColumns=parsed.columns;ddlHash=parsed.ddlHash;const checked=validateMapping(input.mapping||parsed.mapping,parsed.columns);if(checked.issues.length)throw new Error(`DQ mapping is invalid: ${checked.issues.join('; ')}`);mapping=checked.mapping as Record<string,string>;}
    else for(const key of MAPPING_KEYS){const value=clean(input.mapping?.[key]??(DEFAULT_MAPPING as Record<string,string>)[key]);if(value)mapping[key]=sourceIdentifier(value,`${key} column`);}
    for(const key of REQUIRED_MAPPINGS)if(!mapping[key])throw new Error(`${key} column is required`);
    const resultTable=identifier(input.resultTable,'Result table');
    const configuration: DqTable={id:index>=0?tables[index].id:(id||`dq-${randomUUID().slice(0,8)}`),name:clean(input.name).slice(0,120)||resultTable,provider,catalog:identifier(input.catalog,provider==='snowflake'?'Database':'Catalog'),schema:identifier(input.schema,'Schema'),resultTable,ruleTable:clean(input.ruleTable)?identifier(input.ruleTable,'Rule table'):null,warehouseId:clean(input.warehouseId)||null,mapping,enabled,updatedAt:now(),...(ddl?{ddl,ddlHash,discoveredColumns}: {})};
    if(provider==='databricks'&&!configuration.warehouseId)throw new Error('Databricks SQL warehouse ID is required');
    const duplicate=tables.find((table,i)=>i!==index&&table.provider===configuration.provider&&fullName(table).toLowerCase()===fullName(configuration).toLowerCase());
    if(duplicate)throw new Error(`${fullName(configuration)} is already configured as "${duplicate.name}"`);
    const next=index>=0?tables.map((table,i)=>i===index?configuration:table):[...tables,configuration];
    const saved=readTables(await this.store.setDataQualityConfig({tables:next},this.projectId));
    return saved.find(table=>table.id===configuration.id)||configuration;
  }
  async deleteConfig(id: string){
    const tables=await this.listTables();const key=clean(id);if(!tables.some(table=>table.id===key))throw httpError(404, 'Result table not found');
    await this.store.setDataQualityConfig({tables:tables.filter(table=>table.id!==key)},this.projectId);
    return{id:key,deleted:true};
  }
  // `apiKey`, when the caller passes it, is the project's own key and the only one used: null means the agent does not run (SPEC-projects-04 FR-7).
  async analyzeConfig(input: DqInput = {},options: {apiKey?: string | null} = {}){
    const available=await this.providers();const provider=clean(input.provider).toLowerCase();if(!available.some(item=>item.id===provider))throw new Error('Select a connected Databricks or Snowflake provider');
    const parsed=analyzeDdl(input.ddl,{catalog:input.catalog,schema:input.schema,resultTable:input.resultTable}) as unknown as DdlParse;
    const needsAgent=REQUIRED_MAPPINGS.some(key=>!parsed.mapping[key])||Object.values(parsed.candidates).some(values=>values.length>1);
    let sample: DqRow[]=[];let sampleIssue: string|null=null;let agent: MappingResult={used:false,reason:'The DDL matched the canonical DQ names'};
    const projectKeyed=Object.hasOwn(options,'apiKey');const apiKey=projectKeyed?options.apiKey:process.env.ANTHROPIC_API_KEY;
    if(needsAgent&&input.allowDataSample&&apiKey){try{sample=await this.#sample({provider:provider as Provider,catalog:input.catalog,schema:input.schema,resultTable:input.resultTable as string,warehouseId:input.warehouseId});}catch(error){sampleIssue=`The sample could not be read: ${clean((error as {message?:unknown})?.message)||'query failed'}`;}}
    if(needsAgent){agent=projectKeyed&&!apiKey?{used:false,reason:NO_PROJECT_KEY}:await this.ddlMappingAgent.suggest({ddl:String(input.ddl||''),columns:parsed.columns,mapping:parsed.mapping,candidates:parsed.candidates,sample,...(projectKeyed?{apiKey:apiKey as string}:{})});}
    const proposed=agent.used?{...parsed.mapping,...agent.mapping}:parsed.mapping;const checked=validateMapping(proposed,parsed.columns);const checkedMapping=checked.mapping as Record<string,string>;
    const issues=[...new Set([...parsed.issues,...(agent.issues||[]),...checked.issues,...(sampleIssue?[sampleIssue]:[])])];
    const confidence=Number.isFinite(agent.confidence)?Math.max(0,Math.min(1,agent.confidence as number)):Object.keys(checked.mapping).length/MAPPING_KEYS.length;
    return {provider,catalog:String(input.catalog||''),schema:String(input.schema||''),resultTable:String(input.resultTable||''),warehouseId:clean(input.warehouseId)||null,columns:parsed.columns,mapping:checkedMapping,candidates:parsed.candidates,issues,missingRequired:REQUIRED_MAPPINGS.filter(key=>!checkedMapping[key]),confidence,ddlHash:parsed.ddlHash,agent:{used:Boolean(agent.used),reason:agent.reason||null},sample:{used:Boolean(sample.length),rowCount:sample.length}};
  }
  /**
   * Read every enabled result table and merge the checks, newest first. Each item names the table it
   * came from (`table`, `tableId`); `sources` says per table whether it was read. `configuration` is
   * the first enabled table, for callers that only know one.
   */
  async monitor({range='Last 24 hours',limit=100,offset=0,status,severity,tableId,q,from:fromInput,to:toInput,maxRows}: {range?:string|null;limit?:number;offset?:number;status?:string;severity?:string;tableId?:string;q?:string;from?:string;to?:string;maxRows?:number}={}): Promise<DqResponse>{
    const tables=await this.listTables();const providers=await this.providers();const configuration=firstTable(tables);
    const enabled=tables.filter(table=>table.enabled!==false);
    if(!enabled.length)return emptyResponse({configuration,tables,providers,range,mode:'unconfigured',reason:'Configure a verified DQ result table to begin monitoring checks.'});
    const {from,to}=resolveWindow({range:range??undefined,from:fromInput,to:toInput});
    // Pages read the ledger the background fetch writes (ADR-0002); only the fetch itself (maxRows) and a project not fetched yet read the tables.
    if(this.monitorStore&&!maxRows){const snapshot=await this.monitorStore.getState(this.ledgerProjectId,STATE.dqSnapshot).catch(()=>null);if(snapshot?.fetchedAt)return this.#ledgerMonitor({snapshot:snapshot as typeof snapshot & {fetchedAt:string},tables,enabled,providers,configuration:configuration!,range,from,to,limit,offset,status,severity,tableId,q});}
    const cap=Math.max(1,Math.min(maxRows?Math.min(FETCH_MAX_ROWS,maxRows):100,Number(limit)||100));
    const fromMs=from?Date.parse(from):null;const toMs=to?Date.parse(to):null;
    const sources: DqSource[]=[];const items: DqItem[]=[];
    for(const table of enabled){
      if(!providers.some(item=>item.id===table.provider)){sources.push({tableId:table.id,table:table.name,status:'unavailable',count:0,reason:`The configured ${table.provider} connection is unavailable. Restore and verify the connection to load DQ results.`});continue;}
      let rows: DqRow[];try{rows=await this.#query(table,{from,limit:cap});}catch(error){sources.push({tableId:table.id,table:table.name,status:'unavailable',count:0,reason:`The configured ${table.provider} result table could not be read: ${clean((error as {message?:unknown})?.message)||'query failed'}`});continue;}
      const tableItems=rows.map((row,index)=>{const status=normalizeStatus(rowValue(row,'status'));return{id:String(rowValue(row,'check_id')||`dq-${index+1}`),checkId:String(rowValue(row,'check_id')||`dq-${index+1}`),name:String(rowValue(row,'check_name')||rowValue(row,'check_id')||'Unnamed check'),status,severity:normalizeSeverity(rowValue(row,'severity'),status),platform:table.provider,table:table.name,tableId:table.id,executedAt:String(rowValue(row,'executed_at')||''),dataset:String(rowValue(row,'dataset')||''),field:String(rowValue(row,'field_name')||''),rule:String(rowValue(row,'rule_expression')||''),failedRows:Number(rowValue(row,'failed_rows'))||0,message:String(rowValue(row,'message')||''),recommendedFix:String(rowValue(row,'recommended_fix')||'Review the failed records and update the governed DQ rule or upstream source as appropriate.')}}).map(item=>({...item,key:dqResultKey(item)})).filter(item=>{if(fromMs===null&&toMs===null)return true;const at=Date.parse(item.executedAt);return Number.isFinite(at)&&(fromMs===null||at>=fromMs)&&(toMs===null||at<=toMs);});
      sources.push({tableId:table.id,table:table.name,status:'ok',count:tableItems.length,truncated:rows.length>=cap});items.push(...tableItems);
    }
    const read=sources.filter(source=>source.status==='ok');
    if(!read.length){const reason=sources.length===1?sources[0].reason:sources.map(source=>`${source.table}: ${source.reason}`).join(' ');return emptyResponse({configuration,tables,providers,range,mode:'unavailable',reason,sources});}
    const at=(value: string)=>{const ms=Date.parse(value);return Number.isFinite(ms)?ms:0;};
    if(read.length>1)items.sort((a,b)=>at(b.executedAt)-at(a.executedAt));
    const failedSources=sources.filter(source=>source.status!=='ok');
    const reason=failedSources.length?`Read ${read.length} of ${sources.length} result tables. ${failedSources.map(source=>`${source.table}: ${source.reason}`).join(' ')}`:'Results were read from the configured DQ source.';
    const label=enabled.length===1?`${configuration!.provider} result table`:`${enabled.length} result tables`;
    return{configured:true,configuration,tables:tables.map(tableSummary),providers,range,from,to,items,summary:summarize(items),source:{mode:'configured',platform:configuration!.provider,label,reason},sources,fetchedAt:now()};
  }
  /** Every result since `from` from every enabled table, each with its ledger key, for the background fetch. */
  async fetchResults({from}: {from?:string}={}){return this.monitor({range:null,from,limit:FETCH_MAX_ROWS,maxRows:FETCH_MAX_ROWS});}
  /** The ledger key this service's results are stored under: its project, or PILOT for the one shared instance. */
  get ledgerProjectId(){return this.projectId||DEFAULT_PROJECT_ID;}
  async #ledgerMonitor({snapshot,tables,enabled,providers,configuration,range,from,to,limit,offset,status,severity,tableId,q}: {snapshot:{fetchedAt:string;sources?:DqSource[];lastError?:string};tables:DqTable[];enabled:DqTable[];providers:Awaited<ReturnType<DataQualityService['providers']>>;configuration:DqTable;range:string|null;from:string|null;to:string|null;limit:number;offset:number;status?:string;severity?:string;tableId?:string;q?:string}): Promise<DqResponse>{
    const fromMs=from?Date.parse(from):null;const toMs=to?Date.parse(to):null;const size=Math.max(1,Math.min(500,Number(limit)||100));const skip=Math.max(0,Number(offset)||0);
    const result=await this.monitorStore!.listDqResults(this.ledgerProjectId,{fromMs,toMs,status,severity,tableId,q,tableIds:enabled.map(table=>table.id),limit:size,offset:skip});
    const sources=Array.isArray(snapshot.sources)?snapshot.sources:[];const read=sources.filter(source=>source.status==='ok');
    const label=enabled.length===1?`${configuration!.provider} result table`:`${enabled.length} result tables`;
    const reason=snapshot.lastError?`The last fetch failed: ${snapshot.lastError}`:sources.length&&read.length<sources.length?`Read ${read.length} of ${sources.length} result tables. ${sources.filter(source=>source.status!=='ok').map(source=>`${source.table}: ${source.reason}`).join(' ')}`:'Results were read from the configured DQ source.';
    return{configured:true,configuration,tables:tables.map(tableSummary),providers,range,from,to,items:result.items,total:result.total,offset:skip,limit:size,summary:result.summary,source:{mode:'configured',platform:configuration!.provider,label,reason},sources,fetchedAt:snapshot.fetchedAt};
  }
  // Same result set as monitor(), with each failed check linked to the ticket that already tracks it.
  // Ticket creation for failures is the agent's job (a task from the Data Quality page), not a side effect of reading.
  async reconcile(args: {scope?: unknown;range?:string;limit?:number;from?:string;to?:string}={}): Promise<DqResponse>{
    assertScope(args.scope);
    const response=await this.monitor(args);const tables=await this.listTables();const byId=new Map(tables.map(table=>[table.id,table]));
    // The auto-investigation that looked at a result, by its ledger key (SPEC-automations-01 FR-42).
    const taskByResult=new Map();
    if(this.monitorStore){const alerts=await this.monitorStore.listAlerts(this.ledgerProjectId,{trigger:'dqFailed',limit:500}).catch(()=>({items:[]}));for(const alert of alerts.items)for(const occurrence of alert.occurrences||[])if(occurrence.resultKey&&!taskByResult.has(occurrence.resultKey))taskByResult.set(occurrence.resultKey,{alertId:alert.id,taskId:alert.investigation?.taskId||null});}
    for(const item of response.items){const link=item.key?taskByResult.get(item.key):null;if(link){item.alertId=link.alertId;item.taskId=link.taskId;}}
    for(const item of response.items.filter(result=>result.status==='failed')){
      const sourceRef=this.#failureSourceRef((byId.get(item.tableId)||response.configuration) as DqTable,item);
      const found=await this.store.findTicketBySourceRef?.(sourceRef).catch(()=>null);const existing=found&&inScope(args.scope,found.projectId)?found:null;
      item.routing={ticketId:existing?.ticketId||null,sourceRef};
      if(existing){item.ticketAction='view';item.ticket={ticketId:existing.ticketId,status:existing.status||null,taskId:existing.taskId||null};}
      else item.ticketAction='investigate';
    }
    return{...response,reconciliationErrors:{}};
  }
  async #query(configuration: DqTable,{from,limit}: {from:string|null;limit:number}): Promise<DqRow[]>{
    const provider=configuration.provider;const resolved=await this.connectionService.resolve(provider);if(!resolved)throw new Error(`${provider} connection is unavailable`);
    const service=provider==='databricks'?this.databricksFactory(resolved):this.snowflakeFactory(resolved);const columns=Object.entries(configuration.mapping).map(([alias,column])=>`${quoted(column,provider)} AS ${quoted(canonicalAlias(alias),provider)}`);
    const timeColumn=quoted(configuration.mapping.executedAt,provider);const where=from?` WHERE ${timeColumn} >= ${provider==='databricks'?':from_time':'TO_TIMESTAMP_LTZ(?)'}`:'';
    const statement=`SELECT ${columns.join(', ')} FROM ${tableName(configuration,configuration.resultTable)}${where} ORDER BY ${timeColumn} DESC LIMIT ${limit}`;
    const queryContext=provider==='databricks'?{warehouseId:configuration.warehouseId,catalog:configuration.catalog,schema:configuration.schema,parameters:from?[{name:'from_time',value:from,type:'TIMESTAMP'}]:[]}:{warehouse:resolved.config.warehouse,database:configuration.catalog,schema:configuration.schema,bindings:from?{'1':{type:'TEXT',value:from}}:undefined};
    const results=await service.queryRows({statement,...queryContext});
    if(!configuration.ruleTable)return results;
    const ruleKeys=['checkId','checkName','dataset','field','rule','severity','recommendedFix'].filter(key=>configuration.mapping[key]);const ruleColumns=ruleKeys.map(key=>`${quoted(configuration.mapping[key],provider)} AS ${quoted(canonicalAlias(key),provider)}`);
    const ruleContext=provider==='databricks'?{warehouseId:configuration.warehouseId,catalog:configuration.catalog,schema:configuration.schema}:{warehouse:resolved.config.warehouse,database:configuration.catalog,schema:configuration.schema};
    const rules=await service.queryRows({statement:`SELECT ${ruleColumns.join(', ')} FROM ${tableName(configuration,configuration.ruleTable as string)} LIMIT 1000`,...ruleContext});
    const byId=new Map(rules.map(rule=>[String(rule.check_id),rule]));return results.map(result=>({...byId.get(String(result.check_id)),...result}));
  }
  // The identity covers the table, so the same check id in two tables links to two different tickets.
  #failureSourceRef(configuration: DqTable,item: DqItem){const identity=JSON.stringify({provider:configuration.provider,catalog:configuration.catalog,schema:configuration.schema,resultTable:configuration.resultTable,checkId:item.checkId,executedAt:item.executedAt||null,status:item.status,message:item.executedAt?null:item.message});return`dq-table:${createHash('sha256').update(identity).digest('hex').slice(0,40)}`;}
  async #sample({provider,catalog,schema,resultTable,warehouseId}: {provider:Provider;catalog?:string;schema?:string;resultTable?:string;warehouseId?:string|null}): Promise<DqRow[]>{
    const resolved=await this.connectionService.resolve(provider);if(!resolved)throw new Error(`${provider} connection is unavailable`);
    const service=provider==='databricks'?this.databricksFactory(resolved):this.snowflakeFactory(resolved);
    const context=provider==='databricks'?{warehouseId:clean(warehouseId),catalog:identifier(catalog,'Catalog'),schema:identifier(schema,'Schema')}:{warehouse:resolved.config.warehouse,database:identifier(catalog,'Database'),schema:identifier(schema,'Schema')};
    if(provider==='databricks'&&!context.warehouseId)throw new Error('Databricks SQL warehouse ID is required to inspect sample rows');
    return service.queryRows({statement:`SELECT * FROM ${tableName({provider,catalog:identifier(catalog,'Catalog'),schema:identifier(schema,'Schema')},resultTable as string)} LIMIT 5`,...context});
  }
}
