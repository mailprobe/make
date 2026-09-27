#!/usr/bin/env node
// Checks the app source and deploys it to Make through the SDK Apps API:
// https://developers.make.com/api-documentation/api-reference/sdk-apps
// The source follows Make's local development layout (src/makecomapp.json), so the
// Make Apps Editor for VS Code can open the same folder.
//
//   node scripts/make-app.mjs check           validates the files, without network
//   node scripts/make-app.mjs create          creates the app in Make, once
//   node scripts/make-app.mjs deploy [--icon] sends every component to Make
//
// The API token comes from MAKE_API_TOKEN or from the origin's apikeyFile
// (.secrets/apikey, ignored by git). It needs the sdk-apps:read and sdk-apps:write scopes.

import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const MANIFEST = path.join(SRC, 'makecomapp.json');

const MODULE_TYPE_IDS = { trigger: 1, action: 4, search: 9, instant_trigger: 10, responder: 11, universal: 12 };
// Local code file -> API section.
const MODULE_SECTIONS = {
  communication: 'api',
  staticParams: 'parameters',
  mappableParams: 'expect',
  interface: 'interface',
  samples: 'samples',
  scope: 'scope',
};
const CONNECTION_SECTIONS = { communication: 'api', params: 'parameters' };

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const fromSrc = (relative) => path.join(SRC, relative);

async function check(manifest, app) {
  const problems = [];
  const files = [];
  const { base, common, readme, groups } = manifest.generalCodeFiles;
  files.push(base, groups);
  if (common) files.push(common);
  for (const kind of ['connection', 'module']) {
    for (const [name, component] of Object.entries(manifest.components[kind])) {
      for (const [codeType, file] of Object.entries(component.codeFiles)) {
        if (file) files.push(file);
        else if (kind === 'module' || codeType !== 'common') problems.push(`${kind} ${name}: no ${codeType} file`);
      }
    }
  }
  for (const file of files) {
    try {
      await readJson(fromSrc(file));
    } catch (error) {
      problems.push(`${file}: ${error.message}`);
    }
  }
  try {
    await stat(fromSrc(readme));
  } catch {
    problems.push(`${readme}: missing`);
  }

  const modules = manifest.components.module;
  const connections = manifest.components.connection;
  const grouped = (await readJson(fromSrc(groups))).flatMap((group) => group.modules);
  for (const [name, module] of Object.entries(modules)) {
    if (!(module.moduleType in MODULE_TYPE_IDS)) problems.push(`module ${name}: unknown type ${module.moduleType}`);
    if (module.connection && !connections[module.connection]) {
      problems.push(`module ${name}: unknown connection ${module.connection}`);
    }
    if (!module.label || !module.description) problems.push(`module ${name}: label and description are required`);
    const times = grouped.filter((m) => m === name).length;
    if (times !== 1) problems.push(`module ${name}: listed ${times} times in groups`);
  }
  for (const name of grouped) if (!modules[name]) problems.push(`groups: unknown module ${name}`);
  const universal = Object.values(modules).filter((m) => m.moduleType === 'universal').length;
  if (universal !== 1) problems.push(`Make requires exactly one universal module, found ${universal}`);

  if (!/^#[0-9A-Fa-f]{6}$/.test(app.theme)) problems.push(`app.json: theme ${app.theme} is not a hex colour`);
  // Make accepts a square PNG of 512 to 2048 px and at most 500 kB.
  const icon = await readFile(path.join(ROOT, app.icon));
  const isPng = icon.subarray(1, 4).toString('latin1') === 'PNG';
  const width = isPng ? icon.readUInt32BE(16) : 0;
  const height = isPng ? icon.readUInt32BE(20) : 0;
  if (!isPng || width !== height || width < 512 || width > 2048 || icon.length > 500 * 1024) {
    problems.push(`${app.icon}: Make needs a square PNG of 512 to 2048 px under 500 kB`);
  }
  return problems;
}

function client(origin) {
  const apiBase = `${origin.baseUrl.replace(/\/+$/, '')}/v2`;
  let token;
  async function api(method, url, { json, body, type } = {}) {
    token ??= process.env.MAKE_API_TOKEN || (await readFile(path.resolve(SRC, origin.apikeyFile), 'utf8')).trim();
    const headers = { Authorization: `Token ${token}`, Accept: 'application/json' };
    let payload = body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    } else if (type) {
      headers['Content-Type'] = type;
    }
    const response = await fetch(`${apiBase}${url}`, { method, headers, body: payload });
    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON: keep the text for the error message.
    }
    if (!response.ok) {
      const error = new Error(`${method} ${url}: HTTP ${response.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  return api;
}

async function exists(api, url) {
  try {
    await api('GET', url);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

async function create(manifest, app, origin) {
  const api = client(origin);
  await api('POST', '/sdk/apps', {
    json: {
      name: origin.appId,
      label: app.label,
      description: app.description,
      theme: app.theme,
      language: app.language,
      countries: [],
      audience: 'global',
    },
  });
  console.log(`created app ${origin.appId}`);
}

async function deploy(manifest, app, origin, { icon }) {
  const api = client(origin);
  const appPath = `/sdk/apps/${origin.appId}/${origin.appVersion}`;
  if (!(await exists(api, appPath))) throw new Error(`app ${origin.appId} does not exist in Make: run create first`);
  const source = (file) => readFile(fromSrc(file), 'utf8');
  const general = manifest.generalCodeFiles;

  await api('PUT', `${appPath}/base`, { body: await source(general.base), type: 'application/jsonc' });
  if (general.common) await api('PUT', `${appPath}/common`, { json: await readJson(fromSrc(general.common)) });
  await api('PUT', `${appPath}/readme`, { body: await source(general.readme), type: 'text/markdown' });
  console.log('base, common data and docs sent');

  const mapping = origin.idMapping;
  let mappingChanged = false;
  const remoteOf = (kind, local) => mapping[kind].find((item) => item.local === local)?.remote;

  for (const [local, connection] of Object.entries(manifest.components.connection)) {
    let remote = remoteOf('connection', local);
    if (!remote) {
      // Make names a new connection itself; the mapping keeps the link to the local name.
      const created = await api('POST', `/sdk/apps/${origin.appId}/connections`, {
        json: { type: connection.connectionType, label: connection.label },
      });
      remote = created.appConnection.name;
      mapping.connection.push({ local, remote });
      mappingChanged = true;
    } else {
      await api('PATCH', `/sdk/apps/connections/${remote}`, { json: { label: connection.label } });
    }
    for (const [codeType, section] of Object.entries(CONNECTION_SECTIONS)) {
      await api('PUT', `/sdk/apps/connections/${remote}/${section}`, {
        body: await source(connection.codeFiles[codeType]),
        type: 'application/jsonc',
      });
    }
    console.log(`connection ${local} -> ${remote}`);
  }

  for (const [local, module] of Object.entries(manifest.components.module)) {
    const remote = remoteOf('module', local) ?? local;
    const connection = module.connection ? remoteOf('connection', module.connection) : null;
    const modulePath = `${appPath}/modules/${remote}`;
    if (await exists(api, modulePath)) {
      await api('PATCH', modulePath, {
        json: { label: module.label, description: module.description, ...(connection && { connection }) },
      });
    } else {
      await api('POST', `${appPath}/modules`, {
        json: {
          name: remote,
          typeId: MODULE_TYPE_IDS[module.moduleType],
          label: module.label,
          description: module.description,
          moduleInitMode: 'blank',
          ...(connection && { connection }),
          ...(module.actionCrud && { crud: module.actionCrud }),
        },
      });
    }
    if (!remoteOf('module', local)) {
      mapping.module.push({ local, remote });
      mappingChanged = true;
    }
    for (const [codeType, section] of Object.entries(MODULE_SECTIONS)) {
      const file = module.codeFiles[codeType];
      if (file) await api('PUT', `${modulePath}/${section}`, { body: await source(file), type: 'application/jsonc' });
    }
    console.log(`module ${local} -> ${remote}`);
  }

  // Groups name the remote modules, so they go after the modules exist.
  const groups = (await readJson(fromSrc(general.groups))).map((group) => ({
    ...group,
    modules: group.modules.map((local) => remoteOf('module', local) ?? local),
  }));
  await api('PUT', `${appPath}/groups`, { body: JSON.stringify(groups), type: 'application/jsonc' });
  console.log('groups sent');

  if (icon) {
    await api('PUT', `${appPath}/icon`, { body: await readFile(path.join(ROOT, app.icon)), type: 'image/png' });
    console.log('icon sent');
  }
  if (mappingChanged) {
    await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log('makecomapp.json: new component mapping saved');
  }
}

const [command, ...flags] = process.argv.slice(2);
const manifest = await readJson(MANIFEST);
const app = await readJson(path.join(ROOT, 'app.json'));
const originLabel = flags.find((flag) => flag.startsWith('--origin='))?.slice('--origin='.length);
const origin = originLabel ? manifest.origins.find((o) => o.label === originLabel) : manifest.origins[0];

try {
  if (command === 'check') {
    const problems = await check(manifest, app);
    for (const problem of problems) console.error(`- ${problem}`);
    if (problems.length) process.exit(1);
    console.log('app source OK');
  } else if (command === 'create') {
    await create(manifest, app, origin);
  } else if (command === 'deploy') {
    const problems = await check(manifest, app);
    if (problems.length) throw new Error(`fix the source first:\n- ${problems.join('\n- ')}`);
    await deploy(manifest, app, origin, { icon: flags.includes('--icon') });
  } else {
    console.error('usage: node scripts/make-app.mjs check | create | deploy [--icon] [--origin=<label>]');
    process.exit(2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
