/** Permet bench-harnais-turn (tsx) d'importer run-harnais.ts hors bundle Next.js. */
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};
