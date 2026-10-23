import { config } from '../config.mjs';
import { timingSafeEqual } from 'node:crypto';
import { resolveRole, permissionsFor } from './rbac.mjs';
import { getRbacStore } from './rbac-store.mjs';
import { httpError } from '../lib/util.mjs';

async function attachRole(user) {
  const store = getRbacStore();
  if (store) await store.provisionIfMissing(user);
  const overlaid = store ? store.overlay(user) : user;
  if (overlaid?.blocked) throw httpError(403, 'This account has been blocked. Contact an administrator.');
  const role = resolveRole(overlaid);
  return { ...overlaid, role, permissions: permissionsFor(role) };
}

function safeEqual(left,right){
  const a=Buffer.from(String(left||''));const b=Buffer.from(String(right||''));
  return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);
}
function headerList(value){return [...new Set(String(value||'').split(',').map(item=>item.trim()).filter(Boolean))];}
export function requestUser(req){
  if(config.identityMode==='central-sso')return requestCentralSsoUser(req);
  if(config.identityMode==='databricks-apps')return requestDatabricksAppsUser(req);
  if(config.identityMode==='trusted-gateway'){
    if(!config.trustedIdentityToken)throw new Error('Trusted gateway identity is not configured');
    if(!safeEqual(req.headers['x-ops-trusted-identity'],config.trustedIdentityToken))throw httpError(401, 'Authenticated trusted gateway identity is required');
    if(!String(req.headers['x-user-id']||'').trim())throw httpError(401, 'Trusted gateway did not provide a user identity');
  }else if(!['development','single-user'].includes(config.identityMode))throw new Error('OPS_IDENTITY_MODE must be development, single-user, trusted-gateway, central-sso, or databricks-apps');
  const singleUser=config.identityMode==='single-user';
  const id=String(singleUser?config.defaultUserId:req.headers['x-user-id']||config.defaultUserId).trim();
  if(!id)throw httpError(401, 'Authenticated user identity is required');
  const name=String(singleUser?config.defaultUserName:req.headers['x-user-name']||(!req.headers['x-user-id']?config.defaultUserName:id)||id).trim()||id;
  const groups=singleUser?[]:headerList(req.headers['x-user-groups']);
  const roles=singleUser?[]:headerList(req.headers['x-user-roles']);
  return attachRole({type:'user',id,name,groups,roles});
}

async function requestCentralSsoUser(req){
  const cookie=String(req.headers?.cookie||'').trim();
  if(!cookie)throw httpError(401, 'Authentication is required');
  let response;
  try{
    response=await fetch(config.ssoSessionUrl,{headers:{cookie,accept:'application/json'},signal:AbortSignal.timeout(5_000)});
  }catch{
    throw httpError(503, 'Central SSO session validation is unavailable');
  }
  if(!response.ok)throw httpError(401, 'Authentication is required');
  const session=await response.json().catch(()=>null);
  const user=session?.authenticated===true&&session?.user;
  const email=String(user?.email||user?.preferred_username||user?.upn||'').trim();
  const id=String(email||user?.id||'').trim().toLowerCase();
  if(!id)throw httpError(401, 'Central SSO session does not contain a user identity');
  const name=String(user.name||email||id).trim()||id;
  return attachRole({type:'user',id,name,email,groups:headerList(user.groups),roles:headerList(user.roles)});
}

// A Databricks App is reachable only through the Apps proxy, which signs the user in with the
// workspace's identity provider and sets these headers on every request (overwriting any the browser
// sent). The email is the id, lowercased, the same as central SSO, so RBAC records carry over.
export async function requestDatabricksAppsUser(req){
  const email=String(req.headers['x-forwarded-email']||req.headers['x-forwarded-preferred-username']||'').trim();
  const id=String(email||req.headers['x-forwarded-user']||'').trim().toLowerCase();
  if(!id)throw httpError(401, 'The Databricks Apps proxy did not forward a user identity');
  const name=String(req.headers['x-forwarded-preferred-username']||email||id).trim()||id;
  return attachRole({type:'user',id,name,email,groups:[],roles:[]});
}
