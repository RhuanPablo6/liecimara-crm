// Ponto de entrada detectado pela Vercel (preset Fastify, ver vercel.json).
// A Vercel só reconhece a entrada se ela importar "fastify" diretamente.
// O código da API é compilado por scripts/vercel-build.mjs (tsc → dist/).
import 'fastify';
import './dist/main.js';
