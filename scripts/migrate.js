// Moves Pelagos onto the multi-client platform as client number 1. Dry run unless you add --apply.
//   npm run migrate                  check the live project, change nothing
//   npm run migrate -- --apply       make the change (asks you to type LIVE)
//   npm run migrate:local            rehearse on your local copy (add -- --apply to apply)
// --no-pelagos-url   don't keep pelagos-portal.web.app as Pelagos's own address
import fs from 'node:fs';
import { connect, flag, LIVE_PROJECT } from './connect.js';
import { migrateFirstClient } from '../src/migrate.js';
import { config } from '../src/config.js';

const apply = flag('apply');
const { db, live } = await connect({ what: 'add Pelagos to the platform as client 1', confirm: apply });
const cfg = JSON.parse(fs.readFileSync(new URL('../content/config.json', import.meta.url), 'utf8')).client;
const hosts = flag('no-pelagos-url') ? [] : [`${LIVE_PROJECT}.web.app`];
try {
  await migrateFirstClient(db, { orgId: config.orgId, loginCode: cfg.loginCode, docPrefix: cfg.docPrefix, staffNoPrefix: cfg.staffNoPrefix, branding: cfg.branding, hosts, apply });
  if (apply && live) console.log('\nNext: deploy the new version with  npm run deploy\n');
  process.exit(0);
} catch (e) { console.error(`\n${e.migrationStopped ? e.message : e.stack}\n`); process.exit(1); }
