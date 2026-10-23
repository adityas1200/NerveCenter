import snowflake from 'snowflake-sdk';

type SnowflakeValue = string | number | boolean | null;
type SnowflakeRow = Record<string, SnowflakeValue>;
type SnowflakePayload = { message?: string; code?: string; statementStatusUrl?: string; statementHandle?: string; resultSetMetaData?: { rowType?: Array<{ name?: string }> }; data?: SnowflakeValue[][] };
type SnowflakeBindings = Record<string, SnowflakeValue | { value?: SnowflakeValue }>;
type SnowflakeOptions = { account?: string; authType?: string; username?: string; password?: string; privateKey?: string; privateKeyPassphrase?: string; token?: string; accessToken?: string; tokenType?: string; warehouse?: string; database?: string; schema?: string; role?: string; driver?: SnowflakeDriver };
type SnowflakeQueryOptions = { statement?: string; warehouse?: string; database?: string; schema?: string; role?: string; bindings?: SnowflakeBindings };
type SnowflakeDriver = { createConnection(options: Record<string, unknown>): SnowflakeConnection };
type SnowflakeConnection = { connect?(callback: (error?: Error | null) => void): void; connectAsync(): Promise<void>; execute(options: { sqlText: string; rowMode: 'object'; binds?: unknown[]; complete(error: Error | null, statement: unknown, result?: SnowflakeRow[]): void }): void; destroy(callback: (error?: Error | null) => void): void };

const delay=(ms: number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const clean=(value: unknown)=>String(value||'').trim();
const TASK_IDENTIFIER=/^[A-Za-z_][A-Za-z0-9_$]*$/;

function accountDetails(account?: string){
  const value=clean(account);if(!value)throw new Error('Snowflake account identifier is required');
  let url;try{url=new URL(/^https:\/\//i.test(value)?value:`https://${value}.snowflakecomputing.com`);}catch{throw new Error('Snowflake account identifier is invalid');}
  if(url.protocol!=='https:'||!url.hostname.endsWith('.snowflakecomputing.com'))throw new Error('Snowflake SQL API must use an HTTPS snowflakecomputing.com endpoint');
  return{baseUrl:url.origin,accountIdentifier:url.hostname.replace(/\.snowflakecomputing\.com$/i,'')};
}

export class SnowflakeService{
  baseUrl!: string; accountIdentifier!: string; driver!: SnowflakeDriver; authType!: string; username!: string; password!: string; privateKey!: string; privateKeyPassphrase!: string; token!: string; tokenType!: string; warehouse!: string; database!: string; schema!: string; role!: string;
  constructor({account,authType,username,password,privateKey,privateKeyPassphrase,token,accessToken,tokenType='PROGRAMMATIC_ACCESS_TOKEN',warehouse,database,schema,role,driver=snowflake as unknown as SnowflakeDriver}: SnowflakeOptions={}){
    const details=accountDetails(account);Object.assign(this,{...details,driver,authType:clean(authType).toLowerCase(),username:clean(username),password:clean(password),privateKey:clean(privateKey),privateKeyPassphrase:clean(privateKeyPassphrase),token:clean(token||accessToken),tokenType:clean(tokenType)||'PROGRAMMATIC_ACCESS_TOKEN',warehouse:clean(warehouse),database:clean(database),schema:clean(schema),role:clean(role)});
    if(!this.authType)this.authType=this.token?'legacy_token':this.privateKey?'key_pair':this.password?'password':'';
    if(this.authType==='password'&&(!this.username||!this.password))throw new Error('Snowflake username and password are required');
    if(this.authType==='key_pair'&&(!this.username||!this.privateKey))throw new Error('Snowflake username and private key are required');
    if(this.authType==='legacy_token'&&!this.token)throw new Error('Snowflake access token is required');
    if(!['password','key_pair','legacy_token'].includes(this.authType))throw new Error('Snowflake authentication must use key pair or password');
    if(this.authType==='legacy_token'&&!['PROGRAMMATIC_ACCESS_TOKEN','OAUTH','KEYPAIR_JWT','WORKLOAD_IDENTITY_FEDERATION'].includes(this.tokenType))throw new Error('Snowflake token type is not supported');
  }
  async request(method: string,pathname: string,{body}: { body?: Record<string, unknown> }={}){const target=new URL(pathname,this.baseUrl);if(target.origin!==this.baseUrl)throw new Error('Snowflake response attempted to redirect the authenticated request outside the configured account');const response=await fetch(target,{method,headers:{authorization:`Bearer ${this.token}`,'x-snowflake-authorization-token-type':this.tokenType,'content-type':'application/json',accept:'application/json','user-agent':'NerveCenter/1.0'},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();let payload: SnowflakePayload={};try{payload=text?JSON.parse(text) as SnowflakePayload:{};}catch{payload={message:text};}if(!response.ok&&response.status!==202)throw new Error(`Snowflake SQL API failed (${response.status}): ${payload.message||payload.code||'request failed'}`);return{status:response.status,payload};}
  async queryRows({statement,warehouse=this.warehouse,database=this.database,schema=this.schema,role=this.role,bindings}: SnowflakeQueryOptions={}){
    const sql=String(statement||'');const withoutComments=sql.replace(/--[^\r\n]*/g,' ').replace(/\/\*[\s\S]*?\*\//g,' ');
    if(!/^\s*(SELECT|WITH)\b/i.test(withoutComments)||sql.includes(';')||/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|CALL|COPY|PUT|REMOVE|GRANT|REVOKE)\b/i.test(withoutComments))throw new Error('Only one read-only SELECT statement is allowed');
    return this.#executeRows({statement:sql,warehouse,database,schema,role,bindings});
  }
  async executeStatement({statement,warehouse=this.warehouse,database=this.database,schema=this.schema,role=this.role,bindings}: SnowflakeQueryOptions={}){
    const sql=String(statement||'').trim();if(!sql||sql.includes(';'))throw new Error('One SQL statement is required');
    return this.#executeRows({statement:sql,warehouse,database,schema,role,bindings});
  }
  /** Role-aware task inventory without widening the generic SELECT-only query surface. */
  async listVisibleTasks({database=this.database,limit=1000,warehouse=this.warehouse,role=this.role}: {database?: string;limit?: number;warehouse?: string;role?: string}={}){
    const scopedDatabase=clean(database);if(!TASK_IDENTIFIER.test(scopedDatabase))throw new Error('Snowflake task inventory requires a valid configured database');
    const target=Math.max(1,Math.min(10000,Number(limit)||1000));
    const statement=`SHOW TASKS IN DATABASE ${scopedDatabase.toUpperCase()} LIMIT ${target}`;
    return this.#executeRows({statement,warehouse,database:scopedDatabase,schema:this.schema,role});
  }
  async #executeRows({statement,warehouse,database,schema,role,bindings}: Required<Pick<SnowflakeQueryOptions,'statement'>> & Omit<SnowflakeQueryOptions,'statement'>){
    if(this.authType!=='legacy_token')return this.#queryWithDriver({sql:statement,warehouse,database,schema,role,bindings});
    let {status,payload}=await this.request('POST','/api/v2/statements',{body:{statement,timeout:30,...(warehouse?{warehouse}:{}),...(database?{database}:{}),...(schema?{schema}:{}),...(role?{role}:{}),...(bindings?{bindings}:{})}});
    for(let attempt=0;status===202&&attempt<12;attempt+=1){await delay(1000);const target=payload.statementStatusUrl||`/api/v2/statements/${payload.statementHandle}`;({status,payload}=await this.request('GET',target));}
    if(status===202)throw new Error('Snowflake query did not complete within the bounded wait period');
    const columns=(payload.resultSetMetaData?.rowType||[]).map(column=>String(column.name||'').toLowerCase());return(payload.data||[]).map(row=>Object.fromEntries(columns.map((column,index)=>[column,row[index]])));
  }
  async executeTask({database=this.database,schema=this.schema,name,warehouse=this.warehouse,role=this.role}: {database?: string;schema?: string;name?: string;warehouse?: string;role?: string}={}){
    const parts=[database,schema,name].map(value=>clean(value));
    if(parts.some(value=>!TASK_IDENTIFIER.test(value)))throw new Error('Snowflake task execution requires a valid database, schema, and task name');
    const statement=`EXECUTE TASK ${parts.map(value=>value.toUpperCase()).join('.')}`;
    if(this.authType!=='legacy_token'){
      await this.#queryWithDriver({sql:statement,warehouse,database,schema,role});
      return{status:'started',platform:'snowflake',task:parts.map(value=>value.toUpperCase()).join('.')};
    }
    let{status,payload}=await this.request('POST','/api/v2/statements',{body:{statement,timeout:30,...(warehouse?{warehouse}:{}),...(database?{database}:{}),...(schema?{schema}:{}),...(role?{role}:{})}});
    for(let attempt=0;status===202&&attempt<12;attempt+=1){await delay(1000);const target=payload.statementStatusUrl||`/api/v2/statements/${payload.statementHandle}`;({status,payload}=await this.request('GET',target));}
    if(status===202)throw new Error('Snowflake task execution did not complete within the bounded wait period');
    return{status:'started',platform:'snowflake',task:parts.map(value=>value.toUpperCase()).join('.'),statementHandle:payload.statementHandle||null};
  }
  async #queryWithDriver({sql,warehouse,database,schema,role,bindings}: {sql: string;warehouse?: string;database?: string;schema?: string;role?: string;bindings?: SnowflakeBindings}){
    const connection=this.driver.createConnection({account:this.accountIdentifier,username:this.username,application:'NerveCenter',warehouse,database,schema,role,timeout:30_000,...(this.authType==='key_pair'?{authenticator:'SNOWFLAKE_JWT',privateKey:this.privateKey,...(this.privateKeyPassphrase?{privateKeyPass:this.privateKeyPassphrase}:{})}:{authenticator:'SNOWFLAKE',password:this.password})});
    let primaryError;
    try{
      await new Promise<void>((resolve,reject)=>{
        const complete=(error?: Error | null)=>error?reject(error):resolve();
        try{if(typeof connection.connect==='function')connection.connect(complete);else Promise.resolve(connection.connectAsync()).then(resolve,reject);}
        catch(error){reject(error);}
      });
      const binds=bindings?Object.keys(bindings).sort((left,right)=>Number(left)-Number(right)).map(key=>(bindings[key] as {value?: SnowflakeValue} | null)?.value??bindings[key]):undefined;
      const rows=await new Promise<SnowflakeRow[]>((resolve,reject)=>connection.execute({sqlText:sql,rowMode:'object',...(binds?.length?{binds}:{}),complete:(error,_statement,result)=>error?reject(error):resolve(result||[])}));
      return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toLowerCase(),value])));
    }catch(error){primaryError=error;throw error;}
    finally{
      try{await new Promise<void>((resolve,reject)=>{try{connection.destroy(error=>error?reject(error):resolve());}catch(error){reject(error);}});}
      catch(cleanupError){if(!primaryError)throw cleanupError;}
    }
  }
}
