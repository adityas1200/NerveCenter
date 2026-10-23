import tls from 'node:tls';

/**
 * Trust the operating system's certificate store as well as Node's bundled list, for every outbound
 * HTTPS call (fetch included). Corporate networks re-sign traffic to Databricks, ServiceNow and Jira
 * with a proxy certificate that only the OS knows; without this every test ends in
 * "unable to get local issuer certificate". Set OPS_TRUST_SYSTEM_CA=0 to keep Node's default.
 */
export function trustSystemCertificates() {
  if (process.env.OPS_TRUST_SYSTEM_CA === '0') return false;
  if (typeof tls.setDefaultCACertificates !== 'function' || typeof tls.getCACertificates !== 'function') return false;
  try {
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]);
    return true;
  } catch (error) {
    console.warn(`[tls] could not load the system certificate store: ${error?.message || error}`);
    return false;
  }
}
