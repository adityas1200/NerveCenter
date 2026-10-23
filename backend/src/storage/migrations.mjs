import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../config.mjs';

export async function applyControlMigrations(pool){
  const client=await pool.connect();
  try{
    await client.query("SELECT pg_advisory_lock(hashtext('nervecenter-control-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS ops_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory=path.join(ROOT,'migrations');
    const files=(await fs.readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
    const applied=new Set((await client.query('SELECT name FROM ops_schema_migrations')).rows.map(row=>row.name));
    for(const name of files){
      if(applied.has(name))continue;
      try{
        await client.query('BEGIN');
        await client.query(await fs.readFile(path.join(directory,name),'utf8'));
        await client.query('INSERT INTO ops_schema_migrations(name) VALUES($1)',[name]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    }
  }finally{
    await client.query("SELECT pg_advisory_unlock(hashtext('nervecenter-control-migrations'))").catch(()=>{});
    client.release();
  }
}
